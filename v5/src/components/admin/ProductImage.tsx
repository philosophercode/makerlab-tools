"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { ApprovalImageChoice } from "../../lib/data/pending-tools";
import type { CleanedKind, ImageCandidate, ImageRetryState, ImageView, ResearchImages } from "../../lib/research/result";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ReviewNote } from "../system/review/ReviewCard";
import { DifferentImageControl } from "./DifferentImageControl";

/**
 * **Product image** on the preliminary page (gateway spec §5.2 step 1, §6):
 * research's candidate pictures, and the admin's choice of cover.
 *
 * - **A radio group of tiles**, one native radio per tile, so Tab reaches the
 *   group and the arrow keys move within it. The group is labelled by the
 *   section heading; the radios are named "Background removed", "Option
 *   {rank}" and "No image" and nothing else (the E2E finds them by those
 *   names), which is why a tile's picture sits *outside* its `<label>` — an
 *   `alt` inside would become part of the radio's name.
 * - **The cleaned copy is never shown alone.** It is a deterministic cutout of
 *   rank 1 — the original's own pixels with the plain backdrop made
 *   transparent, never a redraw (amendment "No generative redraw") — so it
 *   sits on a checkerboard (transparency visible), says so in one line, and is
 *   shown beside the original it was made from: the rank-1 tile, marked
 *   "Original".
 * - **An original that is already cut out is the clean one.** A rank 1
 *   classified `transparent` has no cleaned copy (there would be nothing to
 *   remove); its tile is drawn on the checkerboard and says "Already on a
 *   clean background". When a cut was expected but not made, one hint line
 *   says why (`images.cleanNote`).
 * - **A picked candidate is cleaned at approval** (amendment "The picked
 *   image is cleaned too"), so its tile says what will happen, from what
 *   research recorded ({@link plannedClean}): "Background removed when
 *   approved", "Cropped to the product when approved", or "Busy background —
 *   used as it is". Rank 1's "Original" beside its cleaned copy says nothing:
 *   choosing it is choosing the uncut picture, and it is stored as it is; a
 *   rank 1 whose cut already failed says why instead (`cleanNote`). The tile
 *   shows the source picture — the cleaned result is made at approval.
 * - **Every candidate displays from its source URL**, loaded by the admin's
 *   browser with no referrer: nothing is fetched or stored server-side for
 *   display (§5.2). A plain `<img>`, because the hosts are whatever research
 *   found and `next/image` would need each one allow-listed. The cleaned copy
 *   is private, so it comes from `/api/pending-tools/[id]/cleaned-image`, which
 *   checks `tools.approve`.
 * - **A crop says it is one.** A cleaned copy cropped to the product (amendment
 *   "Composites and product crop") is labelled "Cropped and background
 *   removed" or, when the backdrop could not be cut, "Cropped to the product"
 *   — drawn without the checkerboard, since nothing in it is transparent.
 * - **A banner is tagged.** A candidate the ranking judged a composite (a
 *   store banner, a price overlay, a collage) carries a "Banner" tag.
 * - **So is a poor view** (amendment "front-facing images"): a candidate the
 *   ranking judged a back view, a close-up detail or a part says so — "Back
 *   view", "Detail", "Part" — since that is exactly what made the X2D's cover
 *   wrong. Front, side and unnamed views carry no tag.
 * - **Find a different image** (`DifferentImageControl`), under the choices —
 *   and under "No product image was found" too — when the page passes
 *   `onFindDifferent`: the image stage again, with an optional note.
 * - **"From <host>"** on every tile links the page the image was declared on
 *   (source attribution), or the image itself when Exa gave no page.
 * - **Nothing to choose, nothing drawn.** An item with an uploaded photo shows
 *   "Using your photo" — research skipped the stage, and the photo is the
 *   cover. A stage that failed is one line with its reason; one that found
 *   nothing is one line. Never an empty frame.
 *
 * Controlled: the page owns the choice, because it sends it with Approve.
 * {@link initialImageChoice} is the preselection rule.
 */

export interface ProductImageProps {
  pendingId: string;
  /** The item's name, for the pictures' alt text. */
  name: string;
  /** `research.images` — undefined on research from before the image stage. */
  images: ResearchImages | null | undefined;
  /** `research.imageError` — why the stage failed, when it did. */
  imageError: string | null | undefined;
  /** The item has a photo somebody attached in the chat: it is the cover. */
  hasUploadedPhoto: boolean;
  value: ApprovalImageChoice;
  onChange: (choice: ApprovalImageChoice) => void;
  /** `research.imageRetry` — the latest **Find a different image** run. */
  retry?: ImageRetryState | null;
  /** That run is going (and fresh). */
  retryRunning?: boolean;
  /** Start **Find a different image**; absent, the control is not offered. Answers null or an `admin` message key. */
  onFindDifferent?: (note: string | null) => Promise<string | null>;
}

/** The views worth a tag: the ones that make a poor cover. `admin.intake.image.viewTag.*` keys. */
const TAGGED_VIEWS: ReadonlySet<ImageView> = new Set(["back", "detail", "part"]);

const NONE: ApprovalImageChoice = { choice: "none" };

/** The cleaned tile's wording, by what the copy is — `admin.intake.image.*` keys. */
const CLEANED_COPY: Record<
  CleanedKind,
  { label: "cleanedChoice" | "croppedCutChoice" | "croppedChoice"; note: "cleanedNote" | "croppedCutNote" | "croppedNote"; alt: "cleanedAlt" | "croppedAlt"; checkerboard: boolean }
> = {
  cut: { label: "cleanedChoice", note: "cleanedNote", alt: "cleanedAlt", checkerboard: true },
  cropped_and_cut: { label: "croppedCutChoice", note: "croppedCutNote", alt: "cleanedAlt", checkerboard: true },
  cropped: { label: "croppedChoice", note: "croppedNote", alt: "croppedAlt", checkerboard: false },
};

/** What approval will do to a picked candidate's background — `admin.intake.image.pickClean.*`, or already clean. */
export type PlannedClean = "cut" | "crop" | "busy" | "already";

/**
 * What approval's clean (`research/images/pick-clean.ts`) will make of a
 * candidate, told from what research recorded: already transparent; a box and
 * a banner or busy backdrop to crop to; busy with nothing to crop to; or
 * otherwise a backdrop to cut, when it can be (unclassified ones are
 * classified at approval).
 */
export function plannedClean(candidate: ImageCandidate): PlannedClean {
  if (candidate.background === "transparent") return "already";
  if (candidate.productBox && (candidate.composite || candidate.background === "busy")) return "crop";
  if (candidate.background === "busy") return "busy";
  return "cut";
}

/**
 * What the page starts with (§5.2 step 1): the cleaned copy when there is one,
 * otherwise rank 1, otherwise no image — and always no image when the admin's
 * own photo is the cover.
 */
export function initialImageChoice(
  images: ResearchImages | null | undefined,
  hasUploadedPhoto: boolean
): ApprovalImageChoice {
  if (hasUploadedPhoto || !images) return NONE;
  if (images.cleaned) return { choice: "cleaned" };
  const first = images.candidates[0];
  return first ? { choice: "original", candidateUrl: first.url } : NONE;
}

/**
 * Where a cleaned copy is served from — the only URL the page builds itself.
 * `version` (the copy's attachment id) changes the URL when **Find a different
 * image** replaces the copy, so the browser cannot show the old one from memory.
 */
export function cleanedImagePath(pendingId: string, version?: string): string {
  const path = `/api/pending-tools/${encodeURIComponent(pendingId)}/cleaned-image`;
  return version ? `${path}?v=${encodeURIComponent(version)}` : path;
}

export function ProductImage({
  pendingId,
  name,
  images,
  imageError,
  hasUploadedPhoto,
  value,
  onChange,
  retry,
  retryRunning = false,
  onFindDifferent,
}: ProductImageProps) {
  const t = useTranslations("admin.intake.image");
  const [cleanedBroken, setCleanedBroken] = useState(false);

  // Research from before the stage existed: there is nothing to say.
  if (!hasUploadedPhoto && images === undefined && !imageError) return null;

  const titleId = `intake-image-title-${pendingId}`;
  const heading = (
    <h3 id={titleId} className="m-0 font-mono text-label font-medium text-foreground uppercase">
      {t("title")}
    </h3>
  );

  if (hasUploadedPhoto) {
    return (
      <Section titleId={titleId}>
        {heading}
        <p className="text-table">{t("usingYourPhoto")}</p>
        <ReviewNote>{t("usingYourPhotoHint")}</ReviewNote>
      </Section>
    );
  }

  const candidates = images?.candidates ?? [];
  const cleaned = images?.cleaned ?? null;
  const cleanedKind: CleanedKind = cleaned?.kind ?? "cut";
  const cleanedCopy = CLEANED_COPY[cleanedKind];
  const bannerTag = (candidate: ImageCandidate) => [
    ...(candidate.composite ? [t("bannerTag")] : []),
    ...(candidate.view && TAGGED_VIEWS.has(candidate.view) ? [t(`viewTag.${candidate.view as "back" | "detail" | "part"}`)] : []),
  ];
  const different = onFindDifferent ? (
    <DifferentImageControl pendingId={pendingId} retry={retry} running={retryRunning} onRequest={onFindDifferent} />
  ) : null;
  const cleanNote = cleaned ? null : (images?.cleanNote ?? null);
  if (!images || (candidates.length === 0 && !cleaned)) {
    return (
      <Section titleId={titleId}>
        {heading}
        <p className="text-table">
          {imageError ? t("failed", { reason: imageError }) : images?.allRejected ? t("noneShowedProduct") : t("notFound")}
        </p>
        {different}
      </Section>
    );
  }

  const group = `intake-image-${pendingId}`;
  const [first, ...rest] = candidates;
  const fallback: ApprovalImageChoice = first ? { choice: "original", candidateUrl: first.url } : NONE;

  function chooseOriginal(candidate: ImageCandidate) {
    onChange({ choice: "original", candidateUrl: candidate.url });
  }

  function isOriginal(candidate: ImageCandidate): boolean {
    return value.choice === "original" && value.candidateUrl === candidate.url;
  }

  /** The one-line note on a candidate's tile: what approval does to it. */
  function pickNote(candidate: ImageCandidate): string | undefined {
    const planned = plannedClean(candidate);
    return planned === "already" ? t("alreadyClean") : t(`pickClean.${planned}`);
  }

  function onCleanedError() {
    setCleanedBroken(true);
    // A copy nobody can see must not stay chosen: back to the original.
    if (value.choice === "cleaned") onChange(fallback);
  }

  return (
    <Section titleId={titleId}>
      {heading}
      <ReviewNote>{t("hint")}</ReviewNote>
      {cleanNote ? <ReviewNote tone="warn">{t(`cleanNote.${cleanNote}`)}</ReviewNote> : null}

      <div className="flex flex-col gap-3" role="radiogroup" aria-labelledby={titleId}>
        {cleaned ? (
          // The cleaned copy and the original it was cut from, side by side —
          // a cutout is only ever judged against its source.
          <div data-slot="image-pair" className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <Tile
              group={group}
              id={`${group}-cleaned`}
              label={t(cleanedCopy.label)}
              checked={value.choice === "cleaned"}
              disabled={cleanedBroken}
              onSelect={() => onChange({ choice: "cleaned" })}
              checkerboard={cleanedCopy.checkerboard}
              note={t(cleanedCopy.note)}
              picture={
                cleanedBroken ? (
                  <p className="p-2 text-center text-xs text-muted-foreground" role="status">
                    {t("cleanedUnavailable")}
                  </p>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- a private file served by our own route, behind tools.approve
                  <img
                    src={cleanedImagePath(pendingId, cleaned.attachmentId)}
                    alt={t(cleanedCopy.alt, { name })}
                    loading="lazy"
                    onError={onCleanedError}
                  />
                )
              }
              source={first ?? null}
              fromLabel={(host) => t("from", { host })}
            />
            {first ? (
              <Tile
                group={group}
                id={`${group}-1`}
                label={t("candidateChoice", { rank: first.rank })}
                badges={[t("originalOfCleaned"), ...bannerTag(first)]}
                checked={isOriginal(first)}
                onSelect={() => chooseOriginal(first)}
                picture={<CandidatePicture candidate={first} alt={t("alt", { name, rank: first.rank })} />}
                source={first}
                fromLabel={(host) => t("from", { host })}
              />
            ) : null}
          </div>
        ) : first ? (
          <Tile
            group={group}
            id={`${group}-1`}
            label={t("candidateChoice", { rank: first.rank })}
            badges={bannerTag(first)}
            checked={isOriginal(first)}
            onSelect={() => chooseOriginal(first)}
            picture={<CandidatePicture candidate={first} alt={t("alt", { name, rank: first.rank })} />}
            checkerboard={first.background === "transparent"}
            // A cut research already tried and could not make says why above; nothing more here.
            note={cleanNote && first.background !== "transparent" ? undefined : pickNote(first)}
            noteTone={first.background === "transparent" ? "warn" : "muted"}
            source={first}
            fromLabel={(host) => t("from", { host })}
          />
        ) : null}

        {rest.length > 0 ? (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {rest.map((candidate) => (
              <Tile
                key={candidate.url}
                group={group}
                id={`${group}-${candidate.rank}`}
                small
                label={t("candidateChoice", { rank: candidate.rank })}
                badges={bannerTag(candidate)}
                checked={isOriginal(candidate)}
                onSelect={() => chooseOriginal(candidate)}
                picture={<CandidatePicture candidate={candidate} alt={t("alt", { name, rank: candidate.rank })} />}
                checkerboard={candidate.background === "transparent"}
                note={pickNote(candidate)}
                noteTone={candidate.background === "transparent" ? "warn" : "muted"}
                source={candidate}
                fromLabel={(host) => t("from", { host })}
              />
            ))}
          </div>
        ) : null}

        <div
          data-selected={value.choice === "none" || undefined}
          className="flex items-center gap-2 border border-border p-2 text-table data-[selected]:border-primary-ink"
        >
          <input
            id={`${group}-none`}
            type="radio"
            name={group}
            value="none"
            className="size-4 accent-primary"
            checked={value.choice === "none"}
            onChange={() => onChange(NONE)}
          />
          <label htmlFor={`${group}-none`}>{t("noneChoice")}</label>
        </div>
      </div>
      {different}
    </Section>
  );
}

/** The section every state of the image choice sits in: a heading, then the choice. */
function Section({ titleId, children }: { titleId: string; children: ReactNode }) {
  return (
    <section data-slot="product-image" aria-labelledby={titleId} className="ui flex flex-col gap-2">
      {children}
    </section>
  );
}

/** One choice: its radio first (so it leads on a phone), then the picture, the note and the source. */
function Tile({
  group,
  id,
  label,
  badges = [],
  checked,
  disabled = false,
  onSelect,
  picture,
  checkerboard = false,
  small = false,
  note,
  noteTone = "warn",
  source,
  fromLabel,
}: {
  group: string;
  id: string;
  label: string;
  badges?: string[];
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
  picture: ReactNode;
  checkerboard?: boolean;
  small?: boolean;
  note?: string;
  noteTone?: "muted" | "warn";
  /** The candidate whose page is credited — for the cleaned copy, the original it was made from. */
  source: ImageCandidate | null;
  fromLabel: (host: string) => string;
}) {
  const link = source ? attribution(source) : null;

  return (
    <div
      data-slot="image-tile"
      data-selected={checked || undefined}
      className={cn(
        "flex min-w-0 flex-col gap-1.5 border border-border bg-muted p-2",
        // A selected tile: the accent rule, twice as heavy — never a shadow.
        checked && "border-primary-ink outline-1 -outline-offset-2 outline-primary-ink outline-solid",
        disabled && "opacity-60"
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5 text-table">
        <input
          id={id}
          type="radio"
          name={group}
          value={id}
          className="size-4 accent-primary"
          checked={checked}
          disabled={disabled}
          onChange={onSelect}
        />
        <label htmlFor={id}>{label}</label>
        {badges.map((badge) => (
          <Badge key={badge} variant="outline">
            {badge}
          </Badge>
        ))}
      </div>
      {/* The picture selects too, for a pointer; the radio is the keyboard's way in. */}
      <div
        data-slot="image-frame"
        data-checkerboard={checkerboard || undefined}
        className={cn(
          "flex items-center justify-center overflow-hidden bg-card [&_img]:block [&_img]:h-auto [&_img]:max-h-full [&_img]:w-auto [&_img]:max-w-full [&_img]:object-contain",
          small ? "aspect-square" : "aspect-[4/3]",
          disabled ? "cursor-default" : "cursor-pointer"
        )}
        onClick={disabled ? undefined : onSelect}
      >
        {picture}
      </div>
      {note ? <ReviewNote tone={noteTone}>{note}</ReviewNote> : null}
      {link ? (
        <a
          className="text-xs break-all text-primary-ink underline-offset-2 hover:underline"
          href={link.href}
          target="_blank"
          rel="noreferrer noopener"
        >
          {fromLabel(link.host)}
        </a>
      ) : null}
    </div>
  );
}

/** A candidate, straight from its own host, sending no referrer. */
function CandidatePicture({ candidate, alt }: { candidate: ImageCandidate; alt: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- an arbitrary host research found; loaded by the admin's browser, never proxied (§5.2)
    <img
      src={candidate.url}
      alt={alt}
      width={candidate.width}
      height={candidate.height}
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  );
}

/** The page to credit, and its bare host. Null for anything that is not http(s). */
function attribution(candidate: ImageCandidate): { href: string; host: string } | null {
  const href = candidate.pageUrl ?? candidate.url;
  try {
    const url = new URL(href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return { href, host: url.hostname.replace(/^www\./, "") };
  } catch {
    return null;
  }
}

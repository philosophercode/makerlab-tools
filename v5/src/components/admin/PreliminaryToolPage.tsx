"use client";

import "../../styles/admin-intake.css";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type {
  ApprovePendingAction,
  IntakeActions,
  IntakeApproveResult,
} from "../../app/admin/intake/action-result";
import type { AdminActionWarning } from "../../lib/admin/action-result";
import type { ApprovalFields, ApprovalImageChoice } from "../../lib/data/pending-tools";
import type { CategoryOption, LocationOption } from "../../lib/data/taxonomy";
import { imageRetryInProgress } from "../../lib/intake/image-retry-state";
import { INTAKE_POLL_INTERVAL_MS, REDO_HIGHLIGHT_SHOW_MS } from "../../lib/intake/limits";
import { isImageOnlyFocus, type ResearchFocusField } from "../../lib/intake/research-focus";
import { ADMIN_INTAKE_PATH, type PendingToolView } from "../../lib/intake/types";
import type { ResearchImages, ResearchResult } from "../../lib/research/result";
import { ConfidenceStrip, isWebLink } from "../ConfidenceStrip";
import { requestResearch } from "./IntakeList";
import { initialImageChoice, ProductImage } from "./ProductImage";
import { recentlyUpdatedSections, redoWhat } from "./redo-status";
import { ResearchAgainDialog } from "./ResearchAgainDialog";

/**
 * `/admin/intake/[id]` — the page an admin approves from (spec §5.4 steps
 * 10–12, §6, Article 5).
 *
 * **It shows the proposal, not a verdict.** Research's result arrives as the
 * tool editor's own fields, pre-filled and editable, beside the evidence it
 * rests on: the confidence strip reused from the chat card, the pages research
 * read, the links it verified and the ones it dropped with their reasons, and
 * the photos. Nothing here writes until somebody presses a button.
 *
 * **Low confidence disables both Approve buttons** until the admin either
 * corrects the name and researches again — the page re-renders with the new
 * grade — or ticks "I've checked this" *and* writes a note. The note travels as
 * `overrideNote` and `approvePendingTool` enforces the same rule, so a request
 * that skips this page is refused all the same (§5.4 step 12).
 *
 * **A refusal never costs anybody their typing.** The draft is initialised once
 * from the research and is never replaced by a server value; a refusal shows
 * its reason inline and leaves every box as it was. There is no modal (§6).
 * Every control sits in one `<fieldset>` that is disabled while any write is in
 * flight, so two presses cannot become two tools.
 *
 * **The actions arrive as props** and each re-checks its own permission:
 * hiding **Approve** from somebody without `tools.publish` is presentation.
 * No `useTransition` around them, for the reason `use-row-action.ts` gives:
 * each ends in `revalidatePath`, and a transition would hold the confirmation
 * hostage to the re-render behind it.
 *
 * **The product image is part of the decision** (gateway spec §5.2). The
 * `ProductImage` section offers research's candidates above the read-only
 * photos, preselects one, and the choice travels with either Approve as
 * `fields.image`. An image that could not be attached is a warning on the
 * success, never a failure: the tool exists, and the settled panel says the
 * cover is missing.
 *
 * **The reviewer can correct the research** (amendment "Product-page first,
 * front-facing images, reviewer notes"). **Research again** opens a small
 * inline panel, "Anything to focus on?" (`ResearchAgainDialog`, amendment
 * "Guided redo"): what to redo — everything, or some of the description, the
 * specs, the links and manuals, the image — quick suggestions, and an optional
 * one-paragraph note ("use the bambulab.com X2D product page") that both
 * research passes see, fenced, and the result records — it starts as the note
 * the last research ran with. A scoped redo keeps every other field as it was;
 * an image-only one is **Find a different image**. When a redo lands, the
 * sections it changed are marked "Updated just now" for a moment.
 * **Find a different image** runs the image stage alone with its own note;
 * while it runs the page polls, and when the new pictures land the image
 * choice is re-derived from them, because a choice of a picture that is no
 * longer offered cannot be approved.
 *
 * The component stays mounted when the page re-renders with the item approved
 * or discarded, which is what keeps a success's warning on screen after the
 * server has moved on.
 */

/** The tool an add-unit item joins, or the tool an approval created. */
export interface IntakeToolLink {
  name: string;
  slug: string;
  published: boolean;
}

export interface PreliminaryToolPageProps {
  item: PendingToolView;
  /** Null for an add-unit item, which skipped research. */
  research: ResearchResult | null;
  categories: CategoryOption[];
  locations: LocationOption[];
  /** The existing tool an add-unit item would join. Null when it is gone. */
  targetTool: IntakeToolLink | null;
  /** What an approved item became, when it has been approved. */
  createdTool: IntakeToolLink | null;
  /** Hides **Approve** (published). The action checks `tools.publish` itself. */
  canPublish: boolean;
  actions: IntakeActions;
}

/** The option that creates research's proposed category at approval. */
const NEW_CATEGORY = "__new__";

/** What the reviewer is editing: the proposal as text, the way inputs hold it. */
interface Draft {
  name: string;
  description: string;
  category: string;
  locationId: string;
  materials: string;
  ppeRequired: string;
  tags: string;
  trainingRequired: boolean;
  useRestrictions: string;
  serialNumber: string;
  resourceUrls: string[];
}

/** Which write is in flight. One at a time, and every control knows it. */
type Busy = "approve" | "draft" | "unit" | "discard" | "save" | "research" | null;

/** How the item left the queue, as far as this page saw it happen. */
type Settled =
  | {
      kind: "approved";
      tool: IntakeToolLink;
      warning: AdminActionWarning | null;
      /** An image was chosen and did not attach — said even when `warning` went to the audit. */
      imageMissing: boolean;
    }
  | { kind: "unit"; tool: IntakeToolLink; warning: AdminActionWarning | null; imageMissing: boolean }
  | { kind: "discarded" };

const LIST_FIELDS = ["materials", "ppeRequired", "tags"] as const;

export function PreliminaryToolPage({
  item,
  research,
  categories,
  locations,
  targetTool,
  createdTool,
  canPublish,
  actions,
}: PreliminaryToolPageProps) {
  const t = useTranslations("admin.intake");
  const tAdmin = useTranslations("admin");
  const router = useRouter();

  const isUnit = item.duplicateResolution === "add_unit";

  // Initialised once, never synchronised — see "a refusal never costs
  // anybody their typing" above.
  const [draft, setDraft] = useState<Draft>(() =>
    initialDraft(item, research, categories, locations)
  );
  const [identity, setIdentity] = useState({ name: item.name, brand: item.brand ?? "" });
  const [unitSerial, setUnitSerial] = useState(item.serialNumber ?? "");
  const [checked, setChecked] = useState(false);
  // An uploaded photo is the cover, so research looked for no other (§5.1 step 3).
  const hasUploadedPhoto = item.photos.length > 0;
  const [imageChoice, setImageChoice] = useState<ApprovalImageChoice>(() =>
    initialImageChoice(research?.images, hasUploadedPhoto)
  );
  const [note, setNote] = useState("");
  const [redoOpen, setRedoOpen] = useState(false);
  /** A redo this page just started: its focus (null for everything), until the page moves on. */
  const [redoStarted, setRedoStarted] = useState<{ focus: ResearchFocusField[] | null } | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const locale = useLocale();

  // New pictures (Find a different image) mean a fresh preselection: the old
  // choice may name a candidate or a cleaned copy that is gone.
  const imagesKey = imageSetKey(research?.images);
  const [choiceFor, setChoiceFor] = useState(imagesKey);
  if (choiceFor !== imagesKey) {
    setChoiceFor(imagesKey);
    setImageChoice(initialImageChoice(research?.images, hasUploadedPhoto));
  }

  // A Find a different image run in flight: poll like the queue does, and
  // stop once it lands or goes stale.
  const [now, setNow] = useState(() => Date.now());
  const retry = research?.imageRetry ?? null;
  const retryRunning = imageRetryInProgress(retry, now);
  useEffect(() => {
    if (!retryRunning) return;
    const timer = setInterval(() => {
      setNow(Date.now());
      router.refresh();
    }, INTAKE_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [retryRunning, router]);

  // What the last redo changed, marked "Updated just now" briefly. Keyed by
  // the record itself, so a new landing (an image search finishing while the
  // page is open) marks again, and a poll that changed nothing does not.
  const updatedKey = research?.updated ? JSON.stringify(research.updated) : null;
  const [updatedSections, setUpdatedSections] = useState<ResearchFocusField[]>(() =>
    recentlyUpdatedSections(research?.updated, Date.now())
  );
  useEffect(() => {
    if (!updatedKey) return;
    const sections = recentlyUpdatedSections(JSON.parse(updatedKey) as ResearchResult["updated"], Date.now());
    const show = setTimeout(() => setUpdatedSections(sections), 0);
    const hide = setTimeout(() => setUpdatedSections([]), REDO_HIGHLIGHT_SHOW_MS);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [updatedKey]);

  const [busy, setBusy] = useState<Busy>(null);
  /** A message key under `admin` — `errors.<code>` or `intake.errors.<code>`. */
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [settled, setSettled] = useState<Settled | null>(null);

  // The server's word wins over nothing, and this page's own result wins over
  // the server's: it carries the warning, which the database does not.
  const outcome = settled ?? settledFromProps(item, createdTool, isUnit);
  if (outcome) return <SettledPanel outcome={outcome} />;

  const low = research?.confidence.level === "low";
  const overridden = checked && note.trim() !== "";
  const approvable =
    !isUnit && research !== null && (!low || overridden) && draft.name.trim() !== "";
  const identityDirty =
    identity.name.trim() !== item.name || (identity.brand.trim() || null) !== item.brand;

  function set<K extends keyof Draft>(field: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function toggleResource(url: string, on: boolean) {
    setDraft((current) => ({
      ...current,
      resourceUrls: on
        ? [...current.resourceUrls, url]
        : current.resourceUrls.filter((candidate) => candidate !== url),
    }));
  }

  /** Run one write with the page locked, and clear the last outcome first. */
  async function write<T>(which: Busy, call: () => Promise<T>): Promise<T | null> {
    setBusy(which);
    setError(null);
    setNotice(null);
    try {
      return await call();
    } catch {
      // A dropped connection or a redeploy mid-click: nothing is known to have
      // landed, and the draft is still here to try again with.
      setError("errors.failed");
      return null;
    } finally {
      setBusy(null);
    }
  }

  function settle(
    result: IntakeApproveResult | null,
    kind: "approved" | "unit",
    name: string,
    imageSent = false
  ) {
    if (!result) return;
    if (!result.ok) {
      setError(`errors.${result.error}`);
      return;
    }
    setSettled({
      kind,
      tool: { name, slug: result.slug, published: result.published },
      warning: result.warning ?? null,
      imageMissing: imageSent && result.imageAttached === false,
    });
  }

  async function approve(action: ApprovePendingAction, which: "approve" | "draft") {
    if (!research) return;
    // The admin's own photo is the cover; nothing else is sent in its place.
    const image = hasUploadedPhoto ? ({ choice: "none" } as const) : imageChoice;
    const fields = toFields(draft, research, image);
    const result = await write(which, () =>
      action({ id: item.id, fields, overrideNote: low ? note.trim() : null })
    );
    settle(result, "approved", fields.name, image.choice !== "none");
  }

  async function addUnit() {
    const result = await write("unit", () =>
      actions.addUnit({ id: item.id, serialNumber: unitSerial.trim() || null })
    );
    settle(result, "unit", targetTool?.name ?? item.name);
  }

  async function discard() {
    const result = await write("discard", () => actions.discard({ id: item.id }));
    setConfirmDiscard(false);
    if (!result) return;
    if (!result.ok) {
      setError(`errors.${result.error}`);
      return;
    }
    setSettled({ kind: "discarded" });
  }

  /** Save the name and brand. Answers whether they are now saved. */
  async function saveIdentity(): Promise<boolean> {
    const result = await write("save", () =>
      actions.saveIdentity({
        id: item.id,
        name: identity.name.trim(),
        brand: identity.brand.trim() || null,
      })
    );
    if (!result) return false;
    if (!result.ok) {
      setError(`errors.${result.error}`);
      return false;
    }
    setNotice(result.warning ? `warnings.${result.warning}` : "saved");
    return true;
  }

  /**
   * **Research again**, from the "Anything to focus on?" panel. A corrected
   * name is saved first — researching the old one would spend the budget
   * confirming the mistake. The panel stays open on a refusal, so the choices
   * and the note are still there to try again with.
   */
  async function researchAgain(request: { focus: ResearchFocusField[] | null; note: string | null }) {
    if (identityDirty && !(await saveIdentity())) return;
    const code = await write("research", () => requestResearch(item.id, request.note, request.focus));
    if (code) {
      setError(`intake.errors.${code}`);
      return;
    }
    setRedoOpen(false);
    setRedoStarted({ focus: request.focus });
    // An image-only redo is an image search on this page: start polling for it.
    if (isImageOnlyFocus(request.focus)) setNow(Date.now());
    router.refresh();
  }

  /** **Find a different image**: null when it started, else the message key to show. */
  async function findDifferentImage(imageNote: string | null): Promise<string | null> {
    const action = actions.differentImage;
    if (!action) return null;
    let result;
    try {
      result = await action({ id: item.id, note: imageNote });
    } catch {
      return "errors.failed";
    }
    if (!result.ok) return `errors.${result.error}`;
    setNow(Date.now());
    router.refresh();
    return null;
  }

  const locked = busy !== null;

  return (
    <div className="admin-intake-page">
      <fieldset className="admin-intake-fieldset" disabled={locked}>
        <legend className="admin-visually-hidden">{t("pageLabel", { name: item.name })}</legend>

        <div className="admin-intake-columns">
          <div className="admin-intake-main">
            {/* Not for an add-unit item: it skipped research, and renaming it
                would only move the duplicate match it was resolved against. */}
            {isUnit ? null : (
              <section className="admin-intake-panel" aria-labelledby="intake-identity-title">
                <h3 id="intake-identity-title">{t("identityTitle")}</h3>
                <p className="admin-intake-hint">{t("identityHint")}</p>
                <div className="admin-intake-identity">
                  <div className="admin-field">
                    <label htmlFor="intake-identity-name">{t("identityName")}</label>
                    <input
                      id="intake-identity-name"
                      value={identity.name}
                      maxLength={200}
                      onChange={(event) => setIdentity({ ...identity, name: event.target.value })}
                    />
                  </div>
                  <div className="admin-field">
                    <label htmlFor="intake-identity-brand">{t("identityBrand")}</label>
                    <input
                      id="intake-identity-brand"
                      value={identity.brand}
                      maxLength={200}
                      onChange={(event) => setIdentity({ ...identity, brand: event.target.value })}
                    />
                  </div>
                </div>
                {item.duplicateOf ? (
                  <p className="admin-intake-duplicate">
                    {item.duplicateOf.kind === "tool"
                      ? t("duplicateOfTool", { name: item.duplicateOf.name })
                      : t("duplicateOfPending", { name: item.duplicateOf.name })}
                  </p>
                ) : null}
                <div className="admin-editor-actions">
                  <button
                    type="button"
                    className="admin-button"
                    disabled={!identityDirty || identity.name.trim() === ""}
                    onClick={() => void saveIdentity()}
                  >
                    {t("saveIdentity")}
                  </button>
                  <button
                    type="button"
                    className="admin-button"
                    aria-expanded={redoOpen}
                    disabled={identity.name.trim() === ""}
                    onClick={() => setRedoOpen((open) => !open)}
                  >
                    {t("researchAgain")}
                  </button>
                </div>
                {redoOpen ? (
                  <ResearchAgainDialog
                    initialNote={research?.reviewerNote ?? ""}
                    imageAvailable={!hasUploadedPhoto && research !== null}
                    onSubmit={(request) => void researchAgain(request)}
                    onCancel={() => setRedoOpen(false)}
                  />
                ) : null}
              </section>
            )}

            {isUnit ? (
              <UnitProposal
                target={targetTool}
                serial={unitSerial}
                onSerial={setUnitSerial}
                onAdd={() => void addUnit()}
              />
            ) : research ? (
              <>
                <ConfidenceStrip
                  confidence={research.confidence}
                  evidence={research.evidence}
                  sourceUrls={research.sourceUrls}
                  sourcesAreReads
                  unknownsFirst={research.confidence.level !== "high"}
                />

                {low ? (
                  <section
                    className="admin-intake-override"
                    aria-labelledby="intake-override-title"
                  >
                    <h3 id="intake-override-title">{t("lowTitle")}</h3>
                    <p>{t("lowExplain")}</p>
                    <div className="admin-field is-check">
                      <input
                        id="intake-override-check"
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => setChecked(event.target.checked)}
                      />
                      <label htmlFor="intake-override-check">{t("overrideCheck")}</label>
                    </div>
                    <div className="admin-field">
                      <label htmlFor="intake-override-note">{t("overrideNote")}</label>
                      <textarea
                        id="intake-override-note"
                        rows={3}
                        maxLength={1000}
                        placeholder={t("overrideNotePlaceholder")}
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                      />
                    </div>
                  </section>
                ) : null}

                <ProposedRecord
                  draft={draft}
                  research={research}
                  categories={categories}
                  locations={locations}
                  set={set}
                  toggleResource={toggleResource}
                  updated={updatedSections}
                />
              </>
            ) : (
              <p className="admin-empty td-empty">{t("noResearch")}</p>
            )}

            <div className="admin-editor-actions admin-intake-decision">
              {isUnit ? null : (
                <>
                  {canPublish ? (
                    <button
                      type="button"
                      className="admin-button is-primary"
                      disabled={!approvable}
                      onClick={() => void approve(actions.approve, "approve")}
                    >
                      {t("approve")}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="admin-button"
                    disabled={!approvable}
                    onClick={() => void approve(actions.approveAsDraft, "draft")}
                  >
                    {t("approveAsDraft")}
                  </button>
                </>
              )}
              {confirmDiscard ? (
                <span className="admin-intake-confirm">
                  <span>{t("discardConfirm", { name: item.name })}</span>
                  <button
                    type="button"
                    className="admin-button is-danger"
                    onClick={() => void discard()}
                  >
                    {t("discardYes")}
                  </button>
                  <button
                    type="button"
                    className="admin-button"
                    onClick={() => setConfirmDiscard(false)}
                  >
                    {t("discardKeep")}
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="admin-button is-danger"
                  onClick={() => setConfirmDiscard(true)}
                >
                  {t("discard")}
                </button>
              )}
            </div>

            <p
              className={`admin-row-status admin-intake-status-line${error ? " is-error" : ""}${
                !error && notice?.startsWith("warnings.") ? " is-warning" : ""
              }`}
              role="status"
            >
              {busy ? t(`busy.${busy}`) : null}
              {!busy && error ? tAdmin(error) : null}
              {!busy && !error && notice ? tAdmin(notice) : null}
              {!busy && !error && !notice && redoStarted && (!isImageOnlyFocus(redoStarted.focus) || retryRunning)
                ? redoWhat(t, locale, redoStarted.focus)
                : null}
            </p>
          </div>

          <aside className="admin-intake-side">
            {research && !isUnit ? (
              <div className={updatedSections.includes("image") ? "admin-intake-updated is-updated" : "admin-intake-updated"}>
                {updatedSections.includes("image") ? <UpdatedTag /> : null}
              <ProductImage
                key={imagesKey}
                pendingId={item.id}
                name={item.name}
                images={research.images}
                imageError={research.imageError}
                hasUploadedPhoto={hasUploadedPhoto}
                value={imageChoice}
                onChange={setImageChoice}
                retry={retry}
                retryRunning={retryRunning}
                onFindDifferent={actions.differentImage ? findDifferentImage : undefined}
              />
              </div>
            ) : null}
            <Photos item={item} />
            {research && !isUnit ? <DroppedLinks research={research} /> : null}
          </aside>
        </div>
      </fieldset>
    </div>
  );
}

/** "Updated just now", beside a section the last redo changed. */
function UpdatedTag() {
  const t = useTranslations("admin.intake");
  return <span className="admin-intake-updated-tag">{t("redo.updated")}</span>;
}

/** What identifies a set of pictures: its candidates' URLs and its cleaned copy. */
function imageSetKey(images: ResearchImages | null | undefined): string {
  if (!images) return "none";
  return [images.cleaned?.attachmentId ?? "", ...images.candidates.map((candidate) => candidate.url)].join("|");
}

/** The proposed record, in the tool editor's fields. */
function ProposedRecord({
  draft,
  research,
  categories,
  locations,
  set,
  toggleResource,
  updated,
}: {
  draft: Draft;
  research: ResearchResult;
  categories: CategoryOption[];
  locations: LocationOption[];
  set: <K extends keyof Draft>(field: K, value: Draft[K]) => void;
  toggleResource: (url: string, on: boolean) => void;
  /** The sections the last redo changed, while they are marked. */
  updated: readonly ResearchFocusField[];
}) {
  const t = useTranslations("admin.intake");
  const tEditor = useTranslations("admin.inventory.editor");
  const proposed = research.category;
  const offersNew =
    proposed.name.trim() !== "" && !categories.some((c) => c.id === proposed.existingId);
  // The specs ride in the description box, so either marks it.
  const textUpdated = updated.includes("description") || updated.includes("specs");
  const linksUpdated = updated.includes("links");

  return (
    <section className="admin-intake-panel" aria-labelledby="intake-record-title">
      <h3 id="intake-record-title">{t("recordTitle")}</h3>
      <p className="admin-intake-hint">{t("recordHint")}</p>

      <div className="admin-editor-form">
        <div className="admin-field">
          <label htmlFor="intake-name">{tEditor("fieldName")}</label>
          <input
            id="intake-name"
            value={draft.name}
            required
            maxLength={200}
            onChange={(event) => set("name", event.target.value)}
          />
        </div>

        <div className={`admin-field${textUpdated ? " is-updated" : ""}`}>
          <label htmlFor="intake-description">
            {tEditor("fieldDescription")}
            {textUpdated ? <UpdatedTag /> : null}
          </label>
          <textarea
            id="intake-description"
            rows={8}
            value={draft.description}
            onChange={(event) => set("description", event.target.value)}
          />
        </div>

        <div className="admin-field">
          <label htmlFor="intake-category">{tEditor("fieldCategory")}</label>
          <select
            id="intake-category"
            value={draft.category}
            onChange={(event) => set("category", event.target.value)}
          >
            <option value="">{tEditor("noneSelected")}</option>
            {offersNew ? (
              <option value={NEW_CATEGORY}>
                {t("newCategory", { name: categoryLabel(proposed.name, proposed.group) })}
              </option>
            ) : null}
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {categoryLabel(category.name, category.group)}
              </option>
            ))}
          </select>
        </div>

        <div className="admin-field">
          <label htmlFor="intake-location">{tEditor("fieldLocation")}</label>
          <select
            id="intake-location"
            value={draft.locationId}
            onChange={(event) => set("locationId", event.target.value)}
          >
            <option value="">{tEditor("noneSelected")}</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {`${location.room} — ${location.zone}`}
              </option>
            ))}
          </select>
        </div>

        {LIST_FIELDS.map((field) => (
          <div className="admin-field" key={field}>
            <label htmlFor={`intake-${field}`}>{tEditor(`field_${field}`)}</label>
            <input
              id={`intake-${field}`}
              value={draft[field]}
              placeholder={tEditor("listPlaceholder")}
              onChange={(event) => set(field, event.target.value)}
            />
          </div>
        ))}

        <div className="admin-field is-check">
          <input
            id="intake-training-required"
            type="checkbox"
            checked={draft.trainingRequired}
            onChange={(event) => set("trainingRequired", event.target.checked)}
          />
          <label htmlFor="intake-training-required">{tEditor("fieldTrainingRequired")}</label>
        </div>

        <div className="admin-field">
          <label htmlFor="intake-use-restrictions">{tEditor("fieldUseRestrictions")}</label>
          <input
            id="intake-use-restrictions"
            value={draft.useRestrictions}
            onChange={(event) => set("useRestrictions", event.target.value)}
          />
        </div>

        <div className="admin-field">
          <label htmlFor="intake-serial">{tEditor("unitSerial")}</label>
          <input
            id="intake-serial"
            value={draft.serialNumber}
            maxLength={200}
            onChange={(event) => set("serialNumber", event.target.value)}
          />
        </div>

        <fieldset className={`admin-intake-resources${linksUpdated ? " is-updated" : ""}`}>
          <legend>
            {t("resourcesTitle")}
            {linksUpdated ? <UpdatedTag /> : null}
          </legend>
          {research.resources.length === 0 ? (
            <p className="admin-intake-hint">{t("noResources")}</p>
          ) : (
            <ul>
              {research.resources.map((resource, index) => (
                <li key={resource.url} className="admin-field is-check">
                  <input
                    id={`intake-resource-${index}`}
                    type="checkbox"
                    checked={draft.resourceUrls.includes(resource.url)}
                    onChange={(event) => toggleResource(resource.url, event.target.checked)}
                  />
                  <label htmlFor={`intake-resource-${index}`}>
                    {t("resourceLabel", { title: resource.title, type: resource.type })}
                  </label>
                  {isWebLink(resource.url) ? (
                    <a href={resource.url} target="_blank" rel="noopener noreferrer">
                      {t("openResource")}
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </fieldset>
      </div>
    </section>
  );
}

/** An add-unit item: the tool it joins, and the one field that matters. */
function UnitProposal({
  target,
  serial,
  onSerial,
  onAdd,
}: {
  target: IntakeToolLink | null;
  serial: string;
  onSerial: (value: string) => void;
  onAdd: () => void;
}) {
  const t = useTranslations("admin.intake");

  return (
    <section className="admin-intake-panel" aria-labelledby="intake-unit-title">
      <h3 id="intake-unit-title">{t("unitTitle")}</h3>
      {target ? (
        <p>
          {t("unitTarget")} <Link href={`/tools/${target.slug}`}>{target.name}</Link>
          {target.published ? null : <span className="admin-state is-draft">{t("draft")}</span>}
        </p>
      ) : (
        <p className="admin-empty td-empty">{t("unitTargetMissing")}</p>
      )}
      <div className="admin-field">
        <label htmlFor="intake-unit-serial">{t("unitSerial")}</label>
        <input
          id="intake-unit-serial"
          value={serial}
          maxLength={200}
          onChange={(event) => onSerial(event.target.value)}
        />
      </div>
      <div className="admin-editor-actions">
        <button
          type="button"
          className="admin-button is-primary"
          disabled={!target}
          onClick={onAdd}
        >
          {t("addUnit")}
        </button>
      </div>
    </section>
  );
}

/** The photos that came with the item. A private one says so rather than guessing a URL. */
function Photos({ item }: { item: PendingToolView }) {
  const t = useTranslations("admin.intake");

  return (
    <section className="admin-intake-panel" aria-labelledby="intake-photos-title">
      <h3 id="intake-photos-title">{t("photosTitle")}</h3>
      {item.photos.length === 0 ? (
        <p className="admin-intake-hint">{t("noPhotos")}</p>
      ) : (
        <ul className="admin-intake-photos">
          {item.photos.map((photo, index) =>
            photo.url ? (
              <li key={photo.attachmentId} className="admin-thumb is-project">
                <Image
                  src={photo.url}
                  alt={t("photoAlt", { name: item.name, index: index + 1 })}
                  fill
                  sizes="96px"
                  style={{ objectFit: "cover" }}
                  unoptimized
                />
              </li>
            ) : (
              <li key={photo.attachmentId} className="admin-thumb is-project is-empty">
                <span>{t("photoPrivate")}</span>
              </li>
            )
          )}
        </ul>
      )}
    </section>
  );
}

/** Links research found and refused to trust, with the reason for each. */
function DroppedLinks({ research }: { research: ResearchResult }) {
  const t = useTranslations("admin.intake");
  if (research.droppedLinks.length === 0) return null;

  return (
    <section className="admin-intake-panel" aria-labelledby="intake-dropped-title">
      <h3 id="intake-dropped-title">{t("droppedTitle")}</h3>
      <p className="admin-intake-hint">{t("droppedHint")}</p>
      <ul className="admin-intake-dropped">
        {research.droppedLinks.map((line) => (
          // Written in English by link verification: a record, not UI copy.
          <li key={line} lang="en">
            {line}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** How the item left the queue, with where it went. */
function SettledPanel({ outcome }: { outcome: Settled }) {
  const t = useTranslations("admin.intake");
  const tAdmin = useTranslations("admin");

  if (outcome.kind === "discarded") {
    return (
      <section className="admin-intake-done td-panel" role="status">
        <p>{t("discarded")}</p>
        <Link href={ADMIN_INTAKE_PATH}>{t("backToQueue")}</Link>
      </section>
    );
  }

  const message =
    outcome.kind === "unit"
      ? t("unitAdded", { name: outcome.tool.name })
      : outcome.tool.published
        ? t("approvedPublished")
        : t("approvedDraft");

  return (
    <section className="admin-intake-done td-panel" role="status">
      <p>{message}</p>
      <p>
        {/* Drafts render at their slug for anyone holding catalog.view_drafts,
            which every approver does — so the link works either way. */}
        <Link href={`/tools/${outcome.tool.slug}`}>
          {t("openTool", { name: outcome.tool.name })}
        </Link>
      </p>
      {outcome.warning ? (
        <p className="admin-row-status is-warning">{tAdmin(`warnings.${outcome.warning}`)}</p>
      ) : null}
      {outcome.imageMissing && outcome.warning !== "image_not_attached" ? (
        <p className="admin-row-status is-warning">{tAdmin("warnings.image_not_attached")}</p>
      ) : null}
      <Link href={ADMIN_INTAKE_PATH}>{t("backToQueue")}</Link>
    </section>
  );
}

// ── Pure helpers ────────────────────────────────────────────────────

/** An approved or discarded item, as the server says it is. */
function settledFromProps(
  item: PendingToolView,
  createdTool: IntakeToolLink | null,
  isUnit: boolean
): Settled | null {
  if (item.status === "discarded") return { kind: "discarded" };
  if (item.status === "approved" && createdTool) {
    return { kind: isUnit ? "unit" : "approved", tool: createdTool, warning: null, imageMissing: false };
  }
  return null;
}

/** The proposal as the form's starting point. */
function initialDraft(
  item: PendingToolView,
  research: ResearchResult | null,
  categories: CategoryOption[],
  locations: LocationOption[]
): Draft {
  return {
    name: research?.canonicalName.trim() || item.name,
    description: research ? proposedDescription(research) : "",
    category: research ? proposedCategory(research, categories) : "",
    locationId: matchLocation(item.locationHint, locations),
    materials: (research?.materials ?? []).join(", "),
    ppeRequired: (research?.ppeRequired ?? []).join(", "),
    tags: (research?.tags ?? []).join(", "),
    // Unknown is not "no" — but it is not "yes" either, and the box is in
    // front of the reviewer, who is the one deciding.
    trainingRequired: research?.trainingRequired ?? false,
    useRestrictions: research?.useRestrictions ?? "",
    serialNumber: item.serialNumber ?? "",
    // Every verified link starts ticked; unticking one is the edit.
    resourceUrls: (research?.resources ?? []).map((resource) => resource.url),
  };
}

/**
 * The description, with research's specs appended as a Markdown list.
 *
 * `tools` has no specs column (§4.4), and a spec sheet research read is worth
 * keeping, so it rides in the description where the tool page renders Markdown
 * — as text the reviewer can edit or delete before it is saved.
 */
export function proposedDescription(research: ResearchResult): string {
  const specs = research.specs.map((spec) => `- **${spec.label}:** ${spec.value}`).join("\n");
  return [research.description.trim(), specs].filter(Boolean).join("\n\n");
}

/**
 * The category research matched, if the lab still has it; otherwise research's
 * proposal, to be created at approval; otherwise none.
 */
function proposedCategory(research: ResearchResult, categories: CategoryOption[]): string {
  const existing = research.category.existingId;
  if (existing && categories.some((category) => category.id === existing)) return existing;
  return research.category.name.trim() ? NEW_CATEGORY : "";
}

/** A location whose room or zone is the hint, ignoring case. */
function matchLocation(hint: string | null, locations: LocationOption[]): string {
  const wanted = hint?.trim().toLowerCase();
  if (!wanted) return "";
  const match = locations.find(
    (location) => location.room.toLowerCase() === wanted || location.zone.toLowerCase() === wanted
  );
  return match?.id ?? "";
}

function categoryLabel(name: string, group: string | null): string {
  return group ? `${group} — ${name}` : name;
}

/** "PLA, resin" → ["PLA", "resin"]. Blanks dropped. */
function splitList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** The draft as `approvePendingTool` takes it, with the chosen image. */
function toFields(draft: Draft, research: ResearchResult, image: ApprovalImageChoice): ApprovalFields {
  const isNew = draft.category === NEW_CATEGORY;
  return {
    name: draft.name.trim(),
    description: draft.description.trim() || null,
    categoryId: draft.category && !isNew ? draft.category : null,
    newCategory: isNew ? { name: research.category.name, group: research.category.group } : null,
    locationId: draft.locationId || null,
    materials: splitList(draft.materials),
    ppeRequired: splitList(draft.ppeRequired),
    tags: splitList(draft.tags),
    trainingRequired: draft.trainingRequired,
    useRestrictions: draft.useRestrictions.trim() || null,
    serialNumber: draft.serialNumber.trim() || null,
    resourceUrls: draft.resourceUrls,
    image,
  };
}

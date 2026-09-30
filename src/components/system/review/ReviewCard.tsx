import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Glyph } from "../StatusGlyph";

/**
 * The review primitive (UI system spec §7.4; DESIGN.md §8.6): one thing a
 * person decides — a field research proposes (refresh, chat), a group of a
 * researched item's fields (intake), a waiting item (the intake queue), an
 * imported row on a phone. Every review surface is a list of these, so a
 * decision reads the same wherever it arrives.
 *
 *   LABEL   marks (kind · safety · decision)            [Accept] [Reject]
 *   meta line (mono, muted)
 *   NOW ─────────────────────── │ PROPOSED ───────────────────────────
 *   the value on the record       the value research found (+ what it adds)
 *   SOURCES  ● "verbatim quote" host   ■ "quote" host  Quote not found
 *   a note, when the card cannot be decided here and why
 *
 * The actions sit on the label row, so a card costs one line more than its
 * content; before/after sit side by side from `md` and stack on a phone.
 * Cards are separated by a rule, never boxed. A safety card carries a
 * bad-tone start rule, a card waiting on a decision a warn-tone one, and a
 * decided card fades. Values are text — never HTML or Markdown (refresh spec
 * §8): they come from web pages.
 *
 * Layout only; the caller owns the decision and its state.
 */

export type ReviewTone = "default" | "safety" | "warn" | "settled";

export interface ReviewCardProps {
  /** The card's name: its heading's text and the article's accessible name. */
  label: string;
  /** The heading's content when it is more than the label (a link to the item). Defaults to `label`. */
  title?: ReactNode;
  /** The heading level in the page's outline. */
  headingLevel?: 3 | 4;
  tone?: ReviewTone;
  /** `StatusGlyph`s beside the label. */
  marks?: ReactNode;
  /** `Button`s at the end of the label row. */
  actions?: ReactNode;
  /** A thumbnail before the label. */
  media?: ReactNode;
  /** One mono line under the label row: who, when, what it was identified as. */
  meta?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** `section` when the card is a region of the page rather than one of a list. */
  as?: "article" | "section";
}

export function ReviewCard({
  as: Root = "article",
  label,
  title,
  headingLevel = 4,
  tone = "default",
  marks,
  actions,
  media,
  meta,
  children,
  className,
}: ReviewCardProps) {
  const Heading = headingLevel === 3 ? "h3" : "h4";
  return (
    <Root
      aria-label={label}
      data-slot="review-card"
      data-tone={tone}
      className={cn(
        "ui flex flex-col gap-2 border-b border-rule border-s-2 py-3 ps-3 pe-1",
        tone === "safety" && "border-s-bad",
        tone === "warn" && "border-s-warn",
        tone === "default" && "border-s-transparent",
        tone === "settled" && "border-s-transparent opacity-70",
        className
      )}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {media}
        <Heading className="m-0 font-mono text-label font-medium text-foreground uppercase">{title ?? label}</Heading>
        {marks ? <div className="flex flex-wrap items-center gap-x-3 gap-y-1">{marks}</div> : null}
        {actions ? <div className="ms-auto flex flex-wrap items-center gap-1.5">{actions}</div> : null}
      </header>
      {meta ? (
        <p className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-micro tracking-[0.06em] text-muted-foreground uppercase">
          {meta}
        </p>
      ) : null}
      {children}
    </Root>
  );
}

export interface ReviewValue {
  label: string;
  content: ReactNode;
  /** A line under the value: what the proposal adds. */
  note?: ReactNode;
}

/**
 * Before and after, side by side from `md`, stacked on a phone. The record's
 * value is muted; the proposed one is ink behind an accent rule. Without
 * `before` (a new item has no record yet) the proposed side is the whole card.
 */
export function ReviewValues({ before, after }: { before?: ReviewValue; after: ReviewValue }) {
  return (
    <div className={cn("grid grid-cols-1 gap-x-6 gap-y-2 text-table", before && "md:grid-cols-2")}>
      {before ? (
        <div className="min-w-0">
          <span className="block font-mono text-micro tracking-[0.08em] text-muted-foreground uppercase">{before.label}</span>
          <div className="text-muted-foreground">{before.content}</div>
          {before.note ? <div className="mt-1 text-xs text-muted-foreground">{before.note}</div> : null}
        </div>
      ) : null}
      <div className="min-w-0 border-s border-primary-ink/50 ps-3">
        <span className="block font-mono text-micro tracking-[0.08em] text-primary-ink uppercase">{after.label}</span>
        <div className="text-foreground">{after.content}</div>
        {after.note ? <div className="mt-1 text-xs text-muted-foreground">{after.note}</div> : null}
      </div>
    </div>
  );
}

export interface ReviewSource {
  quote: string;
  url: string;
  host: string;
  verified: boolean;
}

/**
 * Sources as verbatim quotes, each with its page's host and a glyph: ● the
 * quote was found on the page, ■ it was not — struck through, and said in
 * words (`notFoundLabel`), because colour is never the only signal.
 */
export function ReviewSources({
  label,
  items,
  notFoundLabel,
}: {
  label: string;
  items: ReviewSource[];
  notFoundLabel: string;
}) {
  return (
    <div className="flex flex-col gap-1 text-xs leading-snug">
      <span className="font-mono text-micro tracking-[0.08em] text-muted-foreground uppercase">{label}</span>
      <ol className="flex flex-col gap-1">
        {items.map((item, n) => (
          <li
            key={`${item.url}|${n}`}
            data-verified={item.verified}
            className={cn("flex flex-wrap items-baseline gap-x-2", !item.verified && "text-muted-foreground")}
          >
            <Glyph tone={item.verified ? "ok" : "bad"} />
            <q className={cn("font-mono text-xs", !item.verified && "line-through decoration-bad/60")}>{item.quote}</q>
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="text-muted-foreground underline decoration-border underline-offset-2 hover:text-primary-ink"
            >
              {item.host}
            </a>
            {item.verified ? null : <span className="text-bad">{notFoundLabel}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * A line of prose on a card or a review page: why, what cannot be decided
 * here, an outcome. `role="status"` / `"alert"` make it the page's live
 * outcome line (DESIGN.md §8.9) — rendered even when empty, so a screen reader
 * hears the next outcome where it heard the last.
 */
export function ReviewNote({
  tone = "muted",
  role,
  className,
  children,
}: {
  tone?: "muted" | "ink" | "warn" | "bad";
  role?: "status" | "alert";
  className?: string;
  children?: ReactNode;
}) {
  return (
    <p
      role={role}
      data-tone={tone}
      className={cn(
        "m-0 text-xs leading-snug empty:hidden",
        tone === "muted" && "text-muted-foreground",
        tone === "ink" && "text-foreground",
        tone === "warn" && "text-warn",
        tone === "bad" && "text-bad",
        className
      )}
    >
      {children}
    </p>
  );
}

/**
 * A diagnosis somebody has to read (a research run that failed): a mono
 * label and the text as it was recorded, behind a bad-tone rule.
 */
export function ReviewDiagnosis({ label, children, lang }: { label: string; children: ReactNode; lang?: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-s-2 border-s-bad bg-muted px-3 py-2">
      <p className="font-mono text-micro tracking-[0.08em] text-bad uppercase">{label}</p>
      <p lang={lang} className="font-mono text-xs break-words text-foreground">
        {children}
      </p>
    </div>
  );
}

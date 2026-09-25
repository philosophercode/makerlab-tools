import { cn } from "@/lib/utils";
import { Glyph } from "../StatusGlyph";

/**
 * The review primitive (UI system spec §6.6): one thing a person decides —
 * a field research proposes (refresh, chat), a researched item (intake), an
 * imported row (import). Every review surface in the app is a list of these,
 * so they read the same wherever a decision arrives.
 *
 * Anatomy, one decision per card:
 *
 *   LABEL   marks (kind · safety · decision)            [Accept] [Reject]
 *   NOW ─────────────────────── │ PROPOSED ───────────────────────────
 *   the value on the record       the value research found (+ what it adds)
 *   SOURCES  "verbatim quote" — host   ✗ quote not found
 *   a note, when the card cannot be decided here and why
 *
 * The actions sit on the label row, so a card costs one line more than its
 * content; the before/after pair is side by side on a desktop and stacked on
 * a phone. Values are text — never HTML or Markdown (refresh spec §8).
 *
 * These are layout parts with no state; the caller owns the decision.
 */

export type ReviewTone = "default" | "safety" | "settled";

export function ReviewCard({
  label,
  tone = "default",
  marks,
  actions,
  children,
  className,
}: {
  label: string;
  tone?: ReviewTone;
  marks?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <article
      aria-label={label}
      className={cn(
        "ui flex flex-col gap-2 border-b border-rule py-3 pr-1 pl-3",
        tone === "safety" && "border-l-2 border-l-bad",
        tone === "default" && "border-l-2 border-l-transparent",
        tone === "settled" && "border-l-2 border-l-transparent opacity-70",
        className
      )}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h4 className="m-0 font-mono text-[11px] font-medium tracking-[0.08em] text-foreground uppercase">{label}</h4>
        {marks ? <div className="flex flex-wrap items-center gap-x-3 gap-y-1">{marks}</div> : null}
        {actions ? <div className="ml-auto flex items-center gap-1.5">{actions}</div> : null}
      </header>
      {children}
    </article>
  );
}

export function ReviewValues({
  before,
  after,
}: {
  before: { label: string; content: React.ReactNode };
  after: { label: string; content: React.ReactNode; note?: React.ReactNode };
}) {
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-2 text-[14px] leading-snug md:grid-cols-2">
      <div className="min-w-0">
        <span className="block font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">{before.label}</span>
        <div className="text-muted-foreground">{before.content}</div>
      </div>
      <div className="min-w-0 border-l border-primary-ink/50 pl-3">
        <span className="block font-mono text-[10px] tracking-[0.08em] text-primary-ink uppercase">{after.label}</span>
        <div className="text-foreground">{after.content}</div>
        {after.note ? <div className="mt-1 text-[12px] text-muted-foreground">{after.note}</div> : null}
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
    <div className="flex flex-col gap-1 text-[12px] leading-snug">
      <span className="font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">{label}</span>
      <ol className="m-0 flex list-none flex-col gap-1 p-0">
        {items.map((item, n) => (
          <li key={n} className={cn("[&>*+*]:ml-2", !item.verified && "text-muted-foreground")}>
            <Glyph tone={item.verified ? "ok" : "bad"} />
            <q className={cn("font-mono text-[12px]", !item.verified && "line-through decoration-bad/60")}>{item.quote}</q>
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

export function ReviewNote({ tone = "muted", children }: { tone?: "muted" | "warn" | "bad"; children: React.ReactNode }) {
  return (
    <p
      className={cn(
        "m-0 text-[12px] leading-snug",
        tone === "muted" && "text-muted-foreground",
        tone === "warn" && "text-warn",
        tone === "bad" && "text-bad"
      )}
    >
      {children}
    </p>
  );
}

import Link from "next/link";
import { cn } from "@/lib/utils";
import { Sparkline } from "./Sparkline";
import { Glyph, type StatusTone } from "./StatusGlyph";

/**
 * A surface on the `/admin` home (UI system spec §6.1): the whole tile is the
 * link, and it answers "is there work here?" before it is opened.
 *
 * Reading order, top to bottom: what it is (icon + mono title) → the one number
 * that matters, large and tabular, with the word that says what it counts →
 * up to three supporting facts as `label value` lines → a 30-day sparkline
 * when a trend matters. A zero is shown as a zero, in the muted ink: "nothing
 * waiting" is information, and a missing number would read as "not loaded".
 */
export interface TileFact {
  label: string;
  value: number | string;
  tone?: StatusTone;
}

export interface TileProps {
  href: string;
  icon: React.ReactNode;
  title: string;
  /** The headline count, or null when it could not be read (never a fake 0). */
  value: number | null;
  /** What the headline counts, e.g. "waiting for review". */
  unit: string;
  /** When the headline is work for a person, the accent marks it. */
  attention?: boolean;
  facts?: TileFact[];
  series?: { values: readonly number[]; label: string; caption: string };
  /** Said instead of the number when `value` is null: why it is missing, or a status. */
  note?: string;
}

export function Tile({ href, icon, title, value, unit, attention = false, facts = [], series, note }: TileProps) {
  return (
    <Link
      href={href}
      className={cn(
        "ui group relative flex flex-col gap-3 border border-border bg-card p-4 transition-colors duration-150",
        "hover:border-foreground/35 hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
        attention && "border-l-2 border-l-primary-ink"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] tracking-[0.08em] text-muted-foreground uppercase group-hover:text-foreground">
          {title}
        </span>
        <span aria-hidden="true" className="text-muted-foreground group-hover:text-primary-ink [&_svg]:size-4">
          {icon}
        </span>
      </div>

      <div className="flex items-baseline gap-2">
        {value === null ? (
          <span className="text-[13px] text-muted-foreground">{note}</span>
        ) : (
          <>
            <span
              className={cn(
                "font-heading text-[40px] leading-none font-medium tabular-nums",
                value === 0 ? "text-muted-foreground/70" : attention ? "text-primary-ink" : "text-foreground"
              )}
            >
              {value}
            </span>
            <span className="text-[13px] leading-tight text-muted-foreground">{unit}</span>
          </>
        )}
      </div>

      {facts.length > 0 ? (
        <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-[12px] leading-snug">
          {facts.map((fact) => (
            <div key={fact.label} className="contents">
              <dt className="text-muted-foreground">
                <Glyph tone={fact.tone ?? "muted"} className={fact.tone ? undefined : "invisible"} />
                {fact.label}
              </dt>
              <dd className="m-0 text-right font-mono tabular-nums">{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {series ? (
        <div className="mt-auto flex items-end justify-between gap-2 pt-1">
          <Sparkline values={series.values} label={series.label} width={120} height={18} />
          <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground uppercase">{series.caption}</span>
        </div>
      ) : null}
    </Link>
  );
}

/** A labelled group of tiles — one job ("Add equipment", "Queues"). */
export function TileGroup({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="ui flex flex-col gap-2">
      <h3 id={id} className="font-mono text-[11px] font-medium tracking-[0.1em] text-muted-foreground uppercase">
        <span aria-hidden="true" className="text-primary-ink">
          {"// "}
        </span>
        {title}
      </h3>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

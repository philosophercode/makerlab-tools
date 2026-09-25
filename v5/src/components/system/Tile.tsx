import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Sparkline } from "./Sparkline";
import { Glyph, type StatusTone } from "./StatusGlyph";

/**
 * A surface on the `/admin` home (UI system spec §7.2, §8.1; DESIGN.md §8.2):
 * the whole tile is the link, and it answers "is there work here?" before it
 * is opened.
 *
 * Reading order: what it is (mono title + icon) → the one number that
 * matters, large and tabular, with the words that say what it counts → up to
 * four facts (`glyph label ……… value`) → a 30-day sparkline when a trend
 * matters. The accent (start rule and number) marks **work waiting for a
 * person** and nothing else; a zero is a muted zero, because "nothing
 * waiting" is information.
 *
 * **Unreadable is not zero.** `value: null` says `note` ("Could not be read",
 * or a state such as "Not connected") where the number would be, and shows no
 * facts or trend that would imply one.
 *
 * The link's accessible name is the title alone; the number and facts are its
 * description, so "Inventory" is one stop in a screen reader's links list and
 * the counts are read after it.
 */
export interface TileFact {
  label: string;
  value: number | string;
  tone?: StatusTone;
}

export interface TileProps {
  /** Page-unique: it ties the link's name to the title and its description to the counts. */
  id: string;
  href: string;
  icon?: ReactNode;
  title: string;
  /** The headline count, or null when it could not be read (never a fake 0). */
  value: number | null;
  /** What the headline counts ("researched, waiting for you"). */
  unit?: string;
  /** The headline is work waiting for a person: the accent marks it. */
  waiting?: boolean;
  facts?: readonly TileFact[];
  series?: { values: readonly number[]; label: string; caption: string };
  /** Said instead of the number when `value` is null: why it is missing, or a state. */
  note?: string;
}

export function Tile({ id, href, icon, title, value, unit, waiting = false, facts = [], series, note }: TileProps) {
  const accent = waiting && value !== null && value > 0;
  return (
    <Link
      href={href}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-body`}
      data-slot="tile"
      data-waiting={accent || undefined}
      className={cn(
        "ui group flex flex-col gap-3 border border-border border-s-2 bg-card p-4 transition-colors duration-150",
        "hover:border-foreground/35 hover:bg-accent/40",
        accent ? "border-s-primary-ink" : "border-s-border"
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span
          id={`${id}-title`}
          className="font-mono text-label tracking-[0.08em] text-muted-foreground uppercase group-hover:text-foreground"
        >
          {title}
        </span>
        {icon ? (
          <span aria-hidden="true" className="text-muted-foreground group-hover:text-primary-ink [&_svg]:size-4">
            {icon}
          </span>
        ) : null}
      </span>

      <span id={`${id}-body`} className="flex flex-col gap-3">
        <span className="flex items-baseline gap-2">
          {value === null ? (
            <span className="text-table text-muted-foreground">{note}</span>
          ) : (
            <>
              <span
                data-slot="tile-value"
                className={cn(
                  "font-heading text-[40px] leading-none font-medium tabular-nums",
                  value === 0 ? "text-muted-foreground/70" : accent ? "text-primary-ink" : "text-foreground"
                )}
              >
                {value}
              </span>{" "}
              {unit ?<span className="text-table leading-tight text-muted-foreground">{unit}</span> : null}
            </>
          )}
        </span>

        {value !== null && facts.length > 0 ? (
          <span className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-xs leading-snug">
            {facts.map((fact) => (
              <span key={fact.label} className="contents">
                <span className="text-muted-foreground">
                  <Glyph tone={fact.tone ?? "muted"} className={cn("me-1.5", fact.tone ? undefined : "invisible")} />
                  {fact.label}
                  {/* Heard as "In progress: 1," — the grid lays the two out as columns. */}
                  <span className="sr-only">: </span>
                </span>{" "}
                <span className="text-end font-mono tabular-nums">
                  {fact.value}
                  <span className="sr-only">, </span>
                </span>
              </span>
            ))}
          </span>
        ) : null}

        {value !== null && series ? (
          <span className="mt-auto flex items-end justify-between gap-2 pt-1">
            <Sparkline values={series.values} label={series.label} width={120} height={18} />
            <span className="font-mono text-micro tracking-[0.06em] text-muted-foreground uppercase">{series.caption}</span>
          </span>
        ) : null}
      </span>
    </Link>
  );
}

/** One job's tiles ("Add equipment", "Queues"), under a mono `// ` heading. */
export function TileGroup({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} data-slot="tile-group" className="ui flex flex-col gap-2">
      <h3 id={id} className="m-0 font-mono text-label font-medium tracking-[0.1em] text-muted-foreground uppercase">
        <span aria-hidden="true" className="text-primary-ink">
          {"// "}
        </span>
        {title}
      </h3>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

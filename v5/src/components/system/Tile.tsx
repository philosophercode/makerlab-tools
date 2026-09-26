import type { CSSProperties, ReactNode } from "react";
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
 * four facts → a 30-day sparkline when a trend matters. The accent (start
 * rule and number) marks **work waiting for a person** and nothing else; a
 * zero is a muted zero, because "nothing waiting" is information.
 *
 * **Unreadable is not zero.** `value: null` says `note` ("Could not be read",
 * or a state such as "Not connected") where the number would be, and shows no
 * facts or trend that would imply one.
 *
 * The link's accessible name is the title alone; the number and facts are its
 * description, so "Inventory" is one stop in a screen reader's links list and
 * the counts are read after it.
 *
 * **One anatomy** (owner, 2026-09-25). A tile fills the height its grid row
 * gives it, so tiles side by side share their top and bottom edges; inside,
 * the parts always sit in the same places — label row, number and what it
 * counts on one baseline, the facts table, and the trend pinned to the foot.
 * A **half** tile (`size="half"`) is for a surface with only a number or a
 * state (People, the mirror, Projects with nothing waiting): the home pairs
 * two of them in one cell (`pairHalves`). It never draws a trend.
 *
 * **Facts are a table** (DESIGN.md §8.2): `glyph | label | value` on every
 * row, the glyph column reserved even when it is empty, so labels start at one
 * x and numbers end at one x. The glyph follows `factGlyph` (DESIGN.md §8.5):
 * warn, bad and active only, and only on a non-zero row. A zero is muted.
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
  /** `half` for a tile with only a number or a state (DESIGN.md §8.2). */
  size?: "full" | "half";
}

export function Tile({ id, href, icon, title, value, unit, waiting = false, facts = [], series, note, size = "full" }: TileProps) {
  const accent = waiting && value !== null && value > 0;
  const half = size === "half";
  return (
    <Link
      href={href}
      id={id}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-body`}
      data-slot="tile"
      data-waiting={accent || undefined}
      data-size={size}
      className={cn(
        "ui group flex h-full min-h-0 flex-col border border-border border-s-2 bg-card transition-colors duration-150",
        half ? "gap-2 px-4 py-3" : "gap-3 p-4",
        "hover:border-foreground/35 hover:bg-accent/40",
        accent ? "border-s-primary-ink" : "border-s-border"
      )}
    >
      <span data-slot="tile-label" className="flex items-center justify-between gap-2">
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

      <span id={`${id}-body`} className={cn("flex flex-1 flex-col", half ? "gap-2" : "gap-3")}>
        <span data-slot="tile-headline" className="flex items-baseline gap-2">
          {value === null ? (
            <span className="text-table text-muted-foreground">{note}</span>
          ) : (
            <>
              <span
                data-slot="tile-value"
                className={cn(
                  "font-heading leading-none font-medium tabular-nums",
                  half ? "text-[28px]" : "text-[40px]",
                  value === 0 ? "text-muted-foreground/70" : accent ? "text-primary-ink" : "text-foreground"
                )}
              >
                {value}
              </span>{" "}
              {unit ? <span className="text-table leading-tight text-muted-foreground">{unit}</span> : null}
            </>
          )}
        </span>

        {value !== null && facts.length > 0 ? (
          <span
            data-slot="tile-facts"
            className="grid max-w-sm grid-cols-[0.75rem_minmax(0,1fr)_auto] items-baseline gap-x-2 gap-y-0.5 text-xs leading-snug"
          >
            {facts.map((fact) => {
              const glyph = factGlyph(fact);
              return (
                <span key={fact.label} data-slot="tile-fact" data-glyph={glyph ?? undefined} className="contents">
                  {/* Reserved on every row, glyph or not, so every label starts at the same x. */}
                  <span data-slot="tile-fact-glyph" className="text-center">
                    {glyph ? <Glyph tone={glyph} /> : null}
                  </span>
                  <span data-slot="tile-fact-label" className="min-w-0 text-muted-foreground">
                    {fact.label}
                    {/* Heard as "In progress: 1," — the grid lays the two out as columns. */}
                    <span className="sr-only">: </span>
                  </span>{" "}
                  <span
                    data-slot="tile-fact-value"
                    className={cn("text-end font-mono tabular-nums", fact.value === 0 && "text-muted-foreground/70")}
                  >
                    {fact.value}
                    <span className="sr-only">, </span>
                  </span>
                </span>
              );
            })}
          </span>
        ) : null}

        {value !== null && series && !half ? (
          // Pinned to the tile's foot, so trends side by side share a baseline.
          <span data-slot="tile-trend" className="mt-auto flex items-end justify-between gap-2 pt-1">
            <Sparkline values={series.values} label={series.label} width={120} height={22} />
            <span className="font-mono text-micro tracking-[0.06em] text-muted-foreground uppercase">{series.caption}</span>
          </span>
        ) : null}
      </span>
    </Link>
  );
}

/** The tones a fact may mark; the rest (ok, idle, muted) say nothing the row's words don't. */
const FACT_TONES: ReadonlySet<StatusTone> = new Set<StatusTone>(["warn", "bad", "active"]);

/**
 * The glyph a fact row shows, or null for none (DESIGN.md §8.5): ▲ warn, ■ bad
 * and ◆ active, and only when the row is non-zero — a count above 0, or a
 * sentence such as "Could not be read". A zero or neutral row has no glyph,
 * and in-progress has no tone to give it one.
 */
export function factGlyph(fact: Pick<TileFact, "value" | "tone">): StatusTone | null {
  if (!fact.tone || !FACT_TONES.has(fact.tone)) return null;
  if (typeof fact.value === "number" && fact.value <= 0) return null;
  return fact.tone;
}

/**
 * One cell of a group: a tile, or two half tiles sharing one (DESIGN.md §8.2).
 * Consecutive halves pair in order; a lone half keeps a cell of its own.
 */
export type TileCellOf<T> = { kind: "one"; item: T } | { kind: "pair"; items: [T, T] };

export function pairHalves<T>(items: readonly T[], isHalf: (item: T) => boolean): TileCellOf<T>[] {
  const cells: TileCellOf<T>[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const next = items[i + 1];
    if (next !== undefined && isHalf(item) && isHalf(next)) {
      cells.push({ kind: "pair", items: [item, next] });
      i += 1;
    } else {
      cells.push({ kind: "one", item });
    }
  }
  return cells;
}

/** The home's column counts by breakpoint: one on a phone, two from `sm`, four from `xl`. */
const COLUMNS = { sm: 2, xl: 4 } as const;

/**
 * How a group of `cells` cells lies in the home's grid at `columns` columns:
 * the columns it spans (its cells, at most the grid's width) and its row
 * tracks — the heading's, and one per row of cells.
 */
export function groupSpan(cells: number, columns: number): { columns: number; rows: number } {
  const count = Math.max(1, cells);
  const across = Math.min(count, columns);
  return { columns: across, rows: 1 + Math.ceil(count / across) };
}

/**
 * One job's tiles ("Add equipment", "Queues"), under a mono `// ` heading.
 *
 * On a phone it is a plain column. From `sm` it is a **band**: a subgrid of
 * the home's grid (`TileGrid`) spanning as many columns as it has `cells` —
 * the whole width at two columns — with its heading across them on the first
 * row and its cells on the rows below. Groups side by side share their
 * heading row and their tile row, so the headings line up, every tile in a
 * row is the same height, and no column is left empty under a short group.
 */
export function TileGroup({ id, title, cells, children }: { id: string; title: string; cells: number; children: ReactNode }) {
  // At two columns every group is a full-width band (a lone cell spans both).
  const sm = { columns: COLUMNS.sm, rows: groupSpan(cells, COLUMNS.sm).rows };
  const xl = groupSpan(cells, COLUMNS.xl);
  const style = {
    "--tile-cols-sm": sm.columns,
    "--tile-rows-sm": sm.rows,
    "--tile-cols-xl": xl.columns,
    "--tile-rows-xl": xl.rows,
  } as CSSProperties;
  return (
    <section
      aria-labelledby={id}
      data-slot="tile-group"
      data-cells={cells}
      className={cn(
        "ui flex flex-col gap-2",
        "sm:grid sm:grid-cols-subgrid sm:grid-rows-subgrid sm:gap-x-4 sm:gap-y-2",
        "sm:[grid-column:span_var(--tile-cols-sm)] sm:[grid-row:span_var(--tile-rows-sm)]",
        "xl:[grid-column:span_var(--tile-cols-xl)] xl:[grid-row:span_var(--tile-rows-xl)]"
      )}
      style={style}
    >
      <h3
        id={id}
        className="m-0 font-mono text-label font-medium tracking-[0.1em] text-muted-foreground uppercase sm:col-span-full sm:self-end sm:pt-4"
      >
        <span aria-hidden="true" className="text-primary-ink">
          {"// "}
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * The home's tile grid: one column on a phone, two from `sm`, four from `xl`,
 * with the groups laid in as bands (see `TileGroup`).
 */
export function TileGrid({ children }: { children: ReactNode }) {
  return (
    <div data-slot="tile-grid" className="ui flex flex-col gap-8 sm:grid sm:grid-cols-2 sm:gap-x-4 sm:gap-y-2 xl:grid-cols-4">
      {children}
    </div>
  );
}

/**
 * A cell in a group's band — one tile, or a `pair` of half tiles — stretched
 * to its row, so tiles side by side share their edges. `wide` marks the last
 * cell of a group with an odd number of them: at two columns it spans both,
 * so the band stays rectangular (at four columns it is one column, as ever).
 * A pair stacks its halves, or sets them side by side when the cell is wide.
 */
export function TileCell({ pair = false, wide = false, children }: { pair?: boolean; wide?: boolean; children: ReactNode }) {
  return (
    <div
      data-slot="tile-cell"
      data-pair={pair || undefined}
      data-wide={wide || undefined}
      className={cn(
        "min-h-0",
        wide && "sm:col-span-2 xl:col-span-1",
        pair && "flex flex-col gap-2 *:h-auto *:flex-[1_0_auto]",
        pair && wide && "sm:flex-row sm:gap-x-4 xl:flex-col"
      )}
    >
      {children}
    </div>
  );
}

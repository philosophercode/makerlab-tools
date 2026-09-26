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
 *
 * **Two sizes, one grid** (owner, 2026-09-25). A tile fills the height its
 * grid row gives it, so tiles side by side share their top and bottom edges;
 * inside, the parts always sit in the same places — title row, number and
 * what it counts, facts, and the trend pinned to the bottom. A **half** tile
 * (`size="half"`) is for a surface with only a number or a state (People, the
 * mirror, Projects with nothing waiting): it takes half a row, and the home
 * pairs two of them so the grid stays rectangular. It never draws a trend.
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

      <span id={`${id}-body`} className={cn("flex flex-1 flex-col", half ? "gap-2" : "gap-3")}>
        <span className="flex items-baseline gap-2">
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

        {value !== null && series && !half ? (
          // Pinned to the tile's foot, so trends side by side share a baseline.
          <span className="mt-auto flex items-end justify-between gap-2 pt-1">
            <Sparkline values={series.values} label={series.label} width={120} height={22} />
            <span className="font-mono text-micro tracking-[0.06em] text-muted-foreground uppercase">{series.caption}</span>
          </span>
        ) : null}
      </span>
    </Link>
  );
}

/**
 * One job's tiles ("Add equipment", "Queues"), under a mono `// ` heading.
 *
 * On a phone it is a plain column. From `sm` it is a **subgrid** of the home's
 * row grid (`TileGrid`): its heading takes the first row and each tile spans
 * two rows (a half tile one), so the rows' heights are shared by every group
 * and tiles in the same row line up across groups. `rows` is how many row
 * tracks the group spans — the heading plus the tallest group's tiles.
 */
export function TileGroup({ id, title, rows, children }: { id: string; title: string; rows?: number; children: ReactNode }) {
  return (
    <section
      aria-labelledby={id}
      data-slot="tile-group"
      className="ui flex flex-col gap-2 sm:grid sm:grid-rows-subgrid sm:gap-y-2"
      style={rows ? { gridRow: `span ${rows} / span ${rows}` } : undefined}
    >
      <h3 id={id} className="m-0 font-mono text-label font-medium sm:self-end sm:pt-4 tracking-[0.1em] text-muted-foreground uppercase">
        <span aria-hidden="true" className="text-primary-ink">
          {"// "}
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}

/** How many row tracks a tile takes in `TileGroup`'s subgrid: two, or one for a half tile. */
export function tileRows(size: TileProps["size"]): number {
  return size === "half" ? 1 : 2;
}

/**
 * The home's tile grid: one column on a phone, two from `sm`, four from `xl`,
 * with the groups laid in as subgrids (see `TileGroup`).
 */
export function TileGrid({ children }: { children: ReactNode }) {
  return <div className="ui flex flex-col gap-8 sm:grid sm:grid-cols-2 sm:gap-x-4 sm:gap-y-2 xl:grid-cols-4">{children}</div>;
}

/** A tile's cell in the group's subgrid: it spans its rows and stretches to fill them. */
export function TileCell({ size, children }: { size: TileProps["size"]; children: ReactNode }) {
  const rows = tileRows(size);
  return (
    <div data-slot="tile-cell" className="min-h-0" style={{ gridRow: `span ${rows} / span ${rows}` }}>
      {children}
    </div>
  );
}

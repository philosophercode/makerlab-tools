import type { SurfaceKey } from "../../lib/admin/surfaces";
import type { OverviewCounts } from "../../lib/data/admin-overview";
import type { TileFact, TileProps } from "../system/Tile";

/**
 * What each surface's tile on `/admin` says, from its count loader's numbers
 * (UI system spec §8.1; DESIGN.md §8.2): the headline number and what it
 * counts, whether that number is **work waiting for a person** (the accent),
 * up to four facts, and a 30-day sparkline where a trend matters — tickets,
 * corrections and intake, the three that move daily.
 *
 * `counts` is `undefined` when not asked for and `null` when the loader
 * failed; either way the tile says "Could not be read" and shows no number,
 * facts or trend that would imply one (Article 4).
 *
 * Pure: the page passes its translator (`admin`), so this is testable without
 * a request.
 */

export type TileContent = Pick<TileProps, "value" | "unit" | "waiting" | "facts" | "series" | "note" | "size">;

type Translate = (key: string, values?: Record<string, string | number>) => string;

type CountsFor = { [K in SurfaceKey]: OverviewCounts[LoaderOf<K>] };
type LoaderOf<K extends SurfaceKey> = K extends "research" ? "manuals" : K extends keyof OverviewCounts ? K : never;

/**
 * The extra counts a tile carries beside its own (`AdminSurface.alsoCounts`):
 * Intake's imports. Absent when the viewer may not read them, `null` when the
 * loader failed.
 */
export interface ExtraCounts {
  imports?: OverviewCounts["imports"] | null;
}

export interface TileResult {
  content: TileContent;
  /** The loader failed (or was not run): the number is missing, not zero. */
  unreadable: boolean;
  /**
   * Work waiting for a person that the tile states as a fact rather than as
   * its headline — Intake's imported lists ready for review — so the home's
   * "items waiting on you" still counts it.
   */
  alsoWaiting: number;
}

export function tileContent<K extends SurfaceKey>(
  key: K,
  counts: CountsFor[K] | null | undefined,
  t: Translate,
  extra: ExtraCounts = {}
): TileResult {
  if (!counts) return { content: { value: null, note: t("home.unavailable"), size: "half" }, unreadable: true, alsoWaiting: 0 };
  const content = BUILDERS[key](counts as never, t, extra);
  const alsoWaiting = key === "intake" && extra.imports ? extra.imports.ready : 0;
  return { content, unreadable: false, alsoWaiting };
}

const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

/**
 * Each tile's size (DESIGN.md §8.2): **full** when it has facts or a trend to
 * show, **half** when all it has is a number or a state — People, the Notion
 * mirror, Projects with nothing waiting, and any tile whose count could not be
 * read. The home pairs half tiles so its rows stay rectangular.
 *
 * A fact's tone is what the row means **when it is non-zero** — warn, bad, or
 * active for work waiting on you — and a neutral or in-progress row has none
 * (DESIGN.md §8.5). `Tile` draws no glyph on a zero (`factGlyph`).
 */
const BUILDERS: { [K in SurfaceKey]: (counts: CountsFor[K], t: Translate, extra: ExtraCounts) => TileContent } = {
  intake: (c, t, extra) => ({
    value: c.researched,
    unit: t("home.intakeUnit"),
    waiting: true,
    facts: [
      fact(t("home.intakeIdentified"), c.identified, "active"),
      fact(t("home.intakeResearching"), c.researching),
      fact(t("home.intakeFailed"), c.failed, "bad"),
      // Importing a list is part of Intake (amendment 2026-09-25): its lists
      // waiting for review are a line here, not a tile of their own. Said as
      // unreadable when its loader failed, never as 0.
      ...(extra.imports === undefined
        ? []
        : extra.imports === null
          ? [{ label: t("home.intakeImports"), value: t("home.unavailable"), tone: "bad" as const }]
          : [fact(t("home.intakeImports"), extra.imports.ready, "active")]),
    ],
    series: { values: c.series, caption: t("home.seriesCaption"), label: t("home.intakeSeries", { total: sum(c.series) }) },
  }),
  inventory: (c, t) => ({
    value: c.needsAttention,
    // "of 104 tools", with Published beside it: the header's "100 tools in
    // inventory" counts the published ones, and the two must not look like a
    // contradiction (owner, 2026-09-25).
    unit: t("home.inventoryUnit", { total: c.total }),
    facts: [
      fact(t("home.inventoryPublished"), c.published),
      fact(t("home.inventoryUnpublished"), c.draft + c.archived),
      fact(t("home.inventoryNoPhoto"), c.noPhoto, "warn"),
      fact(t("home.inventoryNoManual"), c.noManual, "warn"),
      fact(t("home.inventoryNeverReviewed"), c.neverReviewed, "warn"),
    ],
  }),
  refresh: (c, t) => ({
    value: c.proposed,
    unit: t("home.refreshUnit"),
    waiting: true,
    facts: [
      fact(t("home.refreshRunning"), c.running),
      fact(t("home.refreshFailed"), c.failed, "bad"),
    ],
  }),
  research: (c, t) => ({
    value: c.searchable,
    unit: t("home.manualsUnit"),
    facts: [fact(t("home.manualsTotal"), c.total), fact(t("home.manualsFailed"), c.failed, "bad")],
  }),
  maintenance: (c, t) => ({
    value: c.open,
    unit: t("home.maintenanceUnit"),
    waiting: true,
    facts: [
      fact(t("home.maintenanceInProgress"), c.inProgress),
      fact(t("home.maintenanceUrgent"), c.urgent, "bad"),
    ],
    series: {
      values: c.series,
      caption: t("home.seriesCaption"),
      label: t("home.maintenanceSeries", { total: sum(c.series), today: c.series.at(-1) ?? 0 }),
    },
  }),
  corrections: (c, t) => ({
    value: c.open,
    unit: t("home.correctionsUnit"),
    waiting: true,
    facts: [fact(t("home.correctionsHandled"), c.handled)],
    series: { values: c.series, caption: t("home.seriesCaption"), label: t("home.correctionsSeries", { total: sum(c.series) }) },
  }),
  // Nothing waiting is a number and nothing else: a half tile.
  projects: (c, t) => ({
    value: c.waiting,
    unit: t("home.projectsUnit"),
    waiting: true,
    facts: c.waiting > 0 ? [fact(t("home.projectsPublished"), c.published)] : [],
    size: c.waiting > 0 ? "full" : "half",
  }),
  // People: the number, and a ban only when there is one to see.
  users: (c, t) => ({
    value: c.total,
    unit: t("home.usersUnit"),
    facts: c.banned > 0 ? [fact(t("home.usersBanned"), c.banned, "warn")] : [],
    size: "half",
  }),
  // The mirror has no number, only a state — said where the number would be.
  mirror: (c, t) => ({ value: null, note: t(`home.mirror.${c.state}`), size: "half" }),
};

function fact(label: string, value: number, tone?: TileFact["tone"]): TileFact {
  return { label, value, tone };
}

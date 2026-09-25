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

export type TileContent = Pick<TileProps, "value" | "unit" | "waiting" | "facts" | "series" | "note">;

type Translate = (key: string, values?: Record<string, string | number>) => string;

type CountsFor = { [K in SurfaceKey]: OverviewCounts[LoaderOf<K>] };
type LoaderOf<K extends SurfaceKey> = K extends "import"
  ? "imports"
  : K extends "research"
    ? "manuals"
    : K extends keyof OverviewCounts
      ? K
      : never;

export interface TileResult {
  content: TileContent;
  /** The loader failed (or was not run): the number is missing, not zero. */
  unreadable: boolean;
}

export function tileContent<K extends SurfaceKey>(key: K, counts: CountsFor[K] | null | undefined, t: Translate): TileResult {
  if (!counts) return { content: { value: null, note: t("home.unavailable") }, unreadable: true };
  return { content: BUILDERS[key](counts as never, t), unreadable: false };
}

const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

const BUILDERS: { [K in SurfaceKey]: (counts: CountsFor[K], t: Translate) => TileContent } = {
  intake: (c, t) => ({
    value: c.researched,
    unit: t("home.intakeUnit"),
    waiting: true,
    facts: [
      fact(t("home.intakeIdentified"), c.identified, c.identified ? "active" : "idle"),
      fact(t("home.intakeResearching"), c.researching, "idle"),
      fact(t("home.intakeFailed"), c.failed, c.failed ? "bad" : "idle"),
    ],
    series: { values: c.series, caption: t("home.seriesCaption"), label: t("home.intakeSeries", { total: sum(c.series) }) },
  }),
  import: (c, t) => ({
    value: c.ready,
    unit: t("home.importUnit"),
    waiting: true,
    facts: [
      fact(t("home.importMapping"), c.mapping, c.mapping ? "active" : "idle"),
      fact(t("home.importLast30"), c.last30),
    ],
  }),
  inventory: (c, t) => ({
    value: c.needsAttention,
    unit: t("home.inventoryUnit"),
    facts: [
      fact(t("home.inventoryTotal"), c.total),
      fact(t("home.inventoryNoPhoto"), c.noPhoto, c.noPhoto ? "warn" : "ok"),
      fact(t("home.inventoryNoManual"), c.noManual, c.noManual ? "warn" : "ok"),
      fact(t("home.inventoryNeverReviewed"), c.neverReviewed, c.neverReviewed ? "warn" : "ok"),
    ],
  }),
  refresh: (c, t) => ({
    value: c.proposed,
    unit: t("home.refreshUnit"),
    waiting: true,
    facts: [
      fact(t("home.refreshRunning"), c.running, "idle"),
      fact(t("home.refreshFailed"), c.failed, c.failed ? "bad" : "idle"),
    ],
  }),
  research: (c, t) => ({
    value: c.searchable,
    unit: t("home.manualsUnit"),
    facts: [fact(t("home.manualsTotal"), c.total), fact(t("home.manualsFailed"), c.failed, c.failed ? "bad" : "idle")],
  }),
  maintenance: (c, t) => ({
    value: c.open,
    unit: t("home.maintenanceUnit"),
    waiting: true,
    facts: [
      fact(t("home.maintenanceInProgress"), c.inProgress, c.inProgress ? "warn" : "idle"),
      fact(t("home.maintenanceUrgent"), c.urgent, c.urgent ? "bad" : "idle"),
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
  projects: (c, t) => ({
    value: c.waiting,
    unit: t("home.projectsUnit"),
    waiting: true,
    facts: [fact(t("home.projectsPublished"), c.published)],
  }),
  users: (c, t) => ({
    value: c.total,
    unit: t("home.usersUnit"),
    facts: [fact(t("home.usersAdmins"), c.admins), fact(t("home.usersBanned"), c.banned, c.banned ? "warn" : "idle")],
  }),
  // The mirror has no number, only a state — said where the number would be.
  mirror: (c, t) => ({ value: null, note: t(`home.mirror.${c.state}`) }),
};

function fact(label: string, value: number, tone?: TileFact["tone"]): TileFact {
  return { label, value, tone };
}

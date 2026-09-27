import { cacheLife, cacheTag } from "next/cache";
import { CATALOG_CACHE } from "./cache";
import {
  countPublishedTools,
  findToolByIdOrSlug,
  listCatalogTools,
} from "./data/catalog";
import { listManualContentsForTool, type ManualContents } from "./data/manual-documents";
import { listMaintenanceHistoryForTool, type ToolMaintenanceEntry } from "./data/maintenance";
import { dataSubstrate, getDb } from "./db/client";
import type { CatalogStats, MakerLabTool } from "../components/catalog-types";
import type { PaletteTool } from "../components/palette/palette-types";

/**
 * The catalogue the app reads (spec §3.9, §3.10).
 *
 * Three cached entry points over `src/lib/data/catalog.ts`, which holds the SQL
 * and the row→view mapping. Everything is tagged `catalog`, so a write in a
 * later phase invalidates the whole catalogue with one `revalidateTag` rather
 * than waiting out a revalidation window (Article 4).
 *
 * There is deliberately no fallback. A Postgres failure propagates and the page
 * renders its error state: cached pages keep serving, and nothing ever invents
 * equipment the lab does not own. The demo seed is the substrate when
 * `DATABASE_URL` is unset, never a rescue when a configured database is down.
 */

/** True when the catalogue is the built-in demo seed rather than a real database. */
export function isDemoCatalog(): boolean {
  return dataSubstrate() === "pglite-demo";
}

export async function getCatalogTools(): Promise<MakerLabTool[]> {
  "use cache";
  cacheTag("catalog");
  cacheLife(CATALOG_CACHE);

  return listCatalogTools();
}

export async function getCatalogStats(): Promise<CatalogStats> {
  "use cache";
  cacheTag("catalog");
  cacheLife(CATALOG_CACHE);

  return {
    toolsInInventory: await countPublishedTools(),
    labHours: "LAB OPEN 9AM-9PM",
  };
}

/**
 * One tool by slug, or by the Postgres uuid capabilities pass back as
 * `tool.id`. Returns null when neither matches.
 */
export async function getCatalogTool(idOrSlug: string): Promise<MakerLabTool | null> {
  "use cache";
  cacheTag("catalog");
  cacheLife(CATALOG_CACHE);

  return findToolByIdOrSlug(idOrSlug);
}

/**
 * The tool page's manual **Contents** lists (manual text spec §6): each ready,
 * public manual PDF's outline, keyed by the link the page shows for it. Cached
 * with the catalogue; a manual processed after the page was cached appears
 * when the catalogue's cache next turns over.
 */
export async function getManualContents(toolId: string): Promise<ManualContents[]> {
  "use cache";
  cacheTag("catalog");
  cacheLife(CATALOG_CACHE);

  return listManualContentsForTool(await getDb(), toolId);
}

/**
 * The tool page's "Maintenance history" (UI system phase 5a): the ten most
 * recent logs across the tool's units, without names. Cached with the
 * catalogue — a maintenance write does not invalidate it, so a new ticket
 * appears when the catalogue's cache next turns over; the page says "recent".
 */
export async function getToolMaintenanceHistory(toolId: string): Promise<ToolMaintenanceEntry[]> {
  "use cache";
  cacheTag("catalog");
  cacheLife(CATALOG_CACHE);

  return listMaintenanceHistoryForTool(toolId, { db: await getDb(), limit: 10 });
}

/**
 * The ⌘K palette's tools for everybody (public polish): the published
 * catalogue, narrowed to what the palette matches on and groups by. Cached
 * with the catalogue, so it costs the root layout nothing after the first read.
 */
export async function getPaletteTools(): Promise<PaletteTool[]> {
  "use cache";
  cacheTag("catalog");
  cacheLife(CATALOG_CACHE);

  const tools = await getCatalogTools();
  return tools.map((tool) => ({
    id: tool.id,
    slug: tool.slug,
    name: tool.name,
    officialName: tool.officialName ?? null,
    category: tool.category || null,
    published: true,
  }));
}

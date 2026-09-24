import { cacheLife, cacheTag } from "next/cache";
import { CATALOG_CACHE } from "./cache";
import {
  countPublishedTools,
  findToolByIdOrSlug,
  listCatalogTools,
} from "./data/catalog";
import { listManualContentsForTool, type ManualContents } from "./data/manual-documents";
import { dataSubstrate, getDb } from "./db/client";
import type { CatalogStats, MakerLabTool } from "../components/catalog-types";

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

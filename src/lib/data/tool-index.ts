import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { tools } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";

/**
 * The admin ⌘K palette's tool list (UI system spec §7.5): every tool a person
 * can open, by display name, with the official name and slug it also matches
 * on. One narrow select — no joins, no children — read once per admin page
 * load and searched in the browser.
 *
 * Archived tools are left out: their page is not a place anybody works from,
 * and the inventory lists them. Drafts only for a caller who may see them
 * (`catalog.view_drafts`, decided by the caller) — a draft's page refuses
 * everyone else with a 404, and the palette must not offer a door that shuts.
 *
 * Relative imports with `.ts` extensions and no `"server-only"`, like every
 * module under `src/lib/data/`.
 */
export interface ToolIndexEntry {
  id: string;
  slug: string;
  name: string;
  officialName: string | null;
  published: boolean;
}

export async function listToolIndex(
  options: { includeDrafts: boolean; db?: Db }
): Promise<ToolIndexEntry[]> {
  const db = options.db ?? (await getDb());
  const live = isNull(tools.archivedAt);
  return db
    .select({
      id: tools.id,
      slug: tools.slug,
      name: tools.name,
      officialName: tools.officialName,
      published: tools.published,
    })
    .from(tools)
    .where(options.includeDrafts ? live : and(live, eq(tools.published, true)))
    .orderBy(asc(tools.name));
}

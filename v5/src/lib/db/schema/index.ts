/**
 * The v5 schema (data platform design spec 2026-09-14 §4). One file per table
 * group; this module is what `drizzle.config.ts` points at and what
 * `drizzle()` receives as its `schema`, so relational queries see every table.
 *
 * `pending_tools` arrived with Phase 6 (migration `0005`, and the research
 * ledger in `0006`); the Notion mirror's `notion_mirrors` and `mirror_pages`
 * with Phase 8 (migration `0007`).
 *
 * `auth.ts` is exported first because `helpers.ts` — which every other table
 * uses for `created_by` / `updated_by` — references `user.id`.
 */
export * from "./vocabulary.ts";
export * from "./auth.ts";
export * from "./taxonomy.ts";
export * from "./tools.ts";
export * from "./units.ts";
export * from "./resources.ts";
export * from "./attachments.ts";
export * from "./maintenance.ts";
export * from "./feedback.ts";
export * from "./projects.ts";
export * from "./audit.ts";
export * from "./imports.ts";
export * from "./pending-tools.ts";
export * from "./mirror.ts";
export * from "./manuals.ts";
export * from "./refresh.ts";

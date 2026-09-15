/**
 * The v5 schema (data platform design spec 2026-09-14 §4). One file per table
 * group; this module is what `drizzle.config.ts` points at and what
 * `drizzle()` receives as its `schema`, so relational queries see every table.
 *
 * Later phases add `pending_tools` (Phase 6), the Notion mirror tables
 * (Phase 8) and Better Auth's `user` / `session` / `account` / `verification`
 * tables (Phase 4), each with its own migration.
 */
export * from "./vocabulary.ts";
export * from "./taxonomy.ts";
export * from "./tools.ts";
export * from "./units.ts";
export * from "./resources.ts";
export * from "./attachments.ts";
export * from "./maintenance.ts";
export * from "./feedback.ts";
export * from "./projects.ts";
export * from "./audit.ts";

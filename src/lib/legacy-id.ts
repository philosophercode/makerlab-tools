/**
 * Legacy Notion page ids in `/tools/<id>` URLs (spec Goal 2).
 *
 * Before the Postgres move a tool's URL key was its Notion page id, and those
 * ids are printed on the QR labels stuck to the machines. `tools.notion_page_id`
 * keeps the key so the tool route can redirect an old link to `/tools/<slug>`,
 * and these helpers are the whole test for "is this path segment a legacy id or
 * a slug?".
 *
 * Notion writes the same id two ways: dashed in API responses, undashed in the
 * URLs people copy out of the app. Both are accepted, in either case; anything
 * else — `form-4`, a partial id, a uuid with dashes in the wrong places — is a
 * slug as far as this module is concerned.
 *
 * No `@/` alias and no `server-only`: `src/lib/data/catalog.ts` imports this,
 * and the scripts load that module under plain Node type-stripping.
 */

/** 32 hex characters, no dashes — the form Notion puts in a page URL. */
const COMPACT = /^[0-9a-f]{32}$/i;

/** The canonical 8-4-4-4-12 form Notion's API returns. */
const DASHED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a Notion page id, dashed or not. False for a slug like `form-4`. */
export function isLegacyNotionId(value: string): boolean {
  return compactNotionId(value) !== null;
}

/**
 * The id's 32 hex characters, lower-case and undashed, or null when `value` is
 * not a Notion page id. This is the comparison key: a stored id is normalised
 * the same way before it is matched, so dashes and case never decide a lookup.
 */
export function compactNotionId(value: string): string | null {
  const trimmed = value.trim();
  if (COMPACT.test(trimmed)) return trimmed.toLowerCase();
  if (DASHED.test(trimmed)) return trimmed.replace(/-/g, "").toLowerCase();
  return null;
}

/**
 * The dashed lower-case form Notion's API returns (`8-4-4-4-12`), or null when
 * `value` is not a Notion page id.
 */
export function normaliseNotionId(value: string): string | null {
  const compact = compactNotionId(value);
  if (!compact) return null;
  return [
    compact.slice(0, 8),
    compact.slice(8, 12),
    compact.slice(12, 16),
    compact.slice(16, 20),
    compact.slice(20),
  ].join("-");
}

/**
 * The uuid shape guard every query module needs (spec §4).
 *
 * Postgres `uuid` columns reject anything that is not uuid-shaped with a cast
 * error rather than an empty result, so a slug, a unit label or free text from
 * a model must never reach one. Each lookup that takes an untrusted id checks
 * here first and returns its own "not found" instead.
 *
 * Relative imports with `.ts` extensions and no `@/` alias: `scripts/` loads
 * these modules under plain Node.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `value` could address a uuid primary key. */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}

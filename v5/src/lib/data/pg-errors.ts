/**
 * Reading a Postgres error code through whatever wrapped it.
 *
 * Drizzle wraps a failed statement in a `DrizzleQueryError` and puts the driver
 * error on `cause`; the driver may have wrapped it once more. The SQLSTATE is
 * the only part of a failure that is the same on Neon and on PGlite, so it is
 * the only part worth branching on — message text differs between the two.
 *
 * Relative imports with `.ts` extensions, no `@/` alias and no `"server-only"`,
 * like every other module under `src/lib/data/`.
 */

/** How far down the `cause` chain to look before giving up. */
const MAX_DEPTH = 5;

/** True when `err` (or something it wraps) carries this SQLSTATE. */
export function hasPgCode(err: unknown, code: string): boolean {
  for (let current: unknown = err, depth = 0; current && depth < MAX_DEPTH; depth += 1) {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (candidate.code === code) return true;
    current = candidate.cause;
  }
  return false;
}

/** `23505` — a unique index refused the row. */
export function isUniqueViolation(err: unknown): boolean {
  return hasPgCode(err, "23505");
}

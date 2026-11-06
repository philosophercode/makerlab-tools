import fc from "fast-check";

/**
 * Shared fast-check settings for the invariant suite.
 *
 * `INVARIANT_RUNS` raises the number of generated cases for a deeper local run
 * (`INVARIANT_RUNS=2000 npm run test:invariants`); CI uses the default, which
 * keeps the whole folder to a few seconds per shard. A failure prints the seed
 * and the shrunk counterexample; replay it with `fc.assert(..., { seed, path })`.
 */
export const RUNS = Number(process.env.INVARIANT_RUNS) || 200;

/** For properties whose every case does real I/O (a route call, a PGlite query). */
export const IO_RUNS = Math.max(10, Math.round(RUNS / 8));

export { fc };

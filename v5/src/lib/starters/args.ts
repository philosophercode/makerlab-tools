/**
 * `npm run starters:refresh -- …`'s arguments (starter answers). Pure.
 *
 * - `--dry-run` (the default) asks, grades and refines, and writes nothing;
 *   `--apply` also writes the tools' new questions and the answers.
 * - `--limit N` stops after N tools (0 runs no tool — with `--general`, only
 *   the general chips); `--ids a,b` takes tool ids or slugs.
 * - `--general` adds the general opening chips (operate / debug / create).
 * - `--force` re-asks tools whose chips are all cached and current.
 * - `--concurrency N` tools at once (default 3); `--rounds N` refine rounds
 *   (default 2, at most 2); `--out path` the JSON report (a `.md` summary is
 *   written beside it).
 */

export interface RefreshArgs {
  apply: boolean;
  limit: number | null;
  ids: string[] | null;
  general: boolean;
  force: boolean;
  concurrency: number;
  rounds: number;
  out: string | null;
}

export const REFRESH_USAGE =
  "Use --dry-run (default) or --apply, --limit N, --ids a,b, --general, --force, --concurrency N, --rounds N, --out path.";

export function parseRefreshArgs(argv: readonly string[]): RefreshArgs {
  const args: RefreshArgs = { apply: false, limit: null, ids: null, general: false, force: false, concurrency: 3, rounds: 2, out: null };
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const [flag, inline] = arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, undefined];
    const value = () => {
      const next = inline ?? argv[++i];
      if (next === undefined) throw new Error(`${flag} needs a value.`);
      return next;
    };
    const whole = (min: number, max: number) => {
      const n = Number(value());
      if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${flag} must be a whole number from ${min} to ${max}.`);
      return n;
    };
    if (flag === "--dry-run") dryRun = true;
    else if (flag === "--apply") args.apply = true;
    else if (flag === "--general") args.general = true;
    else if (flag === "--force") args.force = true;
    else if (flag === "--limit") args.limit = whole(0, 100_000);
    else if (flag === "--concurrency") args.concurrency = whole(1, 8);
    else if (flag === "--rounds") args.rounds = whole(0, 2);
    else if (flag === "--out") args.out = value();
    else if (flag === "--ids") {
      const ids = value()
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      if (ids.length === 0) throw new Error("--ids needs at least one tool id or slug.");
      args.ids = ids;
    } else throw new Error(`Unknown argument ${arg}. ${REFRESH_USAGE}`);
  }
  if (dryRun && args.apply) throw new Error("--dry-run and --apply cannot both be given.");
  return args;
}

/** Run `work` over `items`, at most `concurrency` at a time, results in input order. */
export async function mapConcurrent<T, R>(items: readonly T[], concurrency: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await work(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, lane));
  return results;
}

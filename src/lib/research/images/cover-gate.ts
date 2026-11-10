import { checkCutout, type CutoutCheck } from "./check-cutout.ts";
import { makeCleanCopy, type CleanCopy, type CleanCopySource } from "./clean-copy.ts";
import type { SharpLoader } from "./downscale.ts";

/**
 * Which ranked picture becomes the cleaned cover, and its copy — the image
 * quality gate (ideal-lab eval follow-up, 2026-11-10):
 *
 * 1. **Evaluate the pick.** Ranking already judged each picture: the machine
 *    named and not a sibling, an accessory or a part; the whole machine from
 *    the front; its background measured (`rank.ts`).
 * 2. **Cut it** — the deterministic crop and cutout (`clean-copy.ts`).
 * 3. **Check the copy** — a vision call compares it with the original
 *    (`check-cutout.ts`): backdrop gone, machine intact, clean edges, a good
 *    cover.
 * 4. **Fall back.** A copy that fails is dropped and the next picture is
 *    tried, up to {@link COVER_GATE_ATTEMPTS}. A picture that cannot be cut
 *    (a busy backdrop with no box) is passed over the same way, so a clean
 *    cut of rank 2 beats an uncut rank 1. An already transparent picture is
 *    its own clean cover and wins as it is.
 *
 * When nothing passes, rank 1 stays first with no copy: `cutout_rejected`
 * when a copy was made and rejected, otherwise rank 1's own note. The
 * original is still offered; only a bad cutout is never kept.
 *
 * A check that could not run keeps its copy (the stage's behaviour before the
 * gate). At most {@link COVER_GATE_ATTEMPTS} check calls per item, only for
 * copies actually made. Never throws for a picture; a programming error does.
 */

/** How many ranked pictures the gate tries before it gives up. */
export const COVER_GATE_ATTEMPTS = 3;

export interface CoverGateResult {
  /** The index of the picture that won, or 0 when none did. */
  index: number;
  /** The winner's copy; `made: false` when it needs none or none passed. */
  copy: CleanCopy;
  /** The indexes whose copy the check rejected. */
  rejected: number[];
  /** One entry per picture tried: the check, null when unchecked or not cut. */
  checks: (CutoutCheck | null)[];
}

export async function chooseCleanCover(
  itemName: string,
  sources: readonly CleanCopySource[],
  opts: { signal: AbortSignal; loadSharp?: SharpLoader; label?: string; attempts?: number }
): Promise<CoverGateResult> {
  const label = opts.label ?? "cover";
  const rejected: number[] = [];
  const checks: (CutoutCheck | null)[] = [];
  let firstNote: CleanCopy | null = null;
  const tries = Math.min(sources.length, opts.attempts ?? COVER_GATE_ATTEMPTS);

  for (let index = 0; index < tries; index += 1) {
    const source = sources[index];
    if (source.background === "transparent" && !source.composite) {
      checks.push(null);
      return { index, copy: { made: false, note: null }, rejected, checks };
    }
    const copy = await makeCleanCopy(source, { loadSharp: opts.loadSharp });
    if (index === 0) firstNote = copy;
    if (!copy.made) {
      checks.push(null);
      continue;
    }
    const check = await checkCutout(itemName, source.bytes, copy, { signal: opts.signal, loadSharp: opts.loadSharp, label });
    checks.push(check);
    if (check === null || check.ok) {
      if (index > 0) console.info(`[research] ${label}: picture ${index + 1} made the clean cover`);
      return { index, copy, rejected, checks };
    }
    rejected.push(index);
    console.info(`[research] ${label}: cutout of picture ${index + 1} rejected (${check.problems.join(", ")})`);
  }

  const note = rejected.length > 0 ? "cutout_rejected" : firstNote && !firstNote.made ? firstNote.note : null;
  return { index: 0, copy: { made: false, note }, rejected, checks };
}

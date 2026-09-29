import { countResearchRequestedSince } from "../data/pending-tools";
import { researchLimitFor } from "../data/research-allowances";

/**
 * What is left of one person's research allowance over the last 24 hours —
 * the same count the research route checks (`queueForResearchWithinAllowance`)
 * and the same limit (`researchLimitFor`: the daily 100 plus running setup
 * grants).
 *
 * **Informational only** (data platform spec amendment "Many items at once"):
 * the intake card and `/admin/intake` show it beside **Add to research** so the
 * person sees the spend before confirming. It moves with every press anywhere,
 * so nothing is decided from it; the route decides at the click. Null when it
 * cannot be read — a surface says nothing rather than a guess (Article 4).
 */
export async function researchAllowanceLeft(userId: string | null | undefined, now: Date = new Date()): Promise<number | null> {
  if (!userId) return null;
  try {
    const [limit, used] = await Promise.all([
      researchLimitFor(userId),
      countResearchRequestedSince(userId, new Date(now.getTime() - 24 * 60 * 60_000)),
    ]);
    return Math.max(0, limit - used);
  } catch (err) {
    console.error("[intake] could not read the research allowance", err);
    return null;
  }
}

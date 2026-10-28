import type { ResearchImages } from "../research/result";

/**
 * Does a review-queue item's photo look good enough to approve without a
 * person looking? (assistant cleanup spec 2026-10-28 §4.)
 *
 * The assistant cannot see pictures in the chat, and it does not need to: the
 * image stage's vision call already judged every candidate when research ran
 * (`research/images/rank.ts`) — only a photo of the whole product itself is
 * ever kept as a candidate, and each kept one carries the ranking's view, its
 * composite flag and its measured background. This turns that stored
 * judgement into a verdict, in code, so "approve the ones whose image looks
 * good" is the same rule every time.
 *
 * **Good** means the photo approval would attach is research's rank-1
 * candidate (or its cleaned copy), shows the whole machine from the front or
 * at an angle, is not a banner or collage, has a plain, transparent or
 * cleaned background (or one nobody measured), and is at least
 * {@link MIN_IMAGE_SIDE} pixels on its short side. Anything else is **check**,
 * with the reasons; no photo at all is **none**. An uploaded photo (the person
 * gave one, so research found none) is **check**: nobody judged it.
 *
 * Pure and client-safe.
 */

/** The shortest side, in pixels, a photo approved without a look may have. */
export const MIN_IMAGE_SIDE = 400;

export type ImageVerdict =
  | { verdict: "good"; reasons: string[] }
  | { verdict: "check"; reasons: string[] }
  | { verdict: "none"; reasons: string[] };

export function imageVerdict(images: ResearchImages | null | undefined, uploads: readonly unknown[] = []): ImageVerdict {
  const first = images?.candidates[0];
  if (!first) {
    if (uploads.length > 0) return { verdict: "check", reasons: ["uploaded photo, not judged by research"] };
    if (images?.allRejected) return { verdict: "none", reasons: ["research found pictures, but none showed the product itself"] };
    return { verdict: "none", reasons: ["no photo"] };
  }

  const problems: string[] = [];
  if (first.composite) problems.push("banner, collage or busy scene");
  if (first.view && first.view !== "front" && first.view !== "three_quarter") problems.push(`${first.view.replace("_", " ")} view, not the front`);
  if (!first.view) problems.push("view not judged (researched before views were)");
  if (Math.min(first.width, first.height) < MIN_IMAGE_SIDE) problems.push(`small (${first.width}×${first.height})`);
  if (first.background === "busy" && !images?.cleaned) problems.push("busy background, not cleaned");
  if (problems.length > 0) return { verdict: "check", reasons: problems };

  const good = [`${first.view === "three_quarter" ? "three-quarter" : "front"} view of the whole product`];
  if (images?.cleaned) good.push("background cleaned");
  else if (first.background === "transparent" || first.background === "plain") good.push(`${first.background} background`);
  return { verdict: "good", reasons: good };
}

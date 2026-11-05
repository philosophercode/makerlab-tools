import { extractJsonObject } from "@/lib/research/model-output";

/**
 * The photo-quality eval's grading, without any model or network: the judge's
 * prompts, reading its replies, and turning verdicts into scores and a report
 * (photo options spec 2026-10-29, amendment "A photo-quality eval"). The runner
 * is `evals/photo-options.eval.ts`.
 *
 * Per tool:
 * - **The top three options**, each graded by a vision judge: does it show the
 *   right model, on a plain background, and is it not a shop or showroom
 *   scene? An option that passes all three is a **good pick**.
 * - **The maker's photo**: the top option's host is one of the maker's own, or
 *   the ranking marked it Manufacturer (declared on the maker's page).
 * - **The cutout** of the top option, made as **Use as cover** makes it
 *   (`cleanPickedImage` from the ranking's hints), shown to the judge on
 *   magenta beside the original: are the edges clean, is the product whole,
 *   is any background left?
 */

export type Ternary = "yes" | "no" | "unsure";

export interface PickVerdict {
  rightModel: Ternary;
  plainBackground: boolean;
  retailScene: boolean;
  reason: string;
}

export type CutoutEdges = "clean" | "rough" | "bad";

export interface CutoutVerdict {
  edges: CutoutEdges;
  productIntact: boolean;
  backgroundLeft: boolean;
  reason: string;
}

export const PICK_JUDGE_SYSTEM = [
  "You grade a candidate cover photo for one machine in a university makerspace's equipment catalogue.",
  "The catalogue wants the maker's own product photo: the exact machine, whole, on a plain white, light or transparent background.",
  "You are given the machine it must show and one picture. Judge only what you see.",
  "- right_model: yes when it is clearly that machine and model; no when it is another product, another model of the same maker, an accessory, a part or packaging; unsure when you cannot tell the model apart.",
  "- plain_background: true when the backdrop is plain (white, light grey, a flat colour or transparent) with no room, bench, people or scenery.",
  "- retail_scene: true when it is a shop, showroom, store shelf, marketplace listing collage, or has price tags, badges or promotional text over it.",
  'Answer with exactly one JSON object and nothing else: {"right_model": "yes" | "no" | "unsure", "plain_background": true | false, "retail_scene": true | false, "reason": "one short sentence"}.',
].join("\n");

export const CUTOUT_JUDGE_SYSTEM = [
  "You grade a background removal on a product photo for a makerspace catalogue.",
  "You are given the original picture first, then the cutout composited on solid magenta (#FF00FF) so that leftover background and ragged edges show.",
  "- edges: clean when the outline follows the product with no visible halo or jagged steps; rough when there is a thin halo, fringe or a few jagged spots a person would notice; bad when large chunks are wrong.",
  "- product_intact: false when any real part of the machine was cut away (a handle, a lid, a cable that belongs to it, a corner).",
  "- background_left: true when patches of the original background remain around or inside the product (not counting holes that really show through the product).",
  'Answer with exactly one JSON object and nothing else: {"edges": "clean" | "rough" | "bad", "product_intact": true | false, "background_left": true | false, "reason": "one short sentence"}.',
].join("\n");

export function pickJudgePrompt(model: string): string {
  return `The machine it must show: ${model}\n\nGrade the picture. Answer with the JSON object only.`;
}

export function cutoutJudgePrompt(model: string): string {
  return `The machine: ${model}\n\nThe first picture is the original, the second the cutout on magenta. Answer with the JSON object only.`;
}

function readObject(text: string): Record<string, unknown> | null {
  try {
    const value = extractJsonObject(text);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const reasonOf = (value: unknown) => (typeof value === "string" ? value.trim().slice(0, 300) : "");

/** The pick judge's verdict, or null when its reply cannot be read. */
export function parsePickVerdict(text: string): PickVerdict | null {
  const value = readObject(text);
  if (!value) return null;
  const rightModel = typeof value.right_model === "string" ? value.right_model.trim().toLowerCase() : "";
  if (rightModel !== "yes" && rightModel !== "no" && rightModel !== "unsure") return null;
  if (typeof value.plain_background !== "boolean" || typeof value.retail_scene !== "boolean") return null;
  return {
    rightModel,
    plainBackground: value.plain_background,
    retailScene: value.retail_scene,
    reason: reasonOf(value.reason),
  };
}

/** The cutout judge's verdict, or null when its reply cannot be read. */
export function parseCutoutVerdict(text: string): CutoutVerdict | null {
  const value = readObject(text);
  if (!value) return null;
  const edges = typeof value.edges === "string" ? value.edges.trim().toLowerCase() : "";
  if (edges !== "clean" && edges !== "rough" && edges !== "bad") return null;
  if (typeof value.product_intact !== "boolean" || typeof value.background_left !== "boolean") return null;
  return {
    edges,
    productIntact: value.product_intact,
    backgroundLeft: value.background_left,
    reason: reasonOf(value.reason),
  };
}

/** All three: the right model, a plain backdrop, no shop scene. */
export function isGoodPick(verdict: PickVerdict): boolean {
  return verdict.rightModel === "yes" && verdict.plainBackground && !verdict.retailScene;
}

/** A clean cutout: clean edges, nothing cut away, no background left. */
export function isCleanCutout(verdict: CutoutVerdict): boolean {
  return verdict.edges === "clean" && verdict.productIntact && !verdict.backgroundLeft;
}

/** True when `url`'s host is one of `hosts` or a subdomain of one. */
export function onMakerHost(url: string, hosts: readonly string[]): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return false;
  }
  return hosts.some((maker) => host === maker || host.endsWith(`.${maker}`));
}

/** One graded option. `verdict` is null when the picture could not be downloaded or judged. */
export interface GradedOption {
  url: string;
  host: string;
  verdict: PickVerdict | null;
  error?: string;
}

/** What happened to the top option's cutout. */
export type CutoutResult =
  | { kind: "judged"; cleaned: string; verdict: CutoutVerdict }
  | { kind: "as_is"; note: string | null }
  | { kind: "error"; error: string };

export interface CaseResult {
  name: string;
  /** The search's own failure ("No new picture of it was found."), when it found nothing. */
  searchError?: string;
  optionCount: number;
  makerPhoto: boolean;
  top: GradedOption[];
  cutout: CutoutResult | null;
  seconds: number;
}

export interface PhotoEvalSummary {
  cases: number;
  searched: number;
  /** Shares of all cases, 0–1: a search that found nothing counts as a miss. */
  top1Good: number;
  top1RightModel: number;
  top1PlainBackground: number;
  top1NotRetail: number;
  makerPhoto: number;
  /** A good pick anywhere in the top three. */
  top3AnyGood: number;
  /** Of the top picks a cutout was made for, the share judged clean. */
  cutoutClean: number | null;
  cutoutsMade: number;
  judgeCost: number;
}

const share = (count: number, of: number) => (of === 0 ? 0 : count / of);

export function summarize(results: readonly CaseResult[], judgeCost = 0): PhotoEvalSummary {
  const top1 = results.map((result) => result.top[0]?.verdict ?? null);
  const count = (test: (verdict: PickVerdict) => boolean) => top1.filter((verdict) => verdict && test(verdict)).length;
  const cutouts = results.flatMap((result) => (result.cutout?.kind === "judged" ? [result.cutout.verdict] : []));
  return {
    cases: results.length,
    searched: results.filter((result) => !result.searchError).length,
    top1Good: share(count(isGoodPick), results.length),
    top1RightModel: share(
      count((verdict) => verdict.rightModel === "yes"),
      results.length,
    ),
    top1PlainBackground: share(
      count((verdict) => verdict.plainBackground),
      results.length,
    ),
    top1NotRetail: share(
      count((verdict) => !verdict.retailScene),
      results.length,
    ),
    makerPhoto: share(results.filter((result) => result.makerPhoto).length, results.length),
    top3AnyGood: share(
      results.filter((result) => result.top.some((option) => option.verdict && isGoodPick(option.verdict))).length,
      results.length,
    ),
    cutoutClean: cutouts.length === 0 ? null : share(cutouts.filter(isCleanCutout).length, cutouts.length),
    cutoutsMade: cutouts.length,
    judgeCost,
  };
}

const pct = (value: number) => `${Math.round(value * 100)}%`;
const mark = (ok: boolean) => (ok ? "✓" : "✗");

function cutoutText(cutout: CutoutResult | null): string {
  if (!cutout) return "—";
  if (cutout.kind === "error") return `error (${cutout.error})`;
  if (cutout.kind === "as_is") return `kept as is${cutout.note ? ` (${cutout.note})` : ""}`;
  const { verdict } = cutout;
  const flags = [verdict.productIntact ? null : "cut into product", verdict.backgroundLeft ? "background left" : null].filter(Boolean);
  return `${verdict.edges}${flags.length ? `, ${flags.join(", ")}` : ""}`;
}

/** The report printed after a run: the scores, then one block per tool. */
export function formatReport(results: readonly CaseResult[], summary: PhotoEvalSummary): string {
  const lines = [
    `Photo-quality eval: ${summary.cases} tools, ${summary.searched} found options`,
    `  Top pick good (right model, plain, not a shop): ${pct(summary.top1Good)}`,
    `    right model ${pct(summary.top1RightModel)} · plain background ${pct(summary.top1PlainBackground)} · not a shop photo ${pct(summary.top1NotRetail)}`,
    `  Top pick is the maker's photo: ${pct(summary.makerPhoto)}`,
    `  A good pick in the top 3: ${pct(summary.top3AnyGood)}`,
    `  Cutout clean: ${summary.cutoutClean === null ? "none made" : `${pct(summary.cutoutClean)} of ${summary.cutoutsMade}`}`,
    `  Judge cost: $${summary.judgeCost.toFixed(3)}`,
    "",
  ];
  for (const result of results) {
    lines.push(`${result.name} (${result.seconds.toFixed(0)} s)`);
    if (result.searchError) {
      lines.push(`  search: ${result.searchError}`, "");
      continue;
    }
    lines.push(`  ${result.optionCount} options · maker's photo ${mark(result.makerPhoto)} · cutout: ${cutoutText(result.cutout)}`);
    result.top.forEach((option, index) => {
      const verdict = option.verdict;
      const grade = verdict
        ? `${mark(isGoodPick(verdict))} model ${verdict.rightModel}, ${verdict.plainBackground ? "plain" : "busy"}${verdict.retailScene ? ", shop" : ""}: ${verdict.reason}`
        : `not judged (${option.error ?? "unknown"})`;
      lines.push(`  ${index + 1}. ${option.host}  ${grade}`);
    });
    lines.push("");
  }
  return lines.join("\n");
}

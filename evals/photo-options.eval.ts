import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateText } from "ai";
import sharp from "sharp";
import { gatewayCallReport } from "@/lib/ai/gateway-usage";
import { languageModelFor, providerOptionsFor } from "@/lib/ai/models";
import { inspectImage } from "@/lib/images/inspect";
import { IMAGE_MAX_BYTES } from "@/lib/intake/limits";
import type { PhotoOption } from "@/lib/photo-options/types";
import { cleanPickedImage } from "@/lib/research/images/pick-clean";
import { findPhotoOptions } from "@/lib/research/photo-options-steps";
import { guardedFetch } from "@/lib/web/guarded-fetch";
import { PHOTO_EVAL_CASES, type PhotoEvalCase } from "./photo-options/cases";
import {
  CUTOUT_JUDGE_SYSTEM,
  PICK_JUDGE_SYSTEM,
  cutoutJudgePrompt,
  formatReport,
  onMakerHost,
  parseCutoutVerdict,
  parsePickVerdict,
  pickJudgePrompt,
  summarize,
  type CaseResult,
  type CutoutResult,
  type GradedOption,
} from "./photo-options/grade";

/**
 * `npm run eval:photo-options` — does **Find photo options** pull good photos,
 * and does **Use as cover** cut them out cleanly? (Photo options spec
 * 2026-10-29, amendment "A photo-quality eval".) Vitest as a task runner, like
 * the other evals; never part of `npm test` or CI.
 *
 * REAL and PAID: per tool, the shipped search exactly as the editor runs it
 * (`findPhotoOptions`: one Exa search, the probe, the vision ranking), then a
 * vision judge (job `evalQuestions`) on the top three and on the top pick's
 * cutout. About $1–3 for the twelve tools. Needs `AI_GATEWAY_API_KEY` (or
 * `VERCEL_OIDC_TOKEN`) and network; no database and no Blob store — nothing is
 * stored or written but the local report.
 *
 * Reported, never failed: the scores are a measure to compare runs by. The run
 * fails only when no tool could be searched at all (a missing key, no network).
 *
 * Options: `EVAL_PO_TOOL=<part of a name>`, `EVAL_PO_LIMIT=N`. One JSON
 * report, and each judged cutout as a PNG, per run in `evals/.photo-options/`.
 */

const REPORT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), ".photo-options");
const SEARCH_TIMEOUT_MS = 4 * 60_000;
const JUDGE_SIDE = 768;
const TOP_JUDGED = 3;

let judgeCost = 0;

/** The picture as a PNG at most `JUDGE_SIDE` wide or tall: cheaper to judge, and one format. */
async function forJudge(bytes: Uint8Array, background?: string): Promise<Uint8Array> {
  let image = sharp(bytes).rotate().resize(JUDGE_SIDE, JUDGE_SIDE, {
    fit: "inside",
    withoutEnlargement: true,
  });
  if (background) image = image.flatten({ background });
  return new Uint8Array(await image.png().toBuffer());
}

async function download(url: string): Promise<{ bytes: Uint8Array } | { error: string }> {
  const fetched = await guardedFetch(url, {
    signal: AbortSignal.timeout(20_000),
    maxBytes: IMAGE_MAX_BYTES,
    accept: "image/jpeg, image/png, image/webp",
  });
  if (!fetched.ok) return { error: `download: ${fetched.reason}` };
  return { bytes: fetched.bytes };
}

async function judge(system: string, prompt: string, images: readonly Uint8Array[]): Promise<string> {
  const result = await generateText({
    model: languageModelFor("evalQuestions"),
    system,
    messages: [
      {
        role: "user",
        content: [
          ...images.map((image) => ({
            type: "image" as const,
            image,
            mediaType: "image/png",
          })),
          { type: "text" as const, text: prompt },
        ],
      },
    ],
    providerOptions: providerOptionsFor("evalQuestions"),
    maxRetries: 2,
    abortSignal: AbortSignal.timeout(90_000),
  });
  judgeCost += gatewayCallReport(result.providerMetadata).cost ?? 0;
  return result.text;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "?";
  }
};

async function gradeOption(option: PhotoOption, testCase: PhotoEvalCase, original: Uint8Array | null): Promise<GradedOption> {
  const graded: GradedOption = {
    url: option.url,
    host: hostOf(option.url),
    verdict: null,
  };
  try {
    let bytes = original;
    if (!bytes) {
      const got = await download(option.url);
      if ("error" in got) return { ...graded, error: got.error };
      bytes = got.bytes;
    }
    const verdict = parsePickVerdict(await judge(PICK_JUDGE_SYSTEM, pickJudgePrompt(testCase.model), [await forJudge(bytes)]));
    return verdict ? { ...graded, verdict } : { ...graded, error: "unreadable verdict" };
  } catch (error) {
    return {
      ...graded,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function gradeCutout(option: PhotoOption, testCase: PhotoEvalCase, original: Uint8Array, slug: string): Promise<CutoutResult> {
  try {
    const info = inspectImage(original);
    if (!info) return { kind: "error", error: "not a JPEG, PNG or WebP" };
    // The same call and hints **Use as cover** makes (`pickHints` in approval-image.ts).
    const picked = await cleanPickedImage(
      { bytes: original, info },
      {
        background: option.background ?? null,
        composite: option.composite ?? null,
        productBox: option.productBox ?? null,
      },
    );
    if (!picked.cleaned) return { kind: "as_is", note: picked.note };
    const onMagenta = await forJudge(picked.bytes, "#ff00ff");
    await writeFile(path.join(REPORT_DIR, `${slug}-cutout.png`), onMagenta);
    const verdict = parseCutoutVerdict(
      await judge(CUTOUT_JUDGE_SYSTEM, cutoutJudgePrompt(testCase.model), [await forJudge(original), onMagenta]),
    );
    return verdict ? { kind: "judged", cleaned: picked.cleaned, verdict } : { kind: "error", error: "unreadable verdict" };
  } catch (error) {
    return {
      kind: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runCase(testCase: PhotoEvalCase): Promise<CaseResult> {
  const started = Date.now();
  const seconds = () => (Date.now() - started) / 1000;
  const slug = testCase.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const base = {
    name: testCase.name,
    optionCount: 0,
    makerPhoto: false,
    top: [],
    cutout: null,
  };

  let found;
  try {
    found = await findPhotoOptions(
      { name: testCase.name, links: testCase.links, note: null, exclude: [] },
      { label: `eval-${slug}`, signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) },
    );
  } catch (error) {
    return {
      ...base,
      searchError: `threw: ${error instanceof Error ? error.message : String(error)}`,
      seconds: seconds(),
    };
  }
  if (!found.ok) return { ...base, searchError: found.reason, seconds: seconds() };

  const [first, ...rest] = found.options;
  const firstBytes = await download(first.url);
  const top = await Promise.all([
    "bytes" in firstBytes
      ? gradeOption(first, testCase, firstBytes.bytes)
      : Promise.resolve({
          url: first.url,
          host: hostOf(first.url),
          verdict: null,
          error: firstBytes.error,
        }),
    ...rest.slice(0, TOP_JUDGED - 1).map((option) => gradeOption(option, testCase, null)),
  ]);
  const cutout =
    "bytes" in firstBytes
      ? await gradeCutout(first, testCase, firstBytes.bytes, slug)
      : ({ kind: "error", error: firstBytes.error } as const);

  return {
    name: testCase.name,
    optionCount: found.options.length,
    makerPhoto: first.manufacturer === true || onMakerHost(first.url, testCase.makerHosts),
    top,
    cutout,
    seconds: seconds(),
  };
}

describe("photo-quality eval", () => {
  it("finds good cover photos and cuts them out cleanly (reported, not failed)", async () => {
    if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
      throw new Error(
        "AI_GATEWAY_API_KEY (or VERCEL_OIDC_TOKEN) is required: the search, the ranking and the judge run through the Gateway.",
      );
    }
    const filter = process.env.EVAL_PO_TOOL?.trim().toLowerCase();
    const limit = Number(process.env.EVAL_PO_LIMIT) || Infinity;
    const cases = PHOTO_EVAL_CASES.filter((testCase) => !filter || testCase.name.toLowerCase().includes(filter)).slice(0, limit);
    if (cases.length === 0) throw new Error(`No eval tool matches EVAL_PO_TOOL=${process.env.EVAL_PO_TOOL}`);
    await mkdir(REPORT_DIR, { recursive: true });

    const results: CaseResult[] = [];
    // One tool at a time: the Exa search and the ranking are rate limited, and a log in order reads better.
    for (const testCase of cases) {
      const result = await runCase(testCase);
      console.info(
        `[photo-eval] ${testCase.name}: ${result.searchError ?? `${result.optionCount} options`} (${result.seconds.toFixed(0)} s)`,
      );
      results.push(result);
    }

    const summary = summarize(results, judgeCost);
    console.info(`\n${formatReport(results, summary)}`);
    const file = path.join(REPORT_DIR, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    await writeFile(file, JSON.stringify({ summary, results }, null, 2));
    console.info(`Report: ${path.relative(process.cwd(), file)}`);

    expect(summary.searched, "no tool could be searched at all: check the Gateway key and the network").toBeGreaterThan(0);
  });
});

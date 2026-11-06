import { execSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateText, stepCountIs } from "ai";
import { EXA_SEARCH_TOOL, researchExaSearch } from "@/lib/ai/exa";
import { gatewayCallReport } from "@/lib/ai/gateway-usage";
import { chatProviderOptions, languageModelFor, modelIdFor } from "@/lib/ai/models";
import type { Db } from "@/lib/db/types";
import { inspectImage } from "@/lib/images/inspect";
import { initialDraft, initialImageChoice } from "@/lib/intake/approval-draft";
import { pickHints } from "@/lib/intake/approval-image";
import { withTrainingForStaff } from "@/lib/intake/training";
import { runRead, runSearch } from "@/lib/research/engine";
import { rankAndClean } from "@/lib/research/image-stage";
import { collectCandidates } from "@/lib/research/images/candidates";
import { cleanPickedImage } from "@/lib/research/images/pick-clean";
import { textLanguage } from "@/lib/research/language";
import type { ResearchItemInput } from "@/lib/research/prompt";
import type { ImageCandidate, ResearchImages, ResearchResult } from "@/lib/research/result";
import { listCategoriesForChoosing } from "@/lib/taxonomy/seed";
import type { ImageHint } from "@/lib/web/read-page";
import { guardedFetch } from "@/lib/web/guarded-fetch";
import { getNotionEnvContract } from "@/lib/notion";
import type { EvalCase } from "./cases";
import { caseMessages, composeCase } from "./harness";
import { downloadImage, forJudge, hostOf, judgeCall, judgeModelId } from "./judge-io";
import { StageCache, hashOf, sourceFingerprint, withCostMeter } from "./ideal-lab/cache";
import { IDEAL_LAB_CASES, LAB_ZONES, namesTheModel, type IdealLabCase } from "./ideal-lab/cases";
import {
  GOLDEN_SYSTEM,
  LISTING_JUDGE_SYSTEM,
  PAIRWISE_JUDGE_SYSTEM,
  formatReport,
  goldenPrompt,
  handGradeSheet,
  listingJudgePrompt,
  loopPass,
  newIsAFor,
  pairwisePrompt,
  parseGolden,
  parseListingVerdict,
  parsePairwise,
  regressions,
  summarize,
  type Baseline,
  type CaseChecks,
  type CaseResult,
  type GoldenListing,
  type ListingForJudge,
} from "./ideal-lab/grade";
import {
  CUTOUT_JUDGE_SYSTEM,
  PICK_JUDGE_SYSTEM,
  cutoutJudgePrompt,
  onMakerHost,
  parseCutoutVerdict,
  parsePickVerdict,
  pickJudgePrompt,
  type CutoutResult,
  type GradedOption,
} from "./photo-options/grade";

/**
 * `npm run eval:ideal-lab` — the whole adding-equipment loop, end to end, on
 * the ideal lab's golden ten (and three held out): a vague chat message →
 * identification (the real chat prompt and `identify_tools`, stubbed) →
 * research (the shipped search and read passes, `engine.ts`) → the product
 * image (candidates, probe, ranking — `rankAndClean`) → the approval draft
 * (`initialDraft`, with the real lab's zones) → the cover's background removal
 * (`cleanPickedImage`, as **Use as cover** makes it).
 *
 * Then graded: cheap checks in code (identified the right model, English,
 * a manual that downloads as a PDF, links that answer, quotes verified, the
 * right zone), and judges (job `evalQuestions`, Opus; `EVAL_JUDGE_MODEL`
 * overrides): the listing against a **golden reference** written by Opus with
 * web search and committed in `evals/ideal-lab/golden/`, the top three photos
 * and the cutout (the photo-quality eval's judges), and — once a baseline is
 * frozen — the listing **pairwise** against the baseline's.
 *
 * REAL and PAID. Stages are cached by everything that could change them
 * (`ideal-lab/cache.ts`): a prompt edit re-runs only the stages it reaches.
 * The report prints the cost of the run. Never part of `npm test` or CI.
 *
 * Options (env):
 * - `EVAL_IL_CASE=<id part>` one or a few cases; `EVAL_IL_HOLDOUT=0` the tuned ten only.
 * - `EVAL_IL_FRESH=1` ignore the cache.
 * - `EVAL_IL_GOLDEN=1` write the golden listings that are missing (`=force` rewrites them all), then stop.
 * - `EVAL_IL_FREEZE=1` freeze this run as the baseline (`evals/ideal-lab/baseline.json`).
 * - `EVAL_IL_STRICT=1` fail the run when a guarded score fell below the baseline.
 *
 * Writes `evals/.ideal-lab/runs/<time>/`: `report.txt`, `report.json`,
 * `hand-grades.md` (tick agree/disagree with the judge) and the cutouts.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const WORK_DIR = path.join(HERE, ".ideal-lab");
const GOLDEN_DIR = path.join(HERE, "ideal-lab", "golden");
const BASELINE_FILE = path.join(HERE, "ideal-lab", "baseline.json");
const STAGE_TIMEOUT_MS = 4 * 60_000;
/** Kept per page in the research cache: enough for the judge. */
const CACHED_PAGE_CHARS = 8000;
const TOP_JUDGED = 3;

const cache = new StageCache(path.join(WORK_DIR, "cache"), process.env.EVAL_IL_FRESH === "1");

// ── Stage 1: identify ─────────────────────────────────────────────

interface IdentifyOut {
  items: { name: string; brand?: string; categoryHint?: string; locationHint?: string; serialNumber?: string }[];
  calls: number;
  text: string;
  cost: number;
}

async function identify(testCase: IdealLabCase): Promise<{ value: IdentifyOut; cached: boolean }> {
  const evalCase: EvalCase = {
    id: testCase.id,
    prompt: testCase.prompt,
    context: { page: "gallery", as: "super_admin" },
    assert: [],
    file: "ideal-lab",
  };
  const { system, tools } = await composeCase(evalCase);
  const key = hashOf([system, Object.keys(tools).sort(), testCase.prompt, modelIdFor("chat"), await sourceFingerprint(ROOT, ["src/lib/capabilities"])]);
  const hit = await cache.get<IdentifyOut>("identify", testCase.id, key);
  if (hit) return { value: hit, cached: true };

  const result = await generateText({
    model: languageModelFor("chat"),
    system,
    providerOptions: chatProviderOptions(),
    messages: caseMessages(evalCase),
    tools,
    stopWhen: stepCountIs(5),
  });
  const calls = result.steps.flatMap((step) => step.toolCalls).filter((call) => call.toolName === "identify_tools");
  const items = calls.flatMap((call) => ((call.input as { items?: IdentifyOut["items"] })?.items ?? []));
  const value: IdentifyOut = {
    items,
    calls: calls.length,
    text: result.text,
    cost: result.steps.reduce((total, step) => total + (gatewayCallReport(step.providerMetadata).cost ?? 0), 0),
  };
  await cache.put("identify", testCase.id, key, value);
  return { value, cached: false };
}

// ── Stage 2: research ─────────────────────────────────────────────

interface ResearchOut {
  result: ResearchResult;
  hints: ImageHint[];
  pages: { url: string; title: string | null; text: string }[];
  cost: number;
}

let researchCode: string | null = null;
let imageCode: string | null = null;
const IMAGE_FILES = [/\/images\//, /image-[a-z-]+\.ts$/, /photo-options/];

async function research(testCase: IdealLabCase, item: ResearchItemInput): Promise<{ value: ResearchOut; cached: boolean; key: string }> {
  researchCode ??= await sourceFingerprint(
    ROOT,
    ["src/lib/research", "src/lib/web", "src/lib/refresh"],
    ["src/lib/ai/exa.ts", "src/lib/intake/limits.ts", "src/lib/intake/training.ts", "src/lib/taxonomy/seed.ts"],
    IMAGE_FILES
  );
  const key = hashOf([item, modelIdFor("researchSearch"), modelIdFor("researchRead"), researchCode]);
  const hit = await cache.get<ResearchOut>("research", testCase.id, key);
  if (hit) return { value: hit, cached: true, key };

  const requestId = `eval-${testCase.id}`;
  const { value: run, cost } = await withCostMeter(async () => {
    const search = await runSearch(item, { requestId, signal: AbortSignal.timeout(STAGE_TIMEOUT_MS) });
    const read = await runRead(item, search.findings, { requestId, signal: AbortSignal.timeout(STAGE_TIMEOUT_MS), searchTexts: search.searchTexts });
    return { search, read };
  });
  const value: ResearchOut = {
    // As the read step hands it on: training is the lab's call.
    result: withTrainingForStaff(run.read.result),
    hints: [...run.read.imageHints, ...run.search.exaImages],
    pages: run.read.pages.map((page) => ({ ...page, text: page.text.slice(0, CACHED_PAGE_CHARS) })),
    cost,
  };
  await cache.put("research", testCase.id, key, value);
  return { value, cached: false, key };
}

// ── Stage 3: the product image ────────────────────────────────────

interface ImageOut {
  images: ResearchImages | null;
  imageError: string | null;
  cost: number;
}

async function findImage(testCase: IdealLabCase, researched: ResearchOut, researchKey: string, item: ResearchItemInput) {
  imageCode ??= await sourceFingerprint(ROOT, ["src/lib/research/images", "src/lib/images"], ["src/lib/research/image-stage.ts"]);
  const key = hashOf([researchKey, modelIdFor("imageRank"), imageCode]);
  const hit = await cache.get<ImageOut>("image", testCase.id, key);
  if (hit) return { value: hit, cached: true };

  const subject = { name: researched.result.canonicalName.trim() || item.name, brand: item.brand };
  // As the research workflow's image step collects them (`image-steps.ts`).
  const candidates = collectCandidates(
    researched.hints.filter((hint) => hint.source !== "exa"),
    researched.hints.filter((hint) => hint.source === "exa"),
    subject
  );
  const { value: outcome, cost } = await withCostMeter(() =>
    // `clean: false`: nothing stored, so no database; the cutout is made below, as Use as cover makes it.
    rankAndClean(null as unknown as Db, `eval-${testCase.id}`, subject.name, candidates, {
      signal: AbortSignal.timeout(STAGE_TIMEOUT_MS),
      brand: subject.brand,
      clean: false,
    })
  );
  const value: ImageOut = { images: outcome.images, imageError: outcome.imageError, cost };
  await cache.put("image", testCase.id, key, value);
  return { value, cached: false };
}

// ── Cheap checks ──────────────────────────────────────────────────

async function answers(url: string): Promise<{ ok: boolean; pdf: boolean }> {
  const fetched = await guardedFetch(url, {
    signal: AbortSignal.timeout(20_000),
    maxBytes: 60 * 1024 * 1024,
    stopAfterBytes: 8,
    accept: "*/*",
  });
  if (!fetched.ok) return { ok: false, pdf: false };
  const magic = new TextDecoder().decode(fetched.bytes.slice(0, 5));
  return { ok: true, pdf: magic === "%PDF-" || fetched.contentType === "application/pdf" };
}

async function cheapChecks(
  testCase: IdealLabCase,
  identified: IdentifyOut,
  result: ResearchResult,
  images: ResearchImages | null,
  zoneName: string
): Promise<CaseChecks> {
  const item = identified.items[0];
  const description = result.description.trim();
  const manual = result.resources.find((resource) => resource.type === "Manual");
  const checked = await Promise.all(result.resources.map((resource) => answers(resource.url)));
  const manualAnswer = manual ? checked[result.resources.indexOf(manual)] : null;
  const cited = Object.values(result.citations ?? {}).filter((quotes) => quotes && quotes.length > 0);
  const top = images?.candidates[0];
  return {
    identifiedOne: identified.calls === 1 && identified.items.length === 1,
    identifiedRight: Boolean(item && namesTheModel(item.name, testCase)),
    english: textLanguage(description).verdict === "english",
    manualFound: Boolean(manual),
    manualIsPdf: Boolean(manualAnswer?.pdf),
    linksResolve: checked.every((entry) => entry.ok),
    citationCoverage: cited.length === 0 ? null : cited.filter((quotes) => quotes!.some((quote) => quote.verified)).length / cited.length,
    descriptionWords: description ? description.split(/\s+/).length : 0,
    imageChosen: initialImageChoice(images).choice !== "none",
    zoneRight: (testCase.zone ?? "") === zoneName,
    makerPhoto: Boolean(top && (onMakerHost(top.url, testCase.makerHosts) || (top.pageUrl !== null && onMakerHost(top.pageUrl, testCase.makerHosts)))),
  };
}

// ── Judges ────────────────────────────────────────────────────────

async function gradePhoto(candidate: ImageCandidate, testCase: IdealLabCase, bytes: Uint8Array | null): Promise<GradedOption & { cost: number }> {
  const graded = { url: candidate.url, host: hostOf(candidate.url), verdict: null, cost: 0 };
  try {
    let picture = bytes;
    if (!picture) {
      const got = await downloadImage(candidate.url);
      if ("error" in got) return { ...graded, error: got.error };
      picture = got.bytes;
    }
    const { text, cost } = await judgeCall(PICK_JUDGE_SYSTEM, pickJudgePrompt(testCase.model), [await forJudge(picture)]);
    const verdict = parsePickVerdict(text);
    return verdict ? { ...graded, verdict, cost } : { ...graded, error: "unreadable verdict", cost };
  } catch (error) {
    return { ...graded, error: error instanceof Error ? error.message : String(error) };
  }
}

async function gradeCutout(candidate: ImageCandidate, testCase: IdealLabCase, original: Uint8Array, outDir: string): Promise<{ cutout: CutoutResult; cost: number }> {
  try {
    const info = inspectImage(original);
    if (!info) return { cutout: { kind: "error", error: "not a JPEG, PNG or WebP" }, cost: 0 };
    const picked = await cleanPickedImage({ bytes: original, info }, pickHints(candidate));
    if (!picked.cleaned) return { cutout: { kind: "as_is", note: picked.note }, cost: 0 };
    const onMagenta = await forJudge(picked.bytes, "#ff00ff");
    await writeFile(path.join(outDir, `${testCase.id}-cutout.png`), onMagenta);
    const { text, cost } = await judgeCall(CUTOUT_JUDGE_SYSTEM, cutoutJudgePrompt(testCase.model), [await forJudge(original), onMagenta]);
    const verdict = parseCutoutVerdict(text);
    return { cutout: verdict ? { kind: "judged", cleaned: picked.cleaned, verdict } : { kind: "error", error: "unreadable verdict" }, cost };
  } catch (error) {
    return { cutout: { kind: "error", error: error instanceof Error ? error.message : String(error) }, cost: 0 };
  }
}

async function readGolden(id: string): Promise<GoldenListing | null> {
  try {
    return JSON.parse(await readFile(path.join(GOLDEN_DIR, `${id}.json`), "utf8")) as GoldenListing;
  } catch {
    return null;
  }
}

async function writeGolden(testCase: IdealLabCase): Promise<number> {
  const { text, cost } = await judgeCall(GOLDEN_SYSTEM, goldenPrompt(testCase.model, testCase.brand), [], {
    tools: { [EXA_SEARCH_TOOL]: researchExaSearch() },
    timeoutMs: STAGE_TIMEOUT_MS,
  });
  const golden = parseGolden(text);
  if (!golden) throw new Error(`${testCase.id}: the golden listing could not be read: ${text.slice(0, 300)}`);
  await mkdir(GOLDEN_DIR, { recursive: true });
  await writeFile(path.join(GOLDEN_DIR, `${testCase.id}.json`), `${JSON.stringify(golden, null, 2)}\n`);
  return cost;
}

// ── One case ──────────────────────────────────────────────────────

async function runCase(testCase: IdealLabCase, baseline: Baseline | null, outDir: string): Promise<CaseResult> {
  const started = Date.now();
  const result: CaseResult = {
    id: testCase.id,
    model: testCase.model,
    holdout: testCase.holdout === true,
    identifiedName: null,
    checks: null,
    listing: null,
    listingForJudge: null,
    top: [],
    cutout: null,
    cost: { pipeline: 0, pipelineFresh: 0, judge: 0 },
    cached: { identify: false, research: false, image: false },
    seconds: 0,
  };
  const done = () => ({ ...result, seconds: (Date.now() - started) / 1000 });
  const spend = (cost: number, cached: boolean) => {
    result.cost.pipeline += cost;
    if (!cached) result.cost.pipelineFresh += cost;
  };

  try {
    const identified = await identify(testCase);
    spend(identified.value.cost, identified.cached);
    result.cached.identify = identified.cached;
    const first = identified.value.items[0];
    result.identifiedName = first?.name ?? null;
    if (!first) {
      result.error = `identify_tools was not called (${identified.value.calls} calls). The assistant said: ${identified.value.text.slice(0, 300)}`;
      return done();
    }
    const item: ResearchItemInput = {
      name: first.name,
      brand: first.brand?.trim() || null,
      categoryHint: first.categoryHint?.trim() || null,
      locationHint: first.locationHint?.trim() || null,
    };

    const researched = await research(testCase, item);
    spend(researched.value.cost, researched.cached);
    result.cached.research = researched.cached;
    const image = await findImage(testCase, researched.value, researched.key, item);
    spend(image.value.cost, image.cached);
    result.cached.image = image.cached;
    const drafted: ResearchResult = { ...researched.value.result, images: image.value.images, imageError: image.value.imageError };

    // The approval page's starting draft, with the real lab's zones.
    const categories = await listCategoriesForChoosing();
    const draft = initialDraft(
      { name: item.name, locationHint: item.locationHint, serialNumber: first.serialNumber ?? null, categoryHint: item.categoryHint },
      drafted,
      categories,
      [...LAB_ZONES]
    );
    const zoneName = LAB_ZONES.find((zone) => zone.id === draft.locationId)?.zone ?? "";
    result.checks = await cheapChecks(testCase, identified.value, drafted, image.value.images, zoneName);

    const listing: ListingForJudge = {
      model: testCase.model,
      displayName: draft.name,
      officialName: draft.officialName,
      description: draft.description,
      specs: drafted.specs,
      tags: draft.tags,
      materials: draft.materials,
      ppeRequired: draft.ppeRequired,
      useRestrictions: draft.useRestrictions,
      zone: zoneName,
      resources: drafted.resources.map((resource) => ({ title: resource.title, type: resource.type, url: resource.url })),
      sources: researched.value.pages,
    };
    result.listingForJudge = listing;

    // The judges, side by side: the listing, the top three photos, the cutout, and the baseline.
    const golden = await readGolden(testCase.id);
    const candidates = image.value.images?.candidates ?? [];
    const topBytes = candidates[0] ? await downloadImage(candidates[0].url) : null;
    const before = baseline?.cases[testCase.id]?.listing ?? null;
    const newIsA = newIsAFor(testCase.id);
    const [listingJudged, photos, cutout, pairwise] = await Promise.all([
      judgeCall(LISTING_JUDGE_SYSTEM, listingJudgePrompt(listing, golden)),
      Promise.all(
        candidates
          .slice(0, TOP_JUDGED)
          .map((candidate, index) => gradePhoto(candidate, testCase, index === 0 && topBytes && "bytes" in topBytes ? topBytes.bytes : null))
      ),
      candidates[0] && topBytes && "bytes" in topBytes
        ? gradeCutout(candidates[0], testCase, topBytes.bytes, outDir)
        : Promise.resolve({ cutout: candidates[0] ? ({ kind: "error", error: "download failed" } as CutoutResult) : null, cost: 0 }),
      before && hashOf({ ...before, sources: [] }) !== hashOf({ ...listing, sources: [] })
        ? judgeCall(PAIRWISE_JUDGE_SYSTEM, newIsA ? pairwisePrompt(testCase.model, listing, before) : pairwisePrompt(testCase.model, before, listing))
        : Promise.resolve(null),
    ]);
    result.listing = parseListingVerdict(listingJudged.text);
    result.top = photos.map(({ cost: _cost, ...graded }) => graded);
    result.cutout = cutout.cutout;
    result.pairwise = pairwise ? parsePairwise(pairwise.text, newIsA) : before ? { outcome: "same", reason: "identical to the baseline" } : null;
    result.cost.judge = listingJudged.cost + photos.reduce((total, photo) => total + photo.cost, 0) + cutout.cost + (pairwise?.cost ?? 0);
    if (!result.listing) result.error = `the listing judge's reply could not be read: ${listingJudged.text.slice(0, 200)}`;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }
  return done();
}

function gitCommit(): string | null {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

async function readBaseline(): Promise<Baseline | null> {
  try {
    return JSON.parse(await readFile(BASELINE_FILE, "utf8")) as Baseline;
  } catch {
    return null;
  }
}

describe("ideal-lab eval", () => {
  beforeAll(() => {
    // The demo seed in memory, never a real database: nothing here writes, and categories come from the default tree.
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("PGLITE_DATA_DIR", "");
    for (const key of getNotionEnvContract()) vi.stubEnv(key, "");
    if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
      throw new Error("AI_GATEWAY_API_KEY (or VERCEL_OIDC_TOKEN) is required: every stage and judge runs through the Gateway.");
    }
  });

  it("adds the golden ten end to end and grades them (reported; EVAL_IL_STRICT=1 fails on a regression)", async () => {
    const filter = process.env.EVAL_IL_CASE?.trim().toLowerCase();
    const cases = IDEAL_LAB_CASES.filter((testCase) => !filter || testCase.id.includes(filter)).filter(
      (testCase) => process.env.EVAL_IL_HOLDOUT !== "0" || !testCase.holdout
    );
    if (cases.length === 0) throw new Error(`No case matches EVAL_IL_CASE=${process.env.EVAL_IL_CASE}`);

    const goldenMode = process.env.EVAL_IL_GOLDEN?.trim();
    if (goldenMode) {
      let cost = 0;
      for (const testCase of cases) {
        if (goldenMode !== "force" && (await readGolden(testCase.id))) continue;
        cost += await writeGolden(testCase);
        console.info(`[ideal-lab] golden written: ${testCase.id}`);
      }
      console.info(`[ideal-lab] golden listings in ${path.relative(process.cwd(), GOLDEN_DIR)} — cost $${cost.toFixed(2)}`);
      return;
    }

    const runId = new Date().toISOString().replace(/[:.]/g, "-");
    const outDir = path.join(WORK_DIR, "runs", runId);
    await mkdir(outDir, { recursive: true });
    const baseline = await readBaseline();

    const results: CaseResult[] = [];
    // One at a time: Exa and the Gateway are rate limited, and the log reads in order.
    for (const testCase of cases) {
      const result = await runCase(testCase, baseline, outDir);
      console.info(`[ideal-lab] ${loopPass(result) ? "PASS" : "FAIL"} ${testCase.id} (${result.seconds.toFixed(0)} s)${result.error ? ` — ${result.error}` : ""}`);
      results.push(result);
    }

    const summary = summarize(results);
    const report = formatReport(results, summary, baseline);
    console.info(`\n${report}`);
    await writeFile(path.join(outDir, "report.txt"), report);
    await writeFile(path.join(outDir, "report.json"), JSON.stringify({ judgeModel: judgeModelId(), commit: gitCommit(), summary, results }, null, 2));
    await writeFile(path.join(outDir, "hand-grades.md"), handGradeSheet(results, runId));
    console.info(`Report: ${path.relative(process.cwd(), outDir)}`);

    if (process.env.EVAL_IL_FREEZE === "1") {
      if (filter || process.env.EVAL_IL_HOLDOUT === "0") throw new Error("Freeze a full run: unset EVAL_IL_CASE and EVAL_IL_HOLDOUT.");
      const frozen: Baseline = {
        frozenAt: new Date().toISOString(),
        commit: gitCommit(),
        models: Object.fromEntries(["chat", "researchSearch", "researchRead", "imageRank"].map((job) => [job, modelIdFor(job as "chat")])),
        judgeModel: judgeModelId(),
        summary,
        cases: Object.fromEntries(results.map((result) => [result.id, { loopPass: loopPass(result), listing: result.listingForJudge ? { ...result.listingForJudge, sources: [] } : null }])),
      };
      await writeFile(BASELINE_FILE, `${JSON.stringify(frozen, null, 2)}\n`);
      console.info(`[ideal-lab] baseline frozen: ${path.relative(process.cwd(), BASELINE_FILE)}`);
    }

    expect(results.some((result) => result.checks !== null), "no case got past identification: check the Gateway key and the network").toBe(true);
    if (process.env.EVAL_IL_STRICT === "1" && baseline) {
      if (baseline.judgeModel !== judgeModelId()) throw new Error(`The baseline was judged by ${baseline.judgeModel}; this run by ${judgeModelId()}. Not comparable.`);
      expect(regressions(summary, baseline.summary)).toEqual([]);
    }
  });
});

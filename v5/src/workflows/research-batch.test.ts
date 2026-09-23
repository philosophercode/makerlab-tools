// @vitest-environment node
import { FatalError } from "workflow";

/**
 * `researchBatch` as a plain function (spec §10). Without the workflow compiler
 * `"use workflow"` and `"use step"` are only strings, so the steps module is
 * mocked here and the orchestration is what is under test: fixed chunks of
 * three, every item in a chunk settled before the next starts, a failure
 * marked and the rest carried on, the image stage's failure caught into
 * `completeWithoutImages` rather than failing the item, and the same calls in
 * the same order every time — which is what a replay needs.
 */

const log = vi.hoisted(() => [] as string[]);

const steps = vi.hoisted(() => ({
  searchItem: vi.fn(),
  readAndVerifyItem: vi.fn(),
  markItemFailed: vi.fn(),
  finishBatch: vi.fn(),
}));

const imageSteps = vi.hoisted(() => ({
  findImages: vi.fn(),
  completeWithoutImages: vi.fn(),
}));

const allSteps = [...Object.values(steps), ...Object.values(imageSteps)];

vi.mock("../lib/research/steps", () => steps);
vi.mock("../lib/research/image-steps", () => imageSteps);

import { researchBatch } from "./research-batch";

const FINDINGS = { canonicalName: "x", description: "", category: null, candidateLinks: [], sourceUrls: [], evidence: {} };
const EXA_IMAGE = { url: "https://cdn.example/exa.jpg", source: "exa", pageUrl: null };
const PAGE_IMAGE = { url: "https://maker.example/og.jpg", source: "og", pageUrl: "https://maker.example/" };
const draft = (id: string) => ({ canonicalName: `draft ${id}` });

const SEARCH_TEXT = { url: "https://maker.example/p1", title: "P1", text: "The P1 is a printer. ".repeat(20) };

/** Every item researches after a delay that varies, so completion order is not call order. */
function behave(
  opts: { failing?: Record<string, Error>; skipping?: string[]; imagesFailing?: Record<string, Error> } = {}
) {
  const delay = (id: string) => new Promise((resolve) => setTimeout(resolve, (id.charCodeAt(id.length - 1) * 7) % 11));

  steps.searchItem.mockImplementation(async (id: string) => {
    log.push(`search:${id}`);
    await delay(id);
    if (opts.failing?.[id]) throw opts.failing[id];
    if (opts.skipping?.includes(id)) return { skip: true };
    return { skip: false, findings: FINDINGS, exaImages: [EXA_IMAGE], searchTexts: [SEARCH_TEXT] };
  });
  steps.readAndVerifyItem.mockImplementation(async (id: string) => {
    log.push(`read:${id}`);
    await delay(id);
    return { outcome: "drafted", result: draft(id), imageHints: [PAGE_IMAGE] };
  });
  imageSteps.findImages.mockImplementation(async (id: string) => {
    log.push(`images:${id}`);
    await delay(id);
    if (opts.imagesFailing?.[id]) throw opts.imagesFailing[id];
    return { outcome: "researched", confidence: "high" };
  });
  imageSteps.completeWithoutImages.mockImplementation(async (id: string, _requestId: string, _result: unknown, reason: string) => {
    log.push(`without-images:${id}:${reason}`);
    return { outcome: "researched", confidence: "high" };
  });
  steps.markItemFailed.mockImplementation(async (id: string, _requestId: string, message: string) => {
    log.push(`failed:${id}:${message}`);
    return true;
  });
  steps.finishBatch.mockImplementation(async () => {
    log.push("finish");
  });
}

beforeEach(() => {
  log.length = 0;
  for (const fn of allSteps) fn.mockReset();
});

describe("researchBatch", () => {
  it("researches in chunks of three: a chunk's searches all start before the next chunk's", async () => {
    behave();
    const ids = ["a1", "a2", "a3", "b1", "b2", "b3", "c1"];

    expect(await researchBatch("req-1", ids)).toEqual({ researched: 7, failed: 0 });

    const searches = log.filter((entry) => entry.startsWith("search:"));
    expect(searches).toEqual(ids.map((id) => `search:${id}`));
    // No item of the second chunk starts until every item of the first is done.
    const lastOfFirst = Math.max(...["a1", "a2", "a3"].map((id) => log.indexOf(`images:${id}`)));
    expect(log.indexOf("search:b1")).toBeGreaterThan(lastOfFirst);
    expect(log.at(-1)).toBe("finish");
    expect(steps.finishBatch).toHaveBeenCalledWith("req-1", { researched: 7, failed: 0, skipped: 0 });
  });

  it("marks a failing item failed with its reason while the others complete", async () => {
    behave({ failing: { a2: new FatalError("Research (search): the model provider refused the request (HTTP 400).") } });

    expect(await researchBatch("req-2", ["a1", "a2", "a3", "b1"])).toEqual({ researched: 3, failed: 1 });

    expect(steps.markItemFailed).toHaveBeenCalledTimes(1);
    expect(steps.markItemFailed).toHaveBeenCalledWith(
      "a2",
      "req-2",
      "Research (search): the model provider refused the request (HTTP 400)."
    );
    expect(steps.readAndVerifyItem.mock.calls.map(([id]) => id)).toEqual(["a1", "a3", "b1"]);
    expect(imageSteps.findImages.mock.calls.map(([id]) => id)).toEqual(["a1", "a3", "b1"]);
    // The failure is recorded before the next chunk starts.
    expect(log.indexOf(`failed:a2:${steps.markItemFailed.mock.calls[0][2]}`)).toBeLessThan(log.indexOf("search:b1"));
  });

  it("hands every step the request id it was started with", async () => {
    behave({ failing: { a2: new Error("nope") } });
    await researchBatch("req-7", ["a1", "a2"]);
    expect(steps.searchItem.mock.calls.map(([, requestId]) => requestId)).toEqual(["req-7", "req-7"]);
    expect(steps.readAndVerifyItem.mock.calls.map(([, requestId]) => requestId)).toEqual(["req-7"]);
    expect(imageSteps.findImages.mock.calls.map(([, requestId]) => requestId)).toEqual(["req-7"]);
    expect(steps.markItemFailed.mock.calls.map(([, requestId]) => requestId)).toEqual(["req-7"]);
  });

  it("counts an item that skipped as neither researched nor failed", async () => {
    behave({ skipping: ["a1"] });
    expect(await researchBatch("req-3", ["a1", "a2"])).toEqual({ researched: 1, failed: 0 });
    expect(steps.readAndVerifyItem).toHaveBeenCalledTimes(1);
    expect(imageSteps.findImages).toHaveBeenCalledTimes(1);
    expect(steps.finishBatch).toHaveBeenCalledWith("req-3", { researched: 1, failed: 0, skipped: 1 });
  });

  it("keeps going when a failure cannot even be recorded", async () => {
    behave({ failing: { a1: new Error("boom") } });
    steps.markItemFailed.mockRejectedValue(new Error("database down"));
    expect(await researchBatch("req-4", ["a1", "a2", "a3", "b1"])).toEqual({ researched: 3, failed: 1 });
    expect(steps.finishBatch).toHaveBeenCalled();
  });

  it("issues the same calls in the same order every run", async () => {
    const ids = ["a1", "a2", "a3", "b1", "b2"];
    const failing = { b1: new Error("nope") };

    behave({ failing });
    await researchBatch("req-5", ids);
    const first = steps.searchItem.mock.calls.map(([id]) => id);
    const firstFailed = steps.markItemFailed.mock.calls.map(([id]) => id);
    const firstImages = imageSteps.findImages.mock.calls.map(([id]) => id);

    for (const fn of allSteps) fn.mockReset();
    behave({ failing });
    await researchBatch("req-5", ids);

    expect(steps.searchItem.mock.calls.map(([id]) => id)).toEqual(first);
    expect(steps.markItemFailed.mock.calls.map(([id]) => id)).toEqual(firstFailed);
    expect(imageSteps.findImages.mock.calls.map(([id]) => id)).toEqual(firstImages);
    expect(first).toEqual(ids);
    expect([...firstImages].sort()).toEqual(["a1", "a2", "a3", "b2"]);
  });

  it("runs search, read and the image stage in that order, handing each the one before's output", async () => {
    behave();
    await researchBatch("req-8", ["a1"]);

    expect(log.filter((entry) => entry !== "finish")).toEqual(["search:a1", "read:a1", "images:a1"]);
    // The search's captured page texts travel on to the read step, for a page it cannot open.
    expect(steps.readAndVerifyItem).toHaveBeenCalledWith("a1", "req-8", FINDINGS, null, [SEARCH_TEXT]);
    // The read pages' images first, then Exa's.
    expect(imageSteps.findImages).toHaveBeenCalledWith("a1", "req-8", draft("a1"), [PAGE_IMAGE, EXA_IMAGE]);
    expect(imageSteps.completeWithoutImages).not.toHaveBeenCalled();
  });

  it("writes the item without images when the image stage throws, and counts it researched", async () => {
    behave({ imagesFailing: { a2: new Error("The image search failed unexpectedly (DrizzleQueryError).") } });

    expect(await researchBatch("req-9", ["a1", "a2", "a3"])).toEqual({ researched: 3, failed: 0 });

    expect(imageSteps.completeWithoutImages).toHaveBeenCalledTimes(1);
    expect(imageSteps.completeWithoutImages).toHaveBeenCalledWith(
      "a2",
      "req-9",
      draft("a2"),
      "The image search failed unexpectedly (DrizzleQueryError)."
    );
    expect(steps.markItemFailed).not.toHaveBeenCalled();
    expect(steps.finishBatch).toHaveBeenCalledWith("req-9", { researched: 3, failed: 0, skipped: 0 });
  });

  it("fails the item only when even the fallback write fails", async () => {
    behave({ imagesFailing: { a1: new Error("images down") } });
    imageSteps.completeWithoutImages.mockRejectedValue(new Error("database down"));

    expect(await researchBatch("req-10", ["a1", "a2"])).toEqual({ researched: 1, failed: 1 });
    expect(steps.markItemFailed).toHaveBeenCalledWith("a1", "req-10", "database down");
  });

  it("stops an item the read step skipped before the image stage", async () => {
    behave();
    steps.readAndVerifyItem.mockImplementation(async () => ({ outcome: "skipped" }));

    expect(await researchBatch("req-11", ["a1"])).toEqual({ researched: 0, failed: 0 });
    expect(imageSteps.findImages).not.toHaveBeenCalled();
    expect(steps.finishBatch).toHaveBeenCalledWith("req-11", { researched: 0, failed: 0, skipped: 1 });
  });

  it("counts an item the image stage found no longer this run's as skipped", async () => {
    behave();
    imageSteps.findImages.mockImplementation(async () => ({ outcome: "skipped" }));
    expect(await researchBatch("req-12", ["a1"])).toEqual({ researched: 0, failed: 0 });
    expect(steps.finishBatch).toHaveBeenCalledWith("req-12", { researched: 0, failed: 0, skipped: 1 });
  });

  it("finishes an empty batch without researching anything", async () => {
    behave();
    expect(await researchBatch("req-6", [])).toEqual({ researched: 0, failed: 0 });
    expect(steps.searchItem).not.toHaveBeenCalled();
    expect(steps.finishBatch).toHaveBeenCalledWith("req-6", { researched: 0, failed: 0, skipped: 0 });
  });
});

// @vitest-environment node
import { Canvas, type Rgba } from "../../../../test/images/synthetic";
import { ModelOutputError } from "../model-output";
import { parseCutoutCheck } from "./check-cutout";
import { chooseCleanCover, COVER_GATE_ATTEMPTS } from "./cover-gate";

vi.mock("@/lib/ai/models", async (importOriginal) =>
  (await import("../../../../test/ai/models-stub")).stubModelsModule(await importOriginal())
);

import { recordedCalls, resetModelStubs, setLanguageModel, textModel } from "../../../../test/ai/models-stub";

/**
 * The image quality gate (ideal-lab eval follow-up, 2026-11-10): cut, check
 * the copy, fall back to the next picture. Real `sharp`, synthetic pictures,
 * the check model stubbed at the registry.
 */

const BLUE: Rgba = [30, 60, 160, 255];
const signal = () => AbortSignal.timeout(10_000);

/** A blue machine on a plain white backdrop: the cut always succeeds. */
async function plainShot() {
  return { bytes: await new Canvas(800, 600).rect(200, 150, 400, 300, BLUE).png(), background: "plain" as const, composite: false, productBox: null };
}

const PASS = JSON.stringify({ sameMachine: true, backgroundRemoved: true, productIntact: true, cleanEdges: true, goodCover: true, reason: "clean" });
const LEFT = JSON.stringify({ sameMachine: true, backgroundRemoved: false, productIntact: true, cleanEdges: true, goodCover: true, reason: "backdrop left" });

afterEach(resetModelStubs);

describe("parseCutoutCheck", () => {
  it("passes only when all five answers are true, and names each problem", () => {
    expect(parseCutoutCheck(PASS)).toEqual({ ok: true, problems: [], reason: "clean" });
    expect(
      parseCutoutCheck('```json\n{"sameMachine": false, "backgroundRemoved": true, "productIntact": false, "cleanEdges": true, "goodCover": false}\n```')
    ).toEqual({ ok: false, problems: ["not_same_machine", "product_damaged", "poor_cover"], reason: "" });
  });

  it("refuses an answer with a missing or non-boolean field", () => {
    expect(() => parseCutoutCheck('{"sameMachine": "yes", "backgroundRemoved": true, "productIntact": true, "cleanEdges": true, "goodCover": true}')).toThrow(ModelOutputError);
    expect(() => parseCutoutCheck('{"sameMachine": true}')).toThrow(ModelOutputError);
    expect(() => parseCutoutCheck("looks fine")).toThrow(ModelOutputError);
  });
});

describe("chooseCleanCover", () => {
  it("keeps rank 1's copy when the check passes: one check, the original and the copy on magenta", async () => {
    const model = textModel(PASS);
    setLanguageModel("imageRank", model);
    const result = await chooseCleanCover("Bambu Lab P1S", [await plainShot(), await plainShot()], { signal: signal() });

    expect(result).toMatchObject({ index: 0, copy: { made: true, kind: "cut" }, rejected: [] });
    const calls = recordedCalls(model);
    expect(calls).toHaveLength(1);
    const parts = calls[0].prompt.find((message) => message.role === "user")!.content as { type: string }[];
    expect(parts.filter((part) => part.type === "file")).toHaveLength(2);
  });

  it("falls back to the next picture when rank 1's copy is rejected, and marks rank 1", async () => {
    setLanguageModel("imageRank", textModel((i) => (i === 0 ? LEFT : PASS)));
    const result = await chooseCleanCover("Hakko FX-888DX", [await plainShot(), await plainShot()], { signal: signal() });
    expect(result).toMatchObject({ index: 1, copy: { made: true }, rejected: [0] });
  });

  it("keeps no copy when every copy is rejected: rank 1 stays first, noted cutout_rejected", async () => {
    const model = textModel(LEFT);
    setLanguageModel("imageRank", model);
    const shots = await Promise.all(Array.from({ length: 5 }, plainShot));
    const result = await chooseCleanCover("Hakko FX-888DX", shots, { signal: signal() });
    expect(result).toEqual(expect.objectContaining({ index: 0, copy: { made: false, note: "cutout_rejected" }, rejected: [0, 1, 2] }));
    expect(recordedCalls(model)).toHaveLength(COVER_GATE_ATTEMPTS);
  });

  it("passes over a picture it cannot cut, and makes no call for it", async () => {
    const model = textModel(PASS);
    setLanguageModel("imageRank", model);
    const busy = { ...(await plainShot()), background: "busy" as const };
    const result = await chooseCleanCover("Prusa Core One", [busy, await plainShot()], { signal: signal() });
    expect(result).toMatchObject({ index: 1, copy: { made: true }, rejected: [] });
    expect(recordedCalls(model)).toHaveLength(1);
  });

  it("keeps rank 1's note when nothing could be cut", async () => {
    setLanguageModel("imageRank", textModel(PASS));
    const busy = { ...(await plainShot()), background: "busy" as const };
    expect(await chooseCleanCover("Prusa Core One", [busy, busy], { signal: signal() })).toMatchObject({
      index: 0,
      copy: { made: false, note: "busy_background" },
      rejected: [],
    });
  });

  it("lets an already transparent picture win as it is, with no check", async () => {
    const model = textModel(PASS);
    setLanguageModel("imageRank", model);
    const clear = { ...(await plainShot()), background: "transparent" as const };
    expect(await chooseCleanCover("UR5e", [clear], { signal: signal() })).toMatchObject({ index: 0, copy: { made: false, note: null } });
    expect(recordedCalls(model)).toHaveLength(0);
  });

  it("keeps the copy when the check's answer cannot be read", async () => {
    setLanguageModel("imageRank", textModel("not json"));
    const result = await chooseCleanCover("UR5e", [await plainShot()], { signal: signal() });
    expect(result).toMatchObject({ index: 0, copy: { made: true }, rejected: [], checks: [null] });
  });
});

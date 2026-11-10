// @vitest-environment node
import { ModelOutputError, parseFetchDraft } from "./model-output";
import { checkAndReviseListing, LISTING_CHECK_HEADING, MAX_LISTING_ISSUES, parseListingCheck } from "./listing-check";

vi.mock("@/lib/ai/models", async (importOriginal) =>
  (await import("../../../test/ai/models-stub")).stubModelsModule(await importOriginal())
);

import { recordedCalls, resetModelStubs, setLanguageModel, textModel } from "../../../test/ai/models-stub";

/**
 * The listing's quality gate (ideal-lab eval follow-up, 2026-11-10): one check
 * against the same pages, one revision when it finds a problem, the original
 * kept whenever either cannot be used. The model is stubbed at the registry.
 */

const DRAFT = {
  officialName: "Trotec Speedy 400",
  displayName: "Speedy 400",
  description: "A CO2 laser cutter with a 1000 × 610 mm bed and a flexx fiber source.",
  specs: [{ label: "Laser power", value: "120 W CO2 + 30 W fiber (flexx)" }],
};
const DRAFT_TEXT = JSON.stringify(DRAFT);
const REVISED = { ...DRAFT, description: "A CO2 laser cutter with a 1000 × 610 mm bed; students cut acrylic signs, plywood boxes and leather tags." };
const ISSUE = { kind: "other_variant", field: "specs", problem: "The fiber source is the flexx model's.", fix: "Keep only the CO2 laser." };

const read = { system: "the read system prompt", messages: [{ role: "user" as const, content: "the pages" }] };
const opts = () => ({ signal: AbortSignal.timeout(10_000), requestId: "req-1" });

afterEach(resetModelStubs);

describe("parseListingCheck", () => {
  it("reads issues of the known kinds, and none when ok", () => {
    expect(parseListingCheck(JSON.stringify({ ok: false, issues: [ISSUE, { kind: "vibes", problem: "x" }, { kind: "unsafe" }] }))).toEqual([ISSUE]);
    expect(parseListingCheck(JSON.stringify({ ok: true, issues: [ISSUE] }))).toEqual([]);
    expect(parseListingCheck(JSON.stringify({ ok: false, issues: Array.from({ length: 20 }, () => ISSUE) }))).toHaveLength(MAX_LISTING_ISSUES);
  });

  it("refuses an answer without a boolean ok and an issues array — a draft is not a check", () => {
    expect(() => parseListingCheck(DRAFT_TEXT)).toThrow(ModelOutputError);
    expect(() => parseListingCheck('{"ok": "yes", "issues": []}')).toThrow(ModelOutputError);
    expect(() => parseListingCheck('{"ok": false}')).toThrow(ModelOutputError);
  });
});

describe("checkAndReviseListing", () => {
  it("keeps a draft the check passes, after one call that continues the read conversation", async () => {
    const model = textModel(JSON.stringify({ ok: true, issues: [] }));
    setLanguageModel("researchRead", model);
    const draft = parseFetchDraft(DRAFT_TEXT);

    const result = await checkAndReviseListing(read, DRAFT_TEXT, draft, opts());

    expect(result).toEqual({ draft, issues: [], revised: false, checked: true });
    const calls = recordedCalls(model);
    expect(calls).toHaveLength(1);
    const roles = calls[0].prompt.map((message) => message.role);
    expect(roles).toEqual(["system", "user", "assistant", "user"]);
    expect(JSON.stringify(calls[0].prompt)).toContain(LISTING_CHECK_HEADING);
    expect(calls[0].tools ?? []).toEqual([]);
  });

  it("revises once when the check finds a problem, rechecks the revision, and keeps it when it has fewer problems", async () => {
    const answers = [{ ok: false, issues: [ISSUE] }, REVISED, { ok: true, issues: [] }];
    const model = textModel((call) => JSON.stringify(answers[call]));
    setLanguageModel("researchRead", model);
    const draft = { ...parseFetchDraft(DRAFT_TEXT), sourceUrls: ["https://www.troteclaser.com/speedy-400"] };

    const result = await checkAndReviseListing(read, DRAFT_TEXT, draft, opts());

    expect(result.revised).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.draft.description).toBe(REVISED.description);
    expect(result.draft.sourceUrls).toEqual(draft.sourceUrls);
    expect(recordedCalls(model)).toHaveLength(3);
    expect(recordedCalls(model)[1].prompt.map((message) => message.role)).toEqual(["system", "user", "assistant", "user", "assistant", "user"]);
    // The recheck sees the revision as the assistant's draft.
    expect(JSON.stringify(recordedCalls(model)[2].prompt)).toContain("students cut acrylic signs");
  });

  it("keeps the first draft when the revision fixes nothing", async () => {
    const answers = [{ ok: false, issues: [ISSUE] }, REVISED, { ok: false, issues: [ISSUE] }];
    setLanguageModel("researchRead", textModel((call) => JSON.stringify(answers[call])));
    const draft = parseFetchDraft(DRAFT_TEXT);
    expect(await checkAndReviseListing(read, DRAFT_TEXT, draft, opts())).toEqual({ draft, issues: [ISSUE], revised: false, checked: true });
  });

  it("keeps the original when the revision is not a whole draft", async () => {
    setLanguageModel("researchRead", textModel((call) => JSON.stringify(call === 0 ? { ok: false, issues: [ISSUE] } : { ok: true, issues: [] })));
    const draft = parseFetchDraft(DRAFT_TEXT);
    expect(await checkAndReviseListing(read, DRAFT_TEXT, draft, opts())).toEqual({ draft, issues: [ISSUE], revised: false, checked: true });
  });

  it("keeps the original when the check's answer cannot be read", async () => {
    setLanguageModel("researchRead", textModel("Looks good to me."));
    const draft = parseFetchDraft(DRAFT_TEXT);
    expect(await checkAndReviseListing(read, DRAFT_TEXT, draft, opts())).toEqual({ draft, issues: [], revised: false, checked: false });
  });
});

// @vitest-environment node
import { APICallError } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { eq } from "drizzle-orm";
import { fakeEmbeddingTarget } from "../../../test/ai/fake-embeddings";
import { recordedCalls, textModel } from "../../../test/ai/models-stub";
import { seedManual, seedTool } from "../../../test/manuals/seed";
import { currentToolSkill, latestToolSkill } from "../data/tool-skills";
import { createPgliteDb } from "../db/pglite";
import { pendingTools, tools, toolSkills } from "../db/schema/index";
import type { Db } from "../db/types";
import { buildDocumentPassages } from "../manuals/passages";
import { skillSectionsSchema, skillSourcesSchema } from "./format";
import { skillInputHash } from "./hash";
import { assembleSkillInputs } from "./inputs";
import { SKILL_DAILY_LIMIT } from "./limits";
import { SKILL_PROMPT_VERSION } from "./prompt";
import { writeToolSkill } from "./write";

/**
 * Writing a tool skill (tool skills spec 2026-10-07 §5.1–§5.3): the sources
 * assembled from the database (public manual files only), one model call, the
 * checks, the lab's facts first, a versioned row with its hash and cost — and
 * every skip and failure as a value. PGlite in process; the model is a stub.
 */

const PAGES = [
  "Operating the laser\nTurn on the exhaust fan, then switch on the laser with the key. Load your file from the job control software and press start. Operate only with the lid closed.",
  "Settings\nFor 3 mm acrylic use power 80 and speed 1.5. Never cut PVC. Focus with the focus tool before each job and check the speed settings.",
  "Troubleshooting\nIf the cut does not go through, check the focus distance and clean the lens. Error E-12 means the lid is open.",
];
const OUTLINE = [
  { title: "Operating the laser", page: 1, level: 1 },
  { title: "Settings", page: 2, level: 1 },
  { title: "Troubleshooting", page: 3, level: 1 },
];

let db: Db;
let toolId: string;

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await db.delete(toolSkills);
  await db.delete(tools);
  toolId = await seedTool(db, { name: "Trotec Speedy 400", slug: "trotec-speedy-400" });
  await db
    .update(tools)
    .set({
      trainingRequired: true,
      ppeRequired: ["Safety glasses"],
      emergencyStop: "Red button on the right of the lid",
      notes: "Put a cutting mat under thin work.",
    })
    .where(eq(tools.id, toolId));
  const { documentId } = await seedManual(db, { toolId, title: "Speedy 400 Manual", pages: PAGES, outline: OUTLINE });
  await buildDocumentPassages(db, documentId, { target: fakeEmbeddingTarget() });
});

afterEach(() => vi.restoreAllMocks());

/** The model's answer: one cited setting, one uncited one, steps and a safety line. */
function answer(manualId = "M1"): string {
  return JSON.stringify({
    quickFacts: [{ text: "A CO2 laser cutter", cites: ["T1"] }],
    operatingProcedure: [
      { text: "Turn on the exhaust fan", cites: [manualId] },
      { text: "Load the file and press start", cites: [manualId] },
    ],
    settingsAndLimits: [
      { text: "3 mm acrylic: power 80, speed 1.5", cites: [manualId] },
      { text: "Maximum power 120 W", cites: [] },
    ],
    troubleshooting: [{ symptom: "Cut does not go through", check: "Focus distance", fix: "Refocus and clean the lens", cites: [manualId] }],
    safety: [{ text: "Never cut PVC", cites: [manualId] }],
    whenToGetStaff: [],
    notInSources: ["Maximum material size"],
  });
}

function promptOf(model: MockLanguageModelV3): string {
  return JSON.stringify(recordedCalls(model)[0].prompt);
}

describe("writeToolSkill", () => {
  it("writes a checked, versioned skill with the lab's facts first, its sources, hash and trigger", async () => {
    const model = textModel(answer());
    const outcome = await writeToolSkill(db, toolId, { trigger: "manual", model });
    expect(outcome).toMatchObject({ status: "written", version: 1, removed: 1, model: "gateway/stub/model" });

    const row = await currentToolSkill(db, toolId);
    expect(row).toMatchObject({ version: 1, status: "ready", trigger: "manual", model: "gateway/stub/model", costUsd: 0, error: null });
    expect(row!.inputHash).toMatch(/^sha256:[0-9a-f]{64}$/);

    const sections = skillSectionsSchema.parse(row!.sections);
    expect(sections.beforeYouStart[0]).toEqual({ text: "Lab note: Put a cutting mat under thin work.", cites: ["N1"], origin: "lab" });
    expect(sections.safety[0].text).toBe("Emergency stop: Red button on the right of the lid");
    // The numbers guard took out the uncited figure and kept a record.
    expect(sections.settingsAndLimits.map((item) => item.text)).toEqual(["3 mm acrylic: power 80, speed 1.5"]);
    expect(sections.removed).toEqual([{ section: "settingsAndLimits", text: "Maximum power 120 W", reason: "uncited_number" }]);

    const sources = skillSourcesSchema.parse(row!.sources);
    expect(sources.map((source) => source.id)).toEqual(["T1", "N1", "M1"]);
    expect(sources[2]).toMatchObject({ kind: "manual", title: "Speedy 400 Manual" });
    expect(JSON.stringify(sources)).not.toContain("blob.test");

    expect(row!.content).toContain("# Trotec Speedy 400: operating guide");
    expect(row!.content).toContain("version: 1");
    expect(row!.content).not.toContain("Maximum power 120 W");

    // One call, on flex, with the manual fenced and the hard rules in the system prompt.
    const calls = recordedCalls(model);
    expect(calls).toHaveLength(1);
    // Opus takes no tier hint (amendment "Opus writes from the manuals").
    expect(calls[0].providerOptions).toBeUndefined();
    expect(promptOf(model)).toContain("untrusted-page");
    expect(promptOf(model)).toContain("not in the lab's sources");
  });

  it("skips a tool whose inputs have not changed, and rewrites when one does", async () => {
    const model = textModel(answer());
    await writeToolSkill(db, toolId, { trigger: "manual", model });
    expect(await writeToolSkill(db, toolId, { trigger: "research", model })).toEqual({ status: "skipped", toolId, reason: "up_to_date", version: 1 });
    expect(recordedCalls(model)).toHaveLength(1);

    await db.update(tools).set({ notes: "Put a cutting mat under thin work.\nNo PVC, ever." }).where(eq(tools.id, toolId));
    expect(await writeToolSkill(db, toolId, { trigger: "research", model })).toMatchObject({ status: "written", version: 2 });
    expect(recordedCalls(model)).toHaveLength(2);
    expect((await currentToolSkill(db, toolId))!.trigger).toBe("research");
  });

  it("writes again with force, even when nothing changed", async () => {
    const model = textModel(answer());
    await writeToolSkill(db, toolId, { trigger: "manual", model });
    expect(await writeToolSkill(db, toolId, { trigger: "manual", model, force: true })).toMatchObject({ status: "written", version: 2 });
  });

  it("hashes the inputs, the prompt version and the model — the same inputs always the same", async () => {
    const inputs = await assembleSkillInputs(db, toolId);
    const a = skillInputHash(inputs!, { model: "openai/gpt-6-luna", promptVersion: SKILL_PROMPT_VERSION });
    const b = skillInputHash((await assembleSkillInputs(db, toolId))!, { model: "openai/gpt-6-luna", promptVersion: SKILL_PROMPT_VERSION });
    expect(a).toBe(b);
    expect(skillInputHash(inputs!, { model: "openai/gpt-6-sol", promptVersion: SKILL_PROMPT_VERSION })).not.toBe(a);
    expect(skillInputHash(inputs!, { model: "openai/gpt-6-luna", promptVersion: "skill-0" })).not.toBe(a);
    // Publishing a draft changes nothing the skill says.
    const published = { ...inputs!, tool: { ...inputs!.tool, published: !inputs!.tool.published } };
    expect(skillInputHash(published, { model: "openai/gpt-6-luna", promptVersion: SKILL_PROMPT_VERSION })).toBe(a);
  });

  it("stores a failed attempt for an unreadable answer; the pass after research then leaves it, Rewrite tries again", async () => {
    const bad = textModel("I cannot help with that.");
    expect(await writeToolSkill(db, toolId, { trigger: "research", model: bad })).toMatchObject({ status: "failed", reason: "unreadable", recorded: true });
    const failed = await latestToolSkill(db, toolId);
    expect(failed).toMatchObject({ version: 1, status: "failed", content: "", error: "The model's answer could not be read as a skill." });
    expect(await currentToolSkill(db, toolId)).toBeNull();

    expect(await writeToolSkill(db, toolId, { trigger: "research", model: bad })).toMatchObject({ status: "skipped", reason: "failed_before" });
    expect(recordedCalls(bad)).toHaveLength(1);
    expect(await writeToolSkill(db, toolId, { trigger: "manual", model: textModel(answer()) })).toMatchObject({ status: "written", version: 2 });
  });

  it("fails as empty when nothing the model wrote survives the checks", async () => {
    const model = textModel(JSON.stringify({ settingsAndLimits: [{ text: "Power 100%", cites: [] }], safety: [{ text: "Goggles are optional", cites: ["M1"] }] }));
    expect(await writeToolSkill(db, toolId, { trigger: "manual", model })).toMatchObject({ status: "failed", reason: "empty", recorded: true });
    expect((await latestToolSkill(db, toolId))!.error).toMatch(/2 item\(s\) removed/);
  });

  it("returns a transient model failure without storing it (the step retries), and stores a refused call", async () => {
    const throwing = (statusCode: number) =>
      new MockLanguageModelV3({
        provider: "gateway",
        modelId: "stub/model",
        doGenerate: async () => {
          throw new APICallError({ message: "no", url: "https://ai-gateway.vercel.sh/v3/ai", requestBodyValues: {}, statusCode, isRetryable: false });
        },
      });
    expect(await writeToolSkill(db, toolId, { trigger: "research", model: throwing(429) })).toMatchObject({ status: "failed", reason: "model", kind: "rate_limited", transient: true, recorded: false });
    expect(await latestToolSkill(db, toolId)).toBeNull();
    expect(await writeToolSkill(db, toolId, { trigger: "manual", model: throwing(400) })).toMatchObject({ status: "failed", kind: "invalid_request", transient: false, recorded: true });
    expect((await latestToolSkill(db, toolId))!.status).toBe("failed");
  });

  it("asks nothing for a tool with nothing beyond its catalogue record, or one that is archived or gone", async () => {
    const bare = await seedTool(db, { name: "Bench vise", slug: "bench-vise" });
    const model = textModel(answer());
    expect(await writeToolSkill(db, bare, { trigger: "research", model })).toEqual({ status: "skipped", toolId: bare, reason: "nothing_to_write" });
    const archived = await seedTool(db, { name: "Old drill", slug: "old-drill", archived: true });
    expect(await writeToolSkill(db, archived, { trigger: "manual", model })).toEqual({ status: "skipped", toolId: archived, reason: "not_found" });
    expect(await writeToolSkill(db, "not-a-uuid", { trigger: "manual", model })).toMatchObject({ status: "skipped", reason: "not_found" });
    expect(recordedCalls(model)).toHaveLength(0);
  });

  it("writes from research alone, citing it as R1 with the pages it read", async () => {
    const bare = await seedTool(db, { name: "Bench vise", slug: "bench-vise-2" });
    await db.insert(pendingTools).values({
      batchId: crypto.randomUUID(),
      name: "Bench vise",
      status: "approved",
      createdToolId: bare,
      approvedAt: new Date(),
      research: researchResult(),
    });
    const inputs = await assembleSkillInputs(db, bare);
    expect(inputs!.research).toMatchObject({ id: "R1", urls: ["https://vise.example/product"] });
    expect(inputs!.research!.text).toContain("Jaw width: 150 mm");
    const model = textModel(JSON.stringify({ quickFacts: [{ text: "Jaw width 150 mm", cites: ["R1"] }] }));
    expect(await writeToolSkill(db, bare, { trigger: "manual", model })).toMatchObject({ status: "written" });
    expect(skillSourcesSchema.parse((await currentToolSkill(db, bare))!.sources).find((source) => source.id === "R1")).toMatchObject({
      kind: "research",
      urls: ["https://vise.example/product"],
    });
  });

  it("never gives the writer a private manual or a hidden resource — a skill is served to everyone", async () => {
    await seedManual(db, { toolId, title: "Staff SOP", pages: ["Operating secret staff procedure: the override code is kept in the office."], access: "private" });
    const hidden = await seedManual(db, { toolId, title: "Hidden manual", pages: ["Operating hidden procedure text about troubleshooting."], published: false });
    void hidden;
    const inputs = await assembleSkillInputs(db, toolId);
    expect(inputs!.passages.every((passage) => passage.title === "Speedy 400 Manual")).toBe(true);
  });

  it("finds a draft tool's public manual too", async () => {
    await db.update(tools).set({ published: false }).where(eq(tools.id, toolId));
    const inputs = await assembleSkillInputs(db, toolId);
    expect(inputs!.tool.published).toBe(false);
    expect(inputs!.passages.length).toBeGreaterThan(0);
  });

  it("plans in a dry run: an estimate, no call, nothing stored", async () => {
    const model = textModel(answer());
    const outcome = await writeToolSkill(db, toolId, { trigger: "backfill", model, dryRun: true });
    expect(outcome).toMatchObject({ status: "planned", version: 1, notes: 1, hasResearch: false });
    if (outcome.status !== "planned") throw new Error("unreachable");
    expect(outcome.passages).toBeGreaterThan(0);
    expect(outcome.estimatedInputTokens).toBeGreaterThan(500);
    expect(recordedCalls(model)).toHaveLength(0);
    expect(await latestToolSkill(db, toolId)).toBeNull();
  });

  it("stops at the daily cap when asked to, counting every row of the last 24 hours", async () => {
    const other = await seedTool(db, { name: "Filler", slug: "filler" });
    await db.insert(toolSkills).values(
      Array.from({ length: SKILL_DAILY_LIMIT }, (_, i) => ({ toolId: other, version: i + 1, status: "failed", inputHash: "x", model: "m", trigger: "research" }))
    );
    const model = textModel(answer());
    expect(await writeToolSkill(db, toolId, { trigger: "research", model, enforceCap: true })).toMatchObject({ status: "skipped", reason: "daily_limit" });
    // A day later the window has moved on.
    const tomorrow = new Date(Date.now() + 25 * 60 * 60_000);
    expect(await writeToolSkill(db, toolId, { trigger: "research", model, enforceCap: true, now: tomorrow })).toMatchObject({ status: "written" });
    // The backfill is not capped.
    expect(await writeToolSkill(db, toolId, { trigger: "backfill", model, force: true })).toMatchObject({ status: "written" });
  });
});

function researchResult() {
  return {
    canonicalName: "Yost 750-DI Bench Vise",
    description: "A cast-iron bench vise.",
    specs: [{ label: "Jaw width", value: "150 mm" }],
    materials: [],
    ppeRequired: [],
    tags: [],
    trainingRequired: null,
    useRestrictions: null,
    category: { name: "Workholding", group: "Hand tools", existingId: null },
    resources: [],
    droppedLinks: [],
    sourceUrls: ["https://vise.example/product", "not a url"],
    evidence: { userStatedModel: true, modelPlateRead: null, manufacturerPageFound: true, manualFound: false, specsFromSource: true, categoryOnly: false },
    confidence: { level: "high" as const, basis: [], unknowns: [] },
  };
}

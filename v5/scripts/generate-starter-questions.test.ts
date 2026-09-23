// @vitest-environment node
import { eq } from "drizzle-orm";
import { MockLanguageModelV3 } from "ai/test";
import { recordedCalls, textModel } from "../test/ai/models-stub.ts";
import { createPgliteDb } from "../src/lib/db/pglite.ts";
import { resources, tools } from "../src/lib/db/schema/index.ts";
import type { Db } from "../src/lib/db/types.ts";
import {
  BACKFILL_SYSTEM_PROMPT,
  buildBackfillPrompt,
  estimateCost,
  loadStarterSources,
  parseArgs,
  parseBackfillAnswer,
  runBackfill,
  usd,
} from "./generate-starter-questions.ts";
import { STARTER_QUESTION_GUIDANCE } from "../src/lib/starter-questions";

/**
 * The starter-question backfill (spec amendment "Tool-specific starter
 * questions"). The model is a `MockLanguageModelV3` handed straight to
 * `runBackfill` — nothing here reaches the Gateway — and the database is an
 * in-process PGlite.
 */

let db: Db;

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  await db.delete(tools);
});

async function insertTool(values: Partial<typeof tools.$inferInsert> & { name: string }): Promise<string> {
  const [row] = await db
    .insert(tools)
    .values({ slug: values.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), published: true, ...values })
    .returning({ id: tools.id });
  return row.id;
}

async function questionsOf(id: string): Promise<string[]> {
  const [row] = await db.select({ q: tools.starterQuestions }).from(tools).where(eq(tools.id, id));
  return row.q;
}

const ANSWER = JSON.stringify({
  starterQuestions: ["What resins can I print with?", "How do I wash and cure a print?", "How big can a part be?"],
});

describe("parseArgs", () => {
  it("reads --dry-run, --limit and --ids, in either spelling", () => {
    expect(parseArgs([])).toEqual({ dryRun: false, limit: null, ids: null });
    expect(parseArgs(["--dry-run", "--limit", "5", "--ids=form-4, trotec-speedy-400"])).toEqual({
      dryRun: true,
      limit: 5,
      ids: ["form-4", "trotec-speedy-400"],
    });
  });

  it("refuses a bad limit, empty ids and an unknown flag", () => {
    expect(() => parseArgs(["--limit", "0"])).toThrow(/--limit/);
    expect(() => parseArgs(["--limit"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--ids", ","])).toThrow(/--ids/);
    expect(() => parseArgs(["--force"])).toThrow(/Unknown argument/);
  });
});

describe("the prompt", () => {
  it("shows only the name, description and resource titles, fenced as data", () => {
    const prompt = buildBackfillPrompt({
      id: "t1",
      slug: "form-4",
      name: "Form 4",
      description: "A resin printer. Build volume: 200 × 125 × 210 mm.",
      resourceTitles: ["Form 4 SOP", "Form 4 manual"],
    });
    expect(prompt).toContain("Name: Form 4");
    expect(prompt).toContain("Build volume: 200 × 125 × 210 mm.");
    expect(prompt).toContain("- Form 4 SOP");
    expect(prompt).toMatch(/<untrusted-page id="[^"]+" source="the lab's inventory record for Form 4">/);
  });

  it("asks for three short questions, not statements, and no PPE", () => {
    expect(BACKFILL_SYSTEM_PROMPT).toContain("exactly 3 questions, each at most 80 characters");
    expect(BACKFILL_SYSTEM_PROMPT).toContain(STARTER_QUESTION_GUIDANCE);
    expect(BACKFILL_SYSTEM_PROMPT).toContain('Each is a question ending in "?", never a statement.');
    expect(BACKFILL_SYSTEM_PROMPT).toContain("do not ask about PPE");
  });

  it("reads the answer leniently, and a broken one as no questions", () => {
    expect(parseBackfillAnswer(`Here you go:\n${ANSWER}`)).toHaveLength(3);
    expect(parseBackfillAnswer("I cannot help with that.")).toEqual([]);
    expect(parseBackfillAnswer('{"starterQuestions": ["Wear gloves."]}')).toEqual([]);
  });
});

describe("cost", () => {
  it("prices tokens at Luna's list prices and estimates before the run", () => {
    expect(usd(1_000_000, 0)).toBeCloseTo(0.1);
    expect(usd(0, 1_000_000)).toBeCloseTo(0.5);
    const estimate = estimateCost([
      { id: "a", slug: "a", name: "A", description: "x".repeat(4000), resourceTitles: [] },
      { id: "b", slug: "b", name: "B", description: null, resourceTitles: [] },
    ]);
    expect(estimate.inputTokens).toBeGreaterThan(1000);
    expect(estimate.outputTokens).toBe(1200);
    expect(estimate.usd).toBeCloseTo(usd(estimate.inputTokens, estimate.outputTokens));
  });
});

describe("loadStarterSources", () => {
  it("takes only tools with no questions that are not archived, with their published resource titles", async () => {
    const form4 = await insertTool({ name: "Form 4", description: "A resin printer." });
    await insertTool({ name: "Trotec", starterQuestions: ["What can it cut?"] });
    await insertTool({ name: "Old lathe", archivedAt: new Date() });
    const draft = await insertTool({ name: "Draft mill", published: false });
    await db.insert(resources).values([
      { toolId: form4, title: "Form 4 SOP" },
      { toolId: form4, title: "Internal note", published: false },
    ]);

    const sources = await loadStarterSources(db, { ids: null, limit: null });
    expect(sources.map((source) => source.name)).toEqual(["Draft mill", "Form 4"]);
    expect(sources.find((source) => source.id === form4)?.resourceTitles).toEqual(["Form 4 SOP"]);
    expect(sources.find((source) => source.id === draft)?.resourceTitles).toEqual([]);
  });

  it("narrows to --ids (slugs or ids) and stops at --limit", async () => {
    const a = await insertTool({ name: "Alpha" });
    await insertTool({ name: "Beta" });
    await insertTool({ name: "Gamma" });
    expect((await loadStarterSources(db, { ids: ["gamma", a], limit: null })).map((s) => s.name)).toEqual(["Alpha", "Gamma"]);
    expect((await loadStarterSources(db, { ids: ["no-such-tool"], limit: null }))).toEqual([]);
    expect((await loadStarterSources(db, { ids: null, limit: 2 })).map((s) => s.name)).toEqual(["Alpha", "Beta"]);
  });
});

describe("runBackfill", () => {
  it("writes three questions per tool through the data layer, and totals the usage", async () => {
    const id = await insertTool({ name: "Form 4", description: "A resin printer." });
    const model = textModel(ANSWER);
    const lines: string[] = [];

    const report = await runBackfill({
      db,
      model,
      sources: await loadStarterSources(db, { ids: null, limit: null }),
      dryRun: false,
      log: (line) => lines.push(line),
    });

    expect(await questionsOf(id)).toEqual(JSON.parse(ANSWER).starterQuestions);
    expect(report.tools[0].outcome).toEqual({ status: "written", questions: JSON.parse(ANSWER).starterQuestions });
    expect(report.usage.inputTokens).toBeGreaterThan(0);
    expect(report.usage.usd).toBeCloseTo(usd(report.usage.inputTokens, report.usage.outputTokens));
    expect(lines.join("\n")).toContain("[1/1] Form 4 (form-4)");
    expect(lines.join("\n")).toContain("- How big can a part be?");
    // One call, no tools: the questions come from the record, never the web.
    const calls = recordedCalls(model);
    expect(calls).toHaveLength(1);
    expect(calls[0].tools ?? []).toEqual([]);
  });

  it("--dry-run prints what it would write and writes nothing", async () => {
    const id = await insertTool({ name: "Form 4" });
    const before = await db.select({ updatedAt: tools.updatedAt }).from(tools).where(eq(tools.id, id));

    const report = await runBackfill({
      db,
      model: textModel(ANSWER),
      sources: await loadStarterSources(db, { ids: null, limit: null }),
      dryRun: true,
    });

    expect(report.tools[0].outcome.status).toBe("would_write");
    expect(await questionsOf(id)).toEqual([]);
    const after = await db.select({ updatedAt: tools.updatedAt }).from(tools).where(eq(tools.id, id));
    expect(after).toEqual(before);
  });

  it("never overwrites questions somebody added while it ran", async () => {
    const id = await insertTool({ name: "Form 4" });
    const sources = await loadStarterSources(db, { ids: null, limit: null });
    await db.update(tools).set({ starterQuestions: ["Staff wrote this?"] }).where(eq(tools.id, id));

    const report = await runBackfill({ db, model: textModel(ANSWER), sources, dryRun: false });
    expect(report.tools[0].outcome).toEqual({ status: "skipped", reason: "already_has_questions" });
    expect(await questionsOf(id)).toEqual(["Staff wrote this?"]);
  });

  it("leaves a tool empty when the model gives nothing usable, and carries on past a failed call", async () => {
    const a = await insertTool({ name: "Alpha" });
    const b = await insertTool({ name: "Beta" });
    const c = await insertTool({ name: "Gamma" });
    let call = 0;
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        call += 1;
        if (call === 2) throw new Error("Gateway unavailable");
        const text = call === 1 ? '{"starterQuestions": ["Not a question."]}' : ANSWER;
        return {
          content: [{ type: "text", text }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: {
            inputTokens: { total: 50, noCache: 50, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 10, text: 10, reasoning: 0 },
          },
          warnings: [],
        };
      },
    });

    const report = await runBackfill({
      db,
      model,
      sources: await loadStarterSources(db, { ids: null, limit: null }),
      dryRun: false,
    });

    expect(report.tools.map((entry) => entry.outcome.status)).toEqual(["no_questions", "failed", "written"]);
    expect(await questionsOf(a)).toEqual([]);
    expect(await questionsOf(b)).toEqual([]);
    expect(await questionsOf(c)).toHaveLength(3);
  });
});

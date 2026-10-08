// @vitest-environment node
import { eq } from "drizzle-orm";
import { fakeEmbeddingTarget } from "../test/ai/fake-embeddings.ts";
import { recordedCalls, textModel } from "../test/ai/models-stub.ts";
import { seedManual, seedTool } from "../test/manuals/seed.ts";
import { listToolsForSkills } from "../src/lib/data/tool-skills.ts";
import { createPgliteDb } from "../src/lib/db/pglite.ts";
import { tools, toolSkills } from "../src/lib/db/schema/index.ts";
import type { Db } from "../src/lib/db/types.ts";
import { buildDocumentPassages } from "../src/lib/manuals/passages.ts";
import { describeOutcome, parseArgs, runToolSkillsBackfill, summarise } from "./tool-skills.ts";

/**
 * The tool skills backfill (tool skills spec 2026-10-07 §5.4): a dry run by
 * default that lists what each tool would get, estimates the cost and writes
 * nothing; `--apply` writes (trigger `backfill`); `--tool` narrows to one tool;
 * a second run finds them up to date. PGlite in process, a stub model.
 */

const PAGES = [
  "Operating\nSwitch on the machine with the key, load the job and press start. Operate with the lid closed.",
  "Troubleshooting\nIf the job does not start, check that the lid is closed and the exhaust is on.",
];
const ANSWER = JSON.stringify({
  operatingProcedure: [{ text: "Switch on with the key", cites: ["M1"] }],
  safety: [{ text: "Operate with the lid closed", cites: ["M1"] }],
});

let db: Db;

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await db.delete(toolSkills);
  await db.delete(tools);
  for (const [name, slug] of [["Form 4", "form-4"], ["Trotec Speedy 400", "trotec-speedy-400"]]) {
    const toolId = await seedTool(db, { name, slug });
    const { documentId } = await seedManual(db, { toolId, title: `${name} Manual`, pages: PAGES.map((page) => `${page} ${slug}`) });
    await buildDocumentPassages(db, documentId, { target: fakeEmbeddingTarget() });
  }
  // A tool with nothing to write from, and an archived one.
  await seedTool(db, { name: "Bench vise", slug: "bench-vise" });
  await seedTool(db, { name: "Old laser", slug: "old-laser", archived: true });
});

afterEach(() => vi.restoreAllMocks());

describe("parseArgs", () => {
  it("is a dry run by default and takes --apply, --tool, --limit and --force", () => {
    expect(parseArgs([])).toEqual({ apply: false, force: false, tool: null, limit: null });
    expect(parseArgs(["--apply", "--tool", "form-4", "--limit=3", "--force"])).toEqual({ apply: true, force: true, tool: "form-4", limit: 3 });
    expect(parseArgs(["--apply", "--dry-run"]).apply).toBe(false);
    expect(() => parseArgs(["--tool", "Form 4"])).toThrow(/slug/);
    expect(() => parseArgs(["--tool"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--limit", "0"])).toThrow(/--limit/);
    expect(() => parseArgs(["--everything"])).toThrow(/Unknown argument/);
  });
});

describe("listToolsForSkills", () => {
  it("lists every tool not archived, by name, or one by slug, or the first N", async () => {
    expect((await listToolsForSkills(db)).map((tool) => tool.slug)).toEqual(["bench-vise", "form-4", "trotec-speedy-400"]);
    expect((await listToolsForSkills(db, { toolSlug: "form-4" })).map((tool) => tool.slug)).toEqual(["form-4"]);
    expect(await listToolsForSkills(db, { toolSlug: "old-laser" })).toEqual([]);
    expect(await listToolsForSkills(db, { limit: 1 })).toHaveLength(1);
  });
});

describe("runToolSkillsBackfill", () => {
  it("dry run: says what each tool would get and estimates the cost, calling nothing and writing nothing", async () => {
    const model = textModel(ANSWER);
    const lines: string[] = [];
    const report = await runToolSkillsBackfill({ db, tools: await listToolsForSkills(db), apply: false, model, log: (line) => lines.push(line) });
    expect(report).toMatchObject({ tools: 3, planned: 2, nothingToWrite: 1, written: 0, failed: 0 });
    expect(report.inputTokens).toBeGreaterThan(0);
    expect(report.estimatedUsd).toBeGreaterThan(0);
    expect(lines[0]).toMatch(/^\[1\/3\] bench-vise: skipped \(nothing to write from/);
    expect(lines[1]).toMatch(/^\[2\/3\] form-4: would write version 1 from \d+ manual passage\(s\), ~\d+\/4000 tokens$/);
    expect(summarise(report, false)).toMatch(/^Dry run: 2 tool\(s\) would get a skill \(0 up to date, 1 with nothing to write from\)\. About \d+ input and 8000 output tokens: ~\$0\.\d{4} at Luna's list price/);
    expect(recordedCalls(model)).toHaveLength(0);
    expect(await db.select().from(toolSkills)).toHaveLength(0);
  });

  it("--apply writes each tool's skill as a backfill, and a second run finds them up to date", async () => {
    const model = textModel(ANSWER);
    const lines: string[] = [];
    const report = await runToolSkillsBackfill({ db, tools: await listToolsForSkills(db), apply: true, model, log: (line) => lines.push(line) });
    expect(report).toMatchObject({ written: 2, nothingToWrite: 1, failed: 0 });
    expect(lines[1]).toMatch(/form-4: wrote version 1 \(0 line\(s\) removed by the checks\), 100\/20 tokens, cost not reported/);
    const rows = await db.select().from(toolSkills);
    expect(rows.map((row) => row.trigger)).toEqual(["backfill", "backfill"]);
    expect(recordedCalls(model)).toHaveLength(2);
    expect(summarise(report, true)).toMatch(/^Wrote 2 skill\(s\)/);

    const again = await runToolSkillsBackfill({ db, tools: await listToolsForSkills(db), apply: true, model });
    expect(again).toMatchObject({ written: 0, upToDate: 2 });
    expect(recordedCalls(model)).toHaveLength(2);
  });

  it("--force writes again, and --tool narrows to one tool", async () => {
    const model = textModel(ANSWER);
    await runToolSkillsBackfill({ db, tools: await listToolsForSkills(db), apply: true, model });
    const forced = await runToolSkillsBackfill({ db, tools: await listToolsForSkills(db, { toolSlug: "form-4" }), apply: true, force: true, model });
    expect(forced).toMatchObject({ tools: 1, written: 1 });
    const [form] = await db.select({ id: tools.id }).from(tools).where(eq(tools.slug, "form-4"));
    expect((await db.select().from(toolSkills).where(eq(toolSkills.toolId, form.id))).map((row) => row.version).sort()).toEqual([1, 2]);
  });

  it("counts a failure and goes on", async () => {
    const report = await runToolSkillsBackfill({ db, tools: await listToolsForSkills(db), apply: true, model: textModel("no JSON here") });
    expect(report).toMatchObject({ written: 0, failed: 2 });
    expect(describeOutcome({ status: "failed", toolId: "x", reason: "unreadable", kind: null, transient: false, recorded: true })).toBe("failed (unreadable)");
  });
});

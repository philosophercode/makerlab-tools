// @vitest-environment node
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { starterAnswers, tools } from "@/lib/db/schema/index";
import type { Db } from "@/lib/db/types";
import { findPublishedStarterTool, listStarterAnswers, type StarterTool } from "@/lib/data/starter-answers";
import type { StarterAnswerRun } from "./answer";
import { servableStarterAnswers } from "./cache";
import type { StarterGrade } from "./grade";
import { estimateUsd, refreshChipSet, type RefreshDeps } from "./refresh";

/**
 * The refresh of one chip set (starter answers), with the three model calls
 * faked: what a dry run leaves alone, what `apply` writes, and what it
 * refuses to write when the tool moved under it.
 */

let db: Db;
let form: StarterTool;

function runFor(question: string, toolId: string | null): StarterAnswerRun {
  return {
    question,
    toolId,
    model: "openai/gpt-6-luna",
    message: { id: "starter-answer", role: "assistant", parts: [{ type: "text", text: `Answer to ${question}` }] },
    text: `Answer to ${question}`,
    resourceUrls: [],
    toolCalls: [],
    usageEvents: toolId ? [{ kind: "tool_asked", toolId, manualDocumentId: null, page: null }] : [],
    gap: null,
    usage: { inputTokens: 1000, outputTokens: 50, cachedInputTokens: 0, gatewayCost: 0.001 },
  };
}

function grade(accepted: boolean, extra: Partial<StarterGrade> = {}): StarterGrade {
  return {
    accepted,
    score: accepted ? 9 : 4,
    reasons: accepted ? [] : ["thin"],
    failures: accepted ? [] : ["not grounded"],
    judge: null,
    checks: { stubbedCalls: [], unverifiedCitations: [], resourceLinks: [], mapLinks: [], citedPassages: 1, liveStateCalls: [], catalogCalls: [], gap: null, empty: false },
    disqualified: false,
    retryable: false,
    usage: { inputTokens: 100, outputTokens: 20, gatewayCost: 0.0001 },
    ...extra,
  };
}

function deps(verdicts: Record<string, boolean>, proposals: string[][] = [], onAnswer?: (question: string) => Promise<void>): RefreshDeps & { answer: ReturnType<typeof vi.fn> } {
  return {
    answer: vi.fn(async ({ question, toolId }: { question: string; toolId: string | null }) => {
      await onAnswer?.(question);
      return runFor(question, toolId);
    }),
    grade: vi.fn(async ({ question }: { question: string }) => grade(verdicts[question] ?? false)),
    write: vi.fn(async () => ({ questions: proposals.shift() ?? [], usage: { inputTokens: 10, outputTokens: 5, gatewayCost: null } })),
  };
}

const record = { record: "**Form 4**", manuals: [] };

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  db = await getDb();
});

beforeEach(async () => {
  await db.delete(starterAnswers);
  const [row] = await db.select({ id: tools.id }).from(tools).where(eq(tools.slug, "form-4"));
  await db.update(tools).set({ starterQuestions: ["Good?", "Weak?", "Fine?"] }).where(eq(tools.id, row.id));
  form = (await findPublishedStarterTool(db, "form-4"))!;
});

describe("refreshChipSet", () => {
  it("does the model work on a dry run and writes nothing", async () => {
    const d = deps({ "Good?": true, "Weak?": false, "Fine?": true, "Better?": true }, [["Better?"]]);
    const report = await refreshChipSet({ db, deps: d, apply: false, tool: { ...form, context: { id: form.id, slug: form.slug, name: form.name, ...record } } });

    expect(report.after).toEqual(["Good?", "Fine?", "Better?"]);
    expect(report.write).toBe("would_update");
    expect(report.cached).toBe(3);
    expect(report.usage.answer.gatewayCost).toBeCloseTo(0.004);
    expect(await listStarterAnswers(db, { toolId: form.id, locale: "en" })).toEqual([]);
    expect((await findPublishedStarterTool(db, "form-4"))!.starterQuestions).toEqual(["Good?", "Weak?", "Fine?"]);
  });

  it("with apply, writes the new questions and caches each answer so the chips can serve it", async () => {
    const d = deps({ "Good?": true, "Weak?": false, "Fine?": true, "Better?": true }, [["Better?"]]);
    const report = await refreshChipSet({ db, deps: d, apply: true, tool: { ...form, context: { id: form.id, slug: form.slug, name: form.name, ...record } } });

    expect(report.write).toBe("questions_updated");
    expect((await findPublishedStarterTool(db, "form-4"))!.starterQuestions).toEqual(["Good?", "Fine?", "Better?"]);
    const served = await servableStarterAnswers(db, { toolId: form.id });
    expect(served.map((a) => a.question).sort()).toEqual(["Better?", "Fine?", "Good?"]);
    // The replaced question's answer is gone; nothing else was kept.
    expect((await listStarterAnswers(db, { toolId: form.id, locale: "en" })).map((r) => r.question).sort()).toEqual(["Better?", "Fine?", "Good?"]);
  });

  it("keeps a harmless weak original as a live chip, stored as graded down, when no replacement passes", async () => {
    const d = deps({ "Good?": true, "Weak?": false, "Fine?": true }, [["Nope?"], []]);
    const report = await refreshChipSet({ db, deps: d, apply: true, tool: { ...form, context: { id: form.id, slug: form.slug, name: form.name, ...record } } });

    expect(report.write).toBe("questions_unchanged");
    const rows = await listStarterAnswers(db, { toolId: form.id, locale: "en" });
    expect(rows.find((r) => r.question === "Weak?")?.accepted).toBe(false);
    expect((await servableStarterAnswers(db, { toolId: form.id })).map((a) => a.question).sort()).toEqual(["Fine?", "Good?"]);
  });

  it("caches nothing when the tool changed while its answers were being made", async () => {
    const d = deps({ "Good?": true, "Weak?": true, "Fine?": true }, [], async (question) => {
      if (question === "Fine?") await db.update(tools).set({ description: "Edited mid-run.", updatedAt: new Date(Date.now() + 10_000) }).where(eq(tools.id, form.id));
    });
    const report = await refreshChipSet({ db, deps: d, apply: true, tool: { ...form, context: { id: form.id, slug: form.slug, name: form.name, ...record } } });

    expect(report.write).toBe("skipped_changed_during_run");
    expect(report.cached).toBe(0);
    expect(await listStarterAnswers(db, { toolId: form.id, locale: "en" })).toEqual([]);
  });

  it("asks a question once more when the miss was the run's, not the question's", async () => {
    const d = deps({});
    let calls = 0;
    d.grade = vi.fn(async () => (calls++ === 0 ? grade(false, { retryable: true }) : grade(true)));
    const report = await refreshChipSet({ db, deps: d, apply: false, tool: { ...form, starterQuestions: ["Good?"], context: { id: form.id, slug: form.slug, name: form.name, ...record } } });
    expect(d.answer).toHaveBeenCalledTimes(2);
    expect(report.chips[0].accepted).toBe(true);
  });

  it("caches the general chips' current texts and accepted proposals, and never writes a message file", async () => {
    const d = deps({ "Operate?": true, "Debug?": false, "Create?": true, "Better debug?": true }, [["Better debug?"]]);
    const report = await refreshChipSet({
      db,
      deps: d,
      apply: true,
      tool: null,
      general: { questions: ["Operate?", "Debug?", "Create?"], record: "2 tools", coverage: "", note: "one of each" },
    });
    expect(report.after).toEqual(["Operate?", "Create?", "Better debug?"]);
    expect(report.changed).toBe(true);
    const rows = await listStarterAnswers(db, { toolId: null, locale: "en" });
    expect(rows.map((r) => r.question).sort()).toEqual(["Better debug?", "Create?", "Debug?", "Operate?"]);
    expect((await servableStarterAnswers(db, { toolId: null })).map((a) => a.question).sort()).toEqual(["Better debug?", "Create?", "Operate?"]);
  });
});

describe("estimateUsd", () => {
  it("prices every chip once plus a third replaced", () => {
    expect(estimateUsd(0)).toBe(0);
    expect(estimateUsd(300)).toBeGreaterThan(estimateUsd(3));
  });
});

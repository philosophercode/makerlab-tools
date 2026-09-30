// @vitest-environment node
import { setLabSetting, VALUE_REPORT_SETTING, getLabSetting } from "../../data/lab-settings";
import { UNANSWERED_CORRECTION_PREFIX } from "../../data/usage-gaps";
import { createPgliteDb } from "../../db/pglite";
import { attachments, feedback, labSettings, maintenanceLogs, manualDocuments, tools, usageEvents, usageRollups } from "../../db/schema/index";
import type { Db } from "../../db/types";
import type { UsageEvent } from "../events";
import { runUsageRollup } from "../rollup";
import { defaultAssumptions } from "./assumptions";
import { loadValueReport } from "./load";
import { loadValueCounts } from "./value-queries";

/**
 * The value report against a real (PGlite) Postgres: a seeded fall term and
 * summer term of anonymous usage, corrections filed from the Unanswered
 * queue, manuals and assistant-filed tickets — read through the same loader
 * the page and the assistant use.
 */

const NY = "America/New_York";
const HOURS = "LAB OPEN 8AM-8PM";
/** Mid-term: the fall term (08-21 → 12-31) is "to date". */
const NOW = new Date("2026-11-20T17:00:00Z");

let db: Db;
let form4: string;
let trotec: string;

async function eventsAt(at: string, events: Partial<UsageEvent>[]) {
  await db.insert(usageEvents).values(
    events.map((e) => ({
      occurredAt: new Date(at),
      kind: e.kind ?? "chat_turn",
      surface: e.surface ?? "chat",
      audience: e.audience ?? "anonymous",
      toolId: e.toolId ?? null,
      manualDocumentId: e.manualDocumentId ?? null,
      source: e.source ?? null,
      questionKind: e.questionKind ?? null,
      page: e.page ?? null,
    }))
  );
}

const turn = (questionKind: UsageEvent["questionKind"] = "operate", toolId?: string): Partial<UsageEvent>[] => [
  { kind: "chat_turn", questionKind },
  ...(toolId ? [{ kind: "tool_asked" as const, toolId }] : []),
];

beforeAll(async () => {
  db = await createPgliteDb();
  const [a] = await db.insert(tools).values({ slug: "value-form-4", name: "Form 4", published: true }).returning({ id: tools.id });
  const [b] = await db.insert(tools).values({ slug: "value-trotec", name: "Trotec Speedy 400", published: true }).returning({ id: tools.id });
  form4 = a.id;
  trotec = b.id;
});

beforeEach(async () => {
  await db.delete(usageEvents);
  await db.delete(usageRollups);
  await db.delete(feedback);
  await db.delete(maintenanceLogs);
  await db.delete(manualDocuments);
  await db.delete(labSettings);
});

async function seedFall() {
  // Staffed: Wed 2026-10-14 10:00 EDT (14:00 UTC).
  await eventsAt("2026-10-14T14:10:00Z", [...turn("operate", form4), ...turn("debug", form4), ...turn("create", trotec)]);
  // After hours: Wed 2026-10-14 22:00 EDT (02:00 UTC Thursday).
  await eventsAt("2026-10-15T02:10:00Z", [...turn("operate", form4), ...turn("other")]);
  // After the DST change, 20:30 EST on Tue 2026-11-03 is 01:30 UTC Wednesday — after hours.
  await eventsAt("2026-11-04T01:30:00Z", [...turn("debug", trotec)]);
  // …and 19:30 EST (00:30 UTC) is still staffed.
  await eventsAt("2026-11-04T00:30:00Z", [...turn("operate", form4)]);
  // One unanswered turn of each of two kinds.
  await eventsAt("2026-10-20T15:00:00Z", [{ kind: "chat_turn", questionKind: "other" }, { kind: "gap", source: "not_in_catalog" }]);
  await eventsAt("2026-10-21T15:00:00Z", [{ kind: "chat_turn", questionKind: "other" }, { kind: "gap", source: "honest_absence", toolId: form4 }]);
  // MCP: four catalogue lookups (two questions) and a write that is not a question.
  await eventsAt("2026-10-22T15:00:00Z", [
    { kind: "mcp_call", surface: "mcp", source: "search_tools" },
    { kind: "mcp_call", surface: "mcp", source: "get_tool_details" },
    { kind: "tool_asked", surface: "mcp", toolId: trotec },
    { kind: "mcp_call", surface: "mcp", source: "search_manual" },
    { kind: "mcp_call", surface: "mcp", source: "get_tool_details" },
    { kind: "mcp_call", surface: "mcp", source: "report_issue" },
  ]);
  // Citations.
  await eventsAt("2026-10-14T14:11:00Z", [{ kind: "manual_cited", page: 12 }, { kind: "manual_cited", page: 14 }]);
  // Staff testing: never in the value report.
  await eventsAt("2026-10-14T14:30:00Z", [
    { kind: "chat_turn", audience: "staff", questionKind: "operate" },
    { kind: "chat_turn", audience: "staff", questionKind: "operate" },
    { kind: "tool_asked", audience: "staff", toolId: trotec },
  ]);
}

async function seedSummer() {
  await eventsAt("2026-07-08T15:00:00Z", [...turn("operate", form4), ...turn("operate", form4)]);
}

describe("loadValueReport", () => {
  it("reports the fall term to date: questions, handled, hours, dollars, after hours, kinds and tools, staff left out", async () => {
    await seedFall();
    await seedSummer();
    const data = await loadValueReport({ search: {}, timeZone: NY, labHoursText: HOURS, now: NOW, db });

    expect(data.period).toMatchObject({ kind: "term", key: "fall-2026" });
    expect(data.previous).toMatchObject({ key: "summer-2026" });
    expect(data.toDate).toBe(true);
    expect(data.assumptions.origin).toBe("default");

    const r = data.report;
    expect(r.chatTurns).toBe(9);
    expect(r.mcpLookups).toBe(4);
    expect(r.mcpQuestions).toBe(2);
    expect(r.questionsAnswered).toBe(11);
    expect(r.unanswered).toBe(2);
    expect(r.handled).toBe(9); // 9 − 2 + 2
    expect(r.staffHoursSaved).toBeCloseTo(0.6); // 9 × 4 ÷ 60
    expect(r.dollarValue).toBeCloseTo(24);
    // 22:00 EDT ×2 and 20:30 EST ×1 — the DST change moves nothing.
    expect(r.afterHoursQuestions).toBe(3);
    expect(r.questionKinds).toEqual({ operate: 3, debug: 2, create: 1, other: 3 });
    expect(r.topTools.map((t) => [t.name, t.asked])).toEqual([
      ["Form 4", 4],
      ["Trotec Speedy 400", 3], // two in the app, one over MCP; the staff one is left out
    ]);
    expect(r.citations).toBe(2);

    expect(data.previousReport.questionsAnswered).toBe(2);
    expect(data.comparison.questionsAnswered).toMatchObject({ current: 11, previous: 2, delta: 9 });
  });

  it("uses the lab's stored assumptions", async () => {
    await seedFall();
    await setLabSetting(VALUE_REPORT_SETTING, { ...defaultAssumptions(HOURS), minutesPerQuestion: 6, hourlyCost: 50, unansweredKinds: ["not_in_catalog"], includeMcp: false }, null, { db });
    const data = await loadValueReport({ search: {}, timeZone: NY, labHoursText: HOURS, now: NOW, db });
    expect(data.assumptions.origin).toBe("stored");
    expect(data.report.questionsAnswered).toBe(9);
    expect(data.report.handled).toBe(8); // honest absence no longer subtracted
    expect(data.report.staffHoursSaved).toBeCloseTo(0.8);
    expect(data.report.dollarValue).toBeCloseTo(40);
  });

  it("reads a custom range and the same number of days before it", async () => {
    await seedFall();
    const data = await loadValueReport({ search: { from: "2026-10-14", to: "2026-10-15" }, timeZone: NY, labHoursText: HOURS, now: NOW, db });
    expect(data.period).toMatchObject({ kind: "custom", from: "2026-10-14", to: "2026-10-15" });
    expect(data.previous).toMatchObject({ from: "2026-10-12", to: "2026-10-13" });
    // 14 Oct: three staffed turns; 22:00 EDT on 14 Oct is still the 14th in lab time.
    expect(data.report.chatTurns).toBe(5);
    expect(data.previousReport.chatTurns).toBe(0);
  });

  it("is zeros with no data at all, and says nothing was counted", async () => {
    const data = await loadValueReport({ search: {}, timeZone: NY, labHoursText: HOURS, now: NOW, db });
    expect(data.since).toBeNull();
    expect(data.report).toMatchObject({ questionsAnswered: 0, handledShare: null, afterHoursShare: null, staffHoursSaved: 0, medianDaysToResolve: null });
    expect(data.comparison.questionsAnswered).toMatchObject({ current: 0, previous: 0, delta: 0, relative: null });
  });

  it("counts the same once tonight's rollup has run", async () => {
    await seedFall();
    const before = await loadValueReport({ search: {}, timeZone: NY, labHoursText: HOURS, now: NOW, db });
    await runUsageRollup({ db, now: NOW });
    expect(await db.$count(usageRollups)).toBeGreaterThan(0);
    const after = await loadValueReport({ search: {}, timeZone: NY, labHoursText: HOURS, now: NOW, db });
    expect(after.report).toEqual(before.report);
  });
});

describe("follow-up counts", () => {
  const fall = { start: new Date("2026-08-21T04:00:00Z"), end: new Date("2027-01-01T05:00:00Z"), from: "2026-08-21", to: "2026-12-31" };

  it("counts corrections filed from the Unanswered queue, and the fixed ones, by when they were filed", async () => {
    await db.insert(feedback).values([
      { issueDescription: `${UNANSWERED_CORRECTION_PREFIX}Do you have a waterjet?`, status: "new", createdAt: new Date("2026-10-01T15:00:00Z") },
      { issueDescription: `${UNANSWERED_CORRECTION_PREFIX}Can it cut glass?`, status: "fixed", createdAt: new Date("2026-10-02T15:00:00Z") },
      { issueDescription: "The resin list is missing Rigid 10K", status: "fixed", createdAt: new Date("2026-10-03T15:00:00Z") },
      { issueDescription: `${UNANSWERED_CORRECTION_PREFIX}Last summer`, status: "fixed", createdAt: new Date("2026-07-03T15:00:00Z") },
    ]);
    const counts = await loadValueCounts(fall, { db });
    expect([counts.unansweredFiled, counts.unansweredFixed]).toEqual([2, 1]);
  });

  it("counts problem reports the assistant filed, the resolved ones and the median days to resolve", async () => {
    const report = { type: "issue_report", title: "Broken" } as const;
    await db.insert(maintenanceLogs).values([
      { ...report, status: "resolved", dateReported: "2026-09-01", dateResolved: "2026-09-03" },
      { ...report, status: "closed", dateReported: "2026-09-10", dateResolved: "2026-09-10" },
      { ...report, status: "resolved", dateReported: "2026-10-01", dateResolved: "2026-10-08" },
      { ...report, status: "open", dateReported: "2026-11-01" },
      // Not the assistant's: logged maintenance, imported history, and last term.
      { type: "repair", title: "Belt", status: "resolved", dateReported: "2026-09-02", dateResolved: "2026-09-02" },
      { ...report, status: "resolved", dateReported: "2026-09-02", dateResolved: "2026-09-30", notionPageId: "notion-imported-1" },
      { ...report, status: "resolved", dateReported: "2026-08-01", dateResolved: "2026-08-02" },
    ]);
    const counts = await loadValueCounts(fall, { db });
    expect(counts.ticketsFiled).toBe(4);
    expect(counts.ticketsResolved).toBe(3);
    expect(counts.medianDaysToResolve).toBe(2); // 0, 2, 7
  });

  it("counts manuals made searchable in the period", async () => {
    const manual = async (name: string, status: "ready" | "failed", createdAt: string) => {
      const [attachment] = await db
        .insert(attachments)
        .values({ blobPathname: `resources/${name}.pdf`, access: "public", publicUrl: `https://blob.test/${name}.pdf`, contentType: "application/pdf" })
        .returning({ id: attachments.id });
      await db.insert(manualDocuments).values({
        attachmentId: attachment.id,
        toolId: form4,
        title: name,
        status,
        extractorVersion: "test",
        processedAt: new Date(createdAt),
        createdAt: new Date(createdAt),
      });
    };
    await manual("fall-ready", "ready", "2026-09-05T12:00:00Z");
    await manual("fall-failed", "failed", "2026-09-06T12:00:00Z");
    await manual("summer-ready", "ready", "2026-06-06T12:00:00Z");
    const counts = await loadValueCounts(fall, { db });
    expect(counts.manualsAdded).toBe(1);
  });
});

describe("lab settings", () => {
  it("stores one value per key, says whether it changed, and keys order does not count as a change", async () => {
    expect(await getLabSetting(VALUE_REPORT_SETTING, { db })).toBeNull();
    expect(await setLabSetting(VALUE_REPORT_SETTING, { a: 1, b: 2 }, null, { db })).toEqual({ changed: true });
    expect(await setLabSetting(VALUE_REPORT_SETTING, { b: 2, a: 1 }, null, { db })).toEqual({ changed: false });
    expect(await setLabSetting(VALUE_REPORT_SETTING, { a: 1, b: 3 }, null, { db })).toEqual({ changed: true });
    expect((await getLabSetting(VALUE_REPORT_SETTING, { db }))?.value).toEqual({ a: 1, b: 3 });
    expect(await db.$count(labSettings)).toBe(1);
  });
});

// @vitest-environment node
import { getTableColumns, sql } from "drizzle-orm";
import { createPgliteDb } from "../db/pglite";
import { rawRows } from "../db/raw";
import { tools, usageEvents, usageGaps, usageRollups } from "../db/schema/index";
import type { Db } from "../db/types";
import type { UsageEvent } from "./events";
import { loadInsights } from "./queries";
import { recordUsage, REOPEN_AFTER } from "./record";
import { runUsageRollup } from "./rollup";

/**
 * Usage insight against a real (PGlite) Postgres: recording, the gap upsert,
 * anonymisation as a property of the schema, the nightly rollup and its
 * retention, and the page's reads across the rollup/raw watermark.
 */

let db: Db;
let toolA: string;
let toolB: string;

async function insertTool(slug: string, name: string, published = true): Promise<string> {
  const [row] = await db.insert(tools).values({ slug, name, published }).returning({ id: tools.id });
  return row.id;
}

/** Insert raw events at explicit times (the recorder always writes `now()`). */
async function eventsAt(at: Date, events: Partial<UsageEvent>[]) {
  await db.insert(usageEvents).values(
    events.map((e) => ({
      occurredAt: at,
      kind: e.kind ?? "chat_turn",
      surface: e.surface ?? "chat",
      audience: e.audience ?? "anonymous",
      toolId: e.toolId ?? null,
      source: e.source ?? null,
      questionKind: e.questionKind ?? null,
      page: e.page ?? null,
    }))
  );
}

const DAY = 86_400_000;

beforeAll(async () => {
  db = await createPgliteDb();
  toolA = await insertTool("usage-form-4", "Form 4");
  toolB = await insertTool("usage-trotec", "Trotec Speedy 400");
  await insertTool("usage-quiet", "Quiet Bandsaw");
  await insertTool("usage-draft", "Draft Lathe", false);
});

beforeEach(async () => {
  await db.delete(usageEvents);
  await db.delete(usageRollups);
  await db.delete(usageGaps);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("what an event can hold (no per-person data)", () => {
  it("has no column that could name a person, a session, a chat, a token or an address", () => {
    const forbidden = /user|session|chat_?id|token|ip|email|agent|name|address|hash/i;
    for (const table of [usageEvents, usageRollups]) {
      const columns = Object.values(getTableColumns(table)).map((c) => c.name);
      expect(columns.filter((c) => forbidden.test(c))).toEqual([]);
    }
    // The queue keeps the staff member who decided, and nothing about who asked.
    const gapColumns = Object.values(getTableColumns(usageGaps)).map((c) => c.name);
    expect(gapColumns.filter((c) => forbidden.test(c))).toEqual([]);
    expect(gapColumns).toContain("decided_by");
  });

  it("stores only what the event says, even when handed more", async () => {
    const sneaky = { kind: "chat_turn", surface: "chat", audience: "member", userId: "u-1", email: "a@b.edu", ip: "1.2.3.4" } as unknown as UsageEvent;
    expect(await recordUsage([sneaky], [], { db })).toBe(true);
    const [row] = await rawRows<Record<string, unknown>>(db, sql`select * from usage_events`);
    expect(Object.values(row).map(String).join(" ")).not.toMatch(/u-1|a@b\.edu|1\.2\.3\.4/);
  });
});

describe("recordUsage", () => {
  it("writes the events and links the turn's gap event to the queue row", async () => {
    await recordUsage(
      [
        { kind: "chat_turn", surface: "chat", audience: "anonymous", questionKind: "operate" },
        { kind: "gap", surface: "chat", audience: "anonymous", toolId: toolA, source: "no_manual_passage" },
      ],
      [{ kind: "no_manual_passage", question: "How do I cut glass?", toolId: toolA, audience: "anonymous", surface: "chat" }],
      { db }
    );
    const [gap] = await db.select().from(usageGaps);
    expect(gap).toMatchObject({ question: "How do I cut glass?", occurrences: 1, status: "open", toolId: toolA });
    const rows = await db.select().from(usageEvents);
    expect(rows.find((r) => r.kind === "gap")!.gapId).toBe(gap.id);
    expect(rows.find((r) => r.kind === "chat_turn")!.gapId).toBeNull();
  });

  it("groups the same question on the same tool, keeping the latest wording; another tool is another gap", async () => {
    const gap = (question: string, toolId: string) => ({ kind: "honest_absence" as const, question, toolId, audience: "anonymous" as const, surface: "chat" as const });
    await recordUsage([], [gap("How do I cut glass?", toolA)], { db });
    await recordUsage([], [gap("how do i cut  GLASS", toolA)], { db });
    await recordUsage([], [gap("How do I cut glass?", toolB)], { db });
    const rows = await db.select().from(usageGaps);
    expect(rows).toHaveLength(2);
    const onA = rows.find((r) => r.toolId === toolA)!;
    expect(onA.occurrences).toBe(2);
    expect(onA.question).toBe("how do i cut  GLASS");
  });

  it(`reopens a dismissed gap asked ${REOPEN_AFTER} more times`, async () => {
    const gap = { kind: "honest_absence" as const, question: "Do you have a waterjet?", toolId: null, audience: "anonymous" as const, surface: "chat" as const };
    await recordUsage([], [gap], { db });
    await db.update(usageGaps).set({ status: "dismissed", dismissedAtOccurrences: 1 });
    await recordUsage([], [gap], { db });
    await recordUsage([], [gap], { db });
    expect((await db.select().from(usageGaps))[0].status).toBe("dismissed");
    await recordUsage([], [gap], { db });
    const [row] = await db.select().from(usageGaps);
    expect(row.status).toBe("open");
    expect(row.occurrences).toBe(4);
  });

  it("never throws: a failing database is a warning and a false", async () => {
    const broken = { insert: () => { throw new Error("db down"); }, execute: () => { throw new Error("db down"); } } as unknown as Db;
    await expect(recordUsage([{ kind: "chat_turn", surface: "chat", audience: "anonymous" }], [], { db: broken })).resolves.toBe(false);
    // Described by `describeDbError`: an app error keeps its words; a database one would lose its params.
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("[usage]"), "Error: db down");
  });

  it("records nothing with USAGE_INSIGHT=off", async () => {
    vi.stubEnv("USAGE_INSIGHT", "off");
    expect(await recordUsage([{ kind: "chat_turn", surface: "chat", audience: "anonymous" }], [], { db })).toBe(false);
    expect(await db.select().from(usageEvents)).toHaveLength(0);
  });
});

describe("runUsageRollup (the nightly stage)", () => {
  const now = new Date("2026-09-28T12:20:00Z");

  it("rolls complete hours into counts, leaves the current hour raw, and is idempotent", async () => {
    await eventsAt(new Date("2026-09-28T10:05:00Z"), [{}, {}, { kind: "tool_view", surface: "web", toolId: toolA, source: "qr" }]);
    await eventsAt(new Date("2026-09-28T12:05:00Z"), [{}]);
    const first = await runUsageRollup({ db, now });
    expect(first.rollupRows).toBe(2);
    await runUsageRollup({ db, now });
    const rollups = await db.select().from(usageRollups);
    expect(rollups.map((r) => [r.hourStart.toISOString(), r.kind, r.count]).sort()).toEqual([
      ["2026-09-28T10:00:00.000Z", "chat_turn", 2],
      ["2026-09-28T10:00:00.000Z", "tool_view", 1],
    ]);
    expect(await db.select().from(usageEvents)).toHaveLength(4);
  });

  it("prunes raw events older than 30 days (on an hour boundary) and keeps their counts", async () => {
    await eventsAt(new Date(now.getTime() - 31 * DAY), [{}, {}]);
    await eventsAt(new Date(now.getTime() - 29 * DAY), [{}]);
    const result = await runUsageRollup({ db, now });
    expect(result.prunedEvents).toBe(2);
    expect(await db.select().from(usageEvents)).toHaveLength(1);
    const total = (await db.select().from(usageRollups)).reduce((sum, r) => sum + r.count, 0);
    expect(total).toBe(3);
    // Another night: nothing is counted twice or lost.
    await runUsageRollup({ db, now: new Date(now.getTime() + DAY) });
    expect((await db.select().from(usageRollups)).reduce((sum, r) => sum + r.count, 0)).toBe(3);
  });

  it("deletes a gap's text 30 days after it was last asked, not before", async () => {
    await db.insert(usageGaps).values([
      { key: "-|old", kind: "honest_absence", question: "old question", lastSeen: new Date(now.getTime() - 31 * DAY), firstSeen: new Date(now.getTime() - 40 * DAY) },
      { key: "-|recent", kind: "honest_absence", question: "recent question", lastSeen: new Date(now.getTime() - 29 * DAY), firstSeen: new Date(now.getTime() - 40 * DAY) },
    ]);
    const result = await runUsageRollup({ db, now });
    expect(result.prunedGaps).toBe(1);
    expect((await db.select().from(usageGaps)).map((g) => g.question)).toEqual(["recent question"]);
  });

  it("keeps a deleted tool's history in the rollups under a null tool", async () => {
    const doomed = await insertTool("usage-doomed", "Doomed Drill");
    await eventsAt(new Date("2026-09-28T09:10:00Z"), [{ kind: "tool_asked", toolId: doomed }]);
    await runUsageRollup({ db, now });
    await db.delete(tools).where(sql`${tools.id} = ${doomed}`);
    await runUsageRollup({ db, now });
    const rows = await db.select().from(usageRollups);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "tool_asked", toolId: null, count: 1 });
  });
});

describe("loadInsights", () => {
  const now = new Date("2026-09-28T16:00:00Z");
  const query = { days: 7 as const, includeStaff: false, timeZone: "America/New_York", now };

  it("counts rolled and raw events once each, across the watermark", async () => {
    await eventsAt(new Date("2026-09-27T14:00:00Z"), [{ kind: "tool_asked", toolId: toolA }, { questionKind: "debug" }]);
    await runUsageRollup({ db, now: new Date("2026-09-28T00:30:00Z") });
    await eventsAt(new Date("2026-09-28T15:00:00Z"), [{ kind: "tool_asked", toolId: toolA }, { kind: "tool_view", surface: "web", toolId: toolA, source: "qr" }]);
    const data = await loadInsights(query, { db });
    expect(data.totals.chatTurns).toBe(1);
    expect(data.totals.qrScans).toBe(1);
    const formFour = data.tools.find((t) => t.toolId === toolA)!;
    expect(formFour).toMatchObject({ name: "Form 4", asked: 2, views: 1, qr: 1 });
    expect(data.kinds.debug.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it("leaves staff out unless asked", async () => {
    await eventsAt(new Date("2026-09-28T15:00:00Z"), [{ audience: "staff" }, { audience: "member" }]);
    expect((await loadInsights(query, { db })).totals.chatTurns).toBe(1);
    expect((await loadInsights({ ...query, includeStaff: true }, { db })).totals.chatTurns).toBe(2);
  });

  it("lists published tools nobody asked about or viewed, and never a draft", async () => {
    await eventsAt(new Date("2026-09-28T15:00:00Z"), [{ kind: "tool_asked", toolId: toolA }, { kind: "tool_view", surface: "web", toolId: toolB }]);
    const names = (await loadInsights(query, { db })).neverAsked.map((t) => t.name);
    expect(names).toContain("Quiet Bandsaw");
    expect(names).not.toContain("Form 4");
    expect(names).not.toContain("Trotec Speedy 400");
    expect(names).not.toContain("Draft Lathe");
  });

  it("puts a 21:30 New York event in the 21:00 cell on both sides of the DST change", async () => {
    // 2026-11-01 is the fall-back day. 21:30 EDT (Oct 31) = 01:30Z; 21:30 EST (Nov 1) = 02:30Z.
    const later = new Date("2026-11-02T12:00:00Z");
    await eventsAt(new Date("2026-11-01T01:30:00Z"), [{}]);
    await eventsAt(new Date("2026-11-02T02:30:00Z"), [{}]);
    await runUsageRollup({ db, now: new Date("2026-11-02T02:10:00Z") });
    const data = await loadInsights({ ...query, now: later }, { db });
    expect(data.heatmap[6][21]).toBe(1); // Saturday Oct 31
    expect(data.heatmap[0][21]).toBe(1); // Sunday Nov 1
    expect(data.heatmap.flat().reduce((a, b) => a + b, 0)).toBe(2);
  });

  it("lists open gaps by how often they were asked", async () => {
    const gap = (question: string) => ({ kind: "honest_absence" as const, question, toolId: toolB, audience: "anonymous" as const, surface: "chat" as const });
    await recordUsage([], [gap("rare")], { db });
    await recordUsage([], [gap("common")], { db });
    await recordUsage([], [gap("common")], { db });
    const data = await loadInsights(query, { db });
    expect(data.gaps.map((g) => [g.question, g.occurrences, g.toolName])).toEqual([
      ["common", 2, "Trotec Speedy 400"],
      ["rare", 1, "Trotec Speedy 400"],
    ]);
    expect(data.gapCounts.open).toBe(2);
  });
});

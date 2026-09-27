// @vitest-environment node
vi.mock("workflow/api", () => ({ start: vi.fn(async () => ({ runId: "run-from-start" })) }));

import { start } from "workflow/api";
import { getRefresh, listRefreshesForTool } from "../data/tool-refreshes";
import { createPgliteDb } from "../db/pglite";
import { researchRequests, toolRefreshes, tools, user } from "../db/schema/index";
import type { Db } from "../db/types";
import { RESEARCH_MAX_ITEMS_PER_REQUEST } from "../intake/limits";
import { queueRefresh } from "./queue";

/** Queueing and starting a refresh run (refresh research spec §5.1, §10 "Queueing"). */

let db: Db;
const ADMIN = "queue-admin";

beforeAll(async () => {
  db = await createPgliteDb();
  await db.insert(user).values({ id: ADMIN, name: "Niti", email: "queue-admin@cornell.edu", role: "admin" });
});

beforeEach(async () => {
  vi.mocked(start).mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  await db.delete(researchRequests);
  await db.delete(toolRefreshes);
  await db.delete(tools);
});

async function addTool(name: string): Promise<string> {
  const [row] = await db.insert(tools).values({ name, slug: name.toLowerCase().replace(/\W+/g, "-") }).returning({ id: tools.id });
  return row.id;
}

it("queues, starts one run with the refresh ids, and records the run", async () => {
  const a = await addTool("Form 4");
  const outcome = await queueRefresh({ userId: ADMIN, toolIds: [a], note: null, includeDescription: false, db });
  expect(outcome).toMatchObject({ ok: true, queued: 1, skipped: 0, runId: "run-from-start" });
  const [refresh] = await listRefreshesForTool(a, { db });
  expect(vi.mocked(start).mock.calls[0][1]).toEqual([expect.any(String), [refresh.id]]);
  expect((await db.select().from(toolRefreshes))[0].workflowRunId).toBe("run-from-start");
});

it("refuses more tools than one press may send, before anything moves", async () => {
  const ids = await Promise.all(Array.from({ length: RESEARCH_MAX_ITEMS_PER_REQUEST + 1 }, (_, n) => addTool(`Tool ${n}`)));
  expect(await queueRefresh({ userId: ADMIN, toolIds: ids, note: null, includeDescription: false, db })).toEqual({
    ok: false,
    error: "too_many_tools",
  });
  expect(await db.select().from(toolRefreshes)).toHaveLength(0);
});

it("starts nothing when every tool already has a refresh open, and says how many were skipped", async () => {
  const a = await addTool("Form 4");
  await queueRefresh({ userId: ADMIN, toolIds: [a], note: null, includeDescription: false, db });
  vi.mocked(start).mockClear();
  expect(await queueRefresh({ userId: ADMIN, toolIds: [a], note: null, includeDescription: false, db })).toMatchObject({
    ok: true,
    queued: 0,
    skipped: 1,
    runId: null,
  });
  expect(start).not.toHaveBeenCalled();
});

it("a start that throws fails the rows with why, so Refresh again is offered", async () => {
  const a = await addTool("Form 4");
  const outcome = await queueRefresh({
    userId: ADMIN,
    toolIds: [a],
    note: null,
    includeDescription: false,
    db,
    startRun: async () => {
      throw new Error("world unavailable");
    },
  });
  expect(outcome).toEqual({ ok: false, error: "start_failed" });
  const [refresh] = await listRefreshesForTool(a, { db });
  expect(await getRefresh(refresh.id, { db })).toMatchObject({ status: "failed", researchError: expect.stringMatching(/world unavailable/) });
});

it("answers the daily limit with what is left", async () => {
  const ids = await Promise.all(Array.from({ length: 3 }, (_, n) => addTool(`Tool ${n}`)));
  await db.insert(researchRequests).values(
    Array.from({ length: 99 }, () => ({ requestId: crypto.randomUUID(), userId: ADMIN }))
  );
  expect(await queueRefresh({ userId: ADMIN, toolIds: ids, note: null, includeDescription: false, db })).toEqual({
    ok: false,
    error: "daily_limit",
    remaining: 1,
  });
});

it("a press naming only missing tools is not_found", async () => {
  expect(
    await queueRefresh({ userId: ADMIN, toolIds: ["00000000-0000-4000-8000-000000000000"], note: null, includeDescription: false, db })
  ).toEqual({ ok: false, error: "not_found" });
});

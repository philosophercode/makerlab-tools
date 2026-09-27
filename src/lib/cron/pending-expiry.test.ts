// @vitest-environment node
import { sql } from "drizzle-orm";
import { createPgliteDb } from "../db/pglite";
import { attachments, pendingTools, user } from "../db/schema/index";
import type { Db } from "../db/types";
import { ABANDONED_RESEARCH_MESSAGE, ABANDONED_START_MESSAGE } from "../data/pending-tools";
import { runPendingExpiry } from "./pending-expiry";

/**
 * The daily cron's pending-tool expiry (spec §4.10), against a real
 * (in-process) Postgres. Only status and age decide who is discarded —
 * `expireIdentifiedPendingTools` is the module under test in
 * `src/lib/data/pending-tools.test.ts`; what is under test here is this
 * stage's own contract (the 14-day cutoff, the clock injection, the shape of
 * its result).
 */

const OWNER = "pending-expiry-owner";
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-23T00:00:00.000Z");

let db: Db;

beforeAll(async () => {
  db = await createPgliteDb();
  await db.insert(user).values({
    id: OWNER,
    name: "Owner",
    email: "pending-expiry-owner@cornell.edu",
  });
});

beforeEach(async () => {
  await db.delete(attachments);
  await db.delete(pendingTools);
});

/** Insert an `identified` row, then backdate `created_at` with SQL. */
async function identifiedItem(name: string, ageDays: number): Promise<string> {
  const [row] = await db
    .insert(pendingTools)
    .values({ batchId: crypto.randomUUID(), status: "identified", name, createdBy: OWNER })
    .returning({ id: pendingTools.id });
  const createdAt = new Date(NOW.getTime() - ageDays * DAY_MS);
  await db.execute(sql`update pending_tools set created_at = ${createdAt} where id = ${row.id}`);
  return row.id;
}

async function attach(ownerId: string): Promise<string> {
  const [row] = await db
    .insert(attachments)
    .values({
      blobPathname: `uploads/tool/${crypto.randomUUID()}.png`,
      access: "public",
      publicUrl: `https://blob.test/${crypto.randomUUID()}.png`,
      ownerType: "pending_tool",
      ownerId,
    })
    .returning({ id: attachments.id });
  return row.id;
}

it("discards a 15-day-old identified row and releases its photo", async () => {
  const id = await identifiedItem("Glowforge Pro", 15);
  const photo = await attach(id);

  const result = await runPendingExpiry({ db, now: NOW });

  expect(result).toEqual({ discarded: 1, releasedAttachments: 1, abandoned: 0, deleted: 0, releasedOrphanPhotos: 0 });
  const [row] = await db.select().from(pendingTools).where(sql`id = ${id}`);
  expect(row.status).toBe("discarded");
  const [attachment] = await db.select().from(attachments).where(sql`id = ${photo}`);
  expect(attachment.ownerId).toBeNull();
  expect(attachment.ownerType).toBeNull();
});

it("leaves a 13-day-old identified row untouched", async () => {
  const id = await identifiedItem("Bambu Lab P1S", 13);

  const result = await runPendingExpiry({ db, now: NOW });

  expect(result).toEqual({ discarded: 0, releasedAttachments: 0, abandoned: 0, deleted: 0, releasedOrphanPhotos: 0 });
  const [row] = await db.select().from(pendingTools).where(sql`id = ${id}`);
  expect(row.status).toBe("identified");
});

it("never discards a researched row however old it is", async () => {
  const [row] = await db
    .insert(pendingTools)
    .values({
      batchId: crypto.randomUUID(),
      status: "researched",
      name: "Prusa MK4S",
      createdBy: OWNER,
    })
    .returning({ id: pendingTools.id });
  await db.execute(
    sql`update pending_tools set created_at = ${new Date(NOW.getTime() - 30 * DAY_MS)} where id = ${row.id}`
  );

  const result = await runPendingExpiry({ db, now: NOW });

  expect(result).toEqual({ discarded: 0, releasedAttachments: 0, abandoned: 0, deleted: 0, releasedOrphanPhotos: 0 });
  const [after] = await db.select().from(pendingTools).where(sql`id = ${row.id}`);
  expect(after.status).toBe("researched");
});

/** A row research took at `requestedHoursAgo`, in `status`, with or without a run. */
async function heldItem(
  status: "queued" | "researching",
  requestedHoursAgo: number,
  workflowRunId: string | null
): Promise<string> {
  const [row] = await db
    .insert(pendingTools)
    .values({
      batchId: crypto.randomUUID(),
      status,
      name: "Bambu Lab X1 Carbon",
      createdBy: OWNER,
      workflowRunId,
      researchRequestedAt: new Date(NOW.getTime() - requestedHoursAgo * 60 * 60 * 1000),
    })
    .returning({ id: pendingTools.id });
  return row.id;
}

it("fails an item an abandoned run has held for more than a day, saying why", async () => {
  const researching = await heldItem("researching", 25, "wrun_1");
  const queuedUnderRun = await heldItem("queued", 25, "wrun_2");

  const result = await runPendingExpiry({ db, now: NOW });

  expect(result).toEqual({ discarded: 0, releasedAttachments: 0, abandoned: 2, deleted: 0, releasedOrphanPhotos: 0 });
  for (const id of [researching, queuedUnderRun]) {
    const [row] = await db.select().from(pendingTools).where(sql`id = ${id}`);
    expect(row.status).toBe("failed");
    expect(row.researchError).toBe(ABANDONED_RESEARCH_MESSAGE);
  }
});

it("leaves research younger than a day alone, including a queued item with no run", async () => {
  const running = await heldItem("researching", 23, "wrun_3");
  // A start that failed or is still starting: a Research press can take it over.
  const unstarted = await heldItem("queued", 2, null);

  const result = await runPendingExpiry({ db, now: NOW });

  expect(result.abandoned).toBe(0);
  const rows = await db.select().from(pendingTools);
  expect(rows.find((row) => row.id === running)?.status).toBe("researching");
  expect(rows.find((row) => row.id === unstarted)?.status).toBe("queued");
});

it("fails a queued item whose start never happened, keeping a recorded start failure's reason", async () => {
  const silent = await heldItem("queued", 25, null);
  const recorded = await heldItem("queued", 25, null);
  await db.execute(sql`update pending_tools set research_error = 'Could not start research: boom' where id = ${recorded}`);

  const result = await runPendingExpiry({ db, now: NOW });

  expect(result.abandoned).toBe(2);
  const rows = await db.select().from(pendingTools);
  expect(rows.find((row) => row.id === silent)).toMatchObject({
    status: "failed",
    researchError: ABANDONED_START_MESSAGE,
  });
  expect(rows.find((row) => row.id === recorded)).toMatchObject({
    status: "failed",
    researchError: "Could not start research: boom",
  });
});

it("deletes a discarded item a month on, and releases photos whose item is gone", async () => {
  const [row] = await db
    .insert(pendingTools)
    .values({ batchId: crypto.randomUUID(), status: "discarded", name: "Thrown away", createdBy: OWNER })
    .returning({ id: pendingTools.id });
  await db.execute(sql`alter table pending_tools disable trigger pending_tools_set_updated_at`);
  await db.execute(sql`update pending_tools set updated_at = ${new Date(NOW.getTime() - 31 * DAY_MS)} where id = ${row.id}`);
  await db.execute(sql`alter table pending_tools enable trigger pending_tools_set_updated_at`);
  // A photo pointing at an item that was deleted out from under it.
  const stranded = await attach(crypto.randomUUID());

  const result = await runPendingExpiry({ db, now: NOW });

  expect(result).toMatchObject({ deleted: 1, releasedOrphanPhotos: 1 });
  expect(await db.select().from(pendingTools).where(sql`id = ${row.id}`)).toEqual([]);
  const [photo] = await db.select().from(attachments).where(sql`id = ${stranded}`);
  expect(photo.ownerId).toBeNull();
});

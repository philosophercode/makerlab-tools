// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { expectViolation } from "../../../../test/db";
import { migrationsFolder } from "../migrations-folder";
import { createPgliteDb } from "../pglite";
import type { Db } from "../types";
import { auditEvents } from "./audit";
import { account, session, user } from "./auth";
import { blockedEmails } from "./blocked-emails";
import { bulkImports } from "./imports";
import { maintenanceLogs } from "./maintenance";
import { pendingTools } from "./pending-tools";
import { chatProposals } from "./refresh";

/**
 * Migration `0016` against a real (in-process) Postgres (auth spec amendment
 * 2026-09-25, "Remove a person, and block an address"): the new table and
 * columns, the two owner columns that stopped cascading, and the hand-appended
 * data — the audit actor backfill and **every banned account converted** into
 * a blocked address plus a removal.
 *
 * The data statements ran when this database was migrated — on empty tables,
 * so they changed nothing. To prove what they do to rows that exist, the test
 * writes rows the way they looked before `0016` and runs **the statements read
 * from the migration file itself**, so an edit to the file is what is tested.
 */

function dataStatements(): string[] {
  const file = readFileSync(join(migrationsFolder(), "0016_people_remove.sql"), "utf8");
  const parts = file.split("--> statement-breakpoint").map((part) => part.trim());
  const start = parts.findIndex((part) => part.includes("Remove replaces Ban"));
  expect(start).toBeGreaterThan(0);
  return parts.slice(start).map((part) => part.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean);
}

async function runData(db: Db) {
  for (const statement of dataStatements()) await db.execute(sql.raw(statement));
}

describe("migration 0016 — shape", () => {
  let db: Db;
  beforeAll(async () => {
    db = await createPgliteDb();
    await db.insert(user).values({ id: "u-a", name: "A", email: "a@cornell.edu" });
  });

  it("creates blocked_emails keyed by address, with a set-null blocker", async () => {
    await db.insert(blockedEmails).values({ email: "x@cornell.edu", blockedBy: "u-a" });
    await expectViolation(db.insert(blockedEmails).values({ email: "x@cornell.edu" }), /blocked_emails_pkey/);
    await expectViolation(db.insert(blockedEmails).values({ email: "y@cornell.edu", blockedBy: "nobody" }), /blocked_by/);
  });

  it("lets pending_tools and bulk_imports outlive their owner", async () => {
    await db.insert(user).values({ id: "u-owner", name: "Owner", email: "owner@cornell.edu" });
    const batchId = crypto.randomUUID();
    const [pending] = await db.insert(pendingTools).values({ batchId, name: "X", createdBy: "u-owner" }).returning();
    const [imported] = await db
      .insert(bulkImports)
      .values({ batchId, sourceKind: "paste", format: "list", sourceText: "X", createdBy: "u-owner" })
      .returning();

    await db.delete(user).where(eq(user.id, "u-owner"));

    expect((await db.select().from(pendingTools).where(eq(pendingTools.id, pending.id)))[0].createdBy).toBeNull();
    expect((await db.select().from(bulkImports).where(eq(bulkImports.id, imported.id)))[0].createdBy).toBeNull();
  });
});

describe("migration 0016 — data", () => {
  it("backfills the audit actor's name from the account", async () => {
    const db = await createPgliteDb();
    await db.insert(user).values({ id: "u-actor", name: "Act Or", email: "actor@cornell.edu" });
    // Written the pre-0016 way: no name.
    await db.insert(auditEvents).values({ actorUserId: "u-actor", action: "role.changed", subjectType: "user", subjectId: "s" });
    await db.insert(auditEvents).values({ actorUserId: null, action: "role.changed", subjectType: "user", subjectId: "s" });

    await runData(db);

    const names = (await db.select({ actorName: auditEvents.actorName }).from(auditEvents)).map((row) => row.actorName);
    expect(names.sort()).toEqual(["Act Or", null]);
  });

  it("converts every banned account into a blocked address and a removal, history kept", async () => {
    const db = await createPgliteDb();
    await db.insert(user).values([
      { id: "u-banned", name: "Ben Banned", email: "Ben@Cornell.edu", banned: true, banReason: "Spam" },
      { id: "u-banned-2", name: "No Reason", email: "noreason@cornell.edu", banned: true },
      { id: "u-fine", name: "Fay Fine", email: "fay@cornell.edu", banned: false },
    ]);
    await db.insert(session).values({ id: "s1", token: "t1", userId: "u-banned", expiresAt: new Date(Date.now() + 1e7) });
    await db.insert(account).values({ id: "a1", accountId: "g1", providerId: "google", userId: "u-banned" });
    const batchId = crypto.randomUUID();
    const [pending] = await db.insert(pendingTools).values({ batchId, name: "Printer", createdBy: "u-banned" }).returning();
    const [proposal] = await db
      .insert(chatProposals)
      .values({ subjectKind: "tool", subjectId: crypto.randomUUID(), proposal: sql`'{}'::jsonb`, baseRevision: "1", createdBy: "u-banned" })
      .returning();
    const [ticket] = await db
      .insert(maintenanceLogs)
      .values({ title: "Leak", reportedByName: "Ben Banned", reportedByEmail: "Ben@Cornell.edu", reportedByUserId: "u-banned" })
      .returning();
    await db.insert(auditEvents).values({ actorUserId: "u-banned", action: "tool.published", subjectType: "tool", subjectId: "t" });

    await runData(db);

    // The accounts are gone, and only the banned ones.
    expect((await db.select({ id: user.id }).from(user)).map((row) => row.id)).toEqual(["u-fine"]);
    expect(await db.select().from(session)).toEqual([]);
    expect(await db.select().from(account)).toEqual([]);

    // Their addresses are blocked, normalised, with the ban reason.
    const blocked = await db.select().from(blockedEmails);
    expect(blocked.map((row) => [row.email, row.reason]).sort()).toEqual([
      ["ben@cornell.edu", "Spam"],
      ["noreason@cornell.edu", "Banned before Remove replaced Ban"],
    ]);

    // History stays, with the names.
    expect((await db.select().from(pendingTools).where(eq(pendingTools.id, pending.id)))[0]).toMatchObject({
      createdBy: null,
      createdByName: "Ben Banned",
    });
    expect((await db.select().from(chatProposals).where(eq(chatProposals.id, proposal.id)))[0]).toMatchObject({
      createdBy: null,
      createdByName: "Ben Banned",
    });
    expect((await db.select().from(maintenanceLogs).where(eq(maintenanceLogs.id, ticket.id)))[0]).toMatchObject({
      reportedByName: "Ben Banned",
      reportedByUserId: "u-banned",
    });

    // And the trail says what happened, by nobody in particular.
    const events = await db.select().from(auditEvents);
    expect(events.find((event) => event.action === "tool.published")).toMatchObject({ actorUserId: null, actorName: "Ben Banned" });
    const removed = events.filter((event) => event.action === "user.removed");
    expect(removed.map((event) => event.subjectId).sort()).toEqual(["u-banned", "u-banned-2"]);
    expect(removed.find((event) => event.subjectId === "u-banned")).toMatchObject({
      actorUserId: null,
      detail: { name: "Ben Banned", email: "Ben@Cornell.edu", blocked: true, reason: "ban_migrated", banReason: "Spam" },
    });
    expect(events.filter((event) => event.action === "email.blocked").map((event) => event.subjectId).sort()).toEqual([
      "ben@cornell.edu",
      "noreason@cornell.edu",
    ]);
  });

  it("is a no-op on a database with no bans", async () => {
    const db = await createPgliteDb();
    await db.insert(user).values({ id: "u-fine", name: "Fay Fine", email: "fay@cornell.edu" });

    await runData(db);

    expect(await db.select().from(user)).toHaveLength(1);
    expect(await db.select().from(blockedEmails)).toEqual([]);
    expect(await db.select().from(auditEvents)).toEqual([]);
  });
});

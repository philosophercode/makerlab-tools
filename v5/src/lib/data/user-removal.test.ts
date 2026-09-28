// @vitest-environment node
import { eq, sql } from "drizzle-orm";
import { createPgliteDb } from "../db/pglite";
import { rawRows } from "../db/raw";
import {
  account,
  apiTokens,
  auditEvents,
  blockedEmails,
  bulkImports,
  chatProposals,
  feedback,
  maintenanceLogs,
  notionMirrors,
  oauthAccessToken,
  oauthApplication,
  oauthConsent,
  pendingTools,
  projects,
  researchAllowances,
  session,
  user,
} from "../db/schema/index";
import type { Db } from "../db/types";
import { listSourceRows } from "../mirror/source";
import { listAuditEvents, recordAuditEvent } from "./audit";
import { listBulkImports } from "./bulk-imports";
import { listFeedbackQueue } from "./feedback";
import { listMaintenanceQueue } from "./maintenance";
import { saveMirrorConnection } from "./mirrors";
import { getPendingTool } from "./pending-tools";
import { listProjectsForModeration } from "./projects";
import { removeUserAccount } from "./user-removal";

/**
 * Removing a person, against a real (in-process) Postgres (auth spec amendment
 * 2026-09-25, "Remove a person, and block an address"): every credential goes,
 * the account goes, and every record that names them keeps working — with the
 * name it already had and "(removed)" derivable from what is left.
 *
 * Each test builds its own database, so counts are exact.
 */

interface Cast {
  db: Db;
  target: string;
  director: string;
  mirrorOwner: string;
  mirrorId: string;
}

async function setup(): Promise<Cast> {
  const db = await createPgliteDb();
  const target = "u-target";
  const director = "u-director";
  const mirrorOwner = "u-mirror";
  await db.insert(user).values([
    { id: target, name: "Tara Get", email: "tara@cornell.edu", role: "admin" },
    { id: director, name: "Dee Rector", email: "dee@cornell.edu", role: "super_admin" },
    { id: mirrorOwner, name: "Mo Mirror", email: "mo@cornell.edu", role: "admin" },
  ]);
  const { mirror } = await saveMirrorConnection(
    { ownerUserId: mirrorOwner, tokenCiphertext: new Uint8Array([1]), parentPageId: crypto.randomUUID(), parentPageTitle: null },
    { db }
  );
  return { db, target, director, mirrorOwner, mirrorId: mirror.id };
}

/** Everything that names the target: credentials, history, and their own things. */
async function populate({ db, target }: Cast) {
  await db.insert(session).values({ id: "s1", token: "tok-1", userId: target, expiresAt: new Date(Date.now() + 86_400_000) });
  await db.insert(session).values({ id: "s2", token: "tok-2", userId: target, expiresAt: new Date(Date.now() + 86_400_000) });
  await db.insert(account).values({ id: "a1", accountId: "google-sub", providerId: "google", userId: target });
  await db.insert(apiTokens).values({ userId: target, name: "Laptop", prefix: "abcd1234", tokenHash: "hash-1" });
  await db.insert(oauthApplication).values({ id: "app1", clientId: "client-1", redirectUrls: "https://x.test/cb", type: "public" });
  await db.insert(oauthAccessToken).values({
    id: "oat1",
    accessToken: "access-1",
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    clientId: "client-1",
    userId: target,
  });
  await db.insert(oauthConsent).values({ id: "c1", clientId: "client-1", userId: target, consentGiven: true });
  await db.insert(researchAllowances).values({ userId: target, extraItems: 50, expiresAt: new Date(Date.now() + 86_400_000) });

  const [ticket] = await db
    .insert(maintenanceLogs)
    .values({
      title: "Nozzle clogged",
      reportedByName: "Tara Get",
      reportedByEmail: "tara@cornell.edu",
      reportedByUserId: target,
      assignedToUserId: target,
      assignedToName: "Tara Get",
    })
    .returning({ id: maintenanceLogs.id });
  const [correction] = await db
    .insert(feedback)
    .values({ issueDescription: "Wrong bed size", reporterName: "Tara Get", reporterEmail: "tara@cornell.edu", reporterUserId: target })
    .returning({ id: feedback.id });
  const [project] = await db
    .insert(projects)
    .values({ slug: "lamp", title: "Lamp", authorName: "Tara Get", authorUserId: target, published: true, createdBy: target })
    .returning({ id: projects.id });
  const batchId = crypto.randomUUID();
  const [pending] = await db
    .insert(pendingTools)
    .values({ batchId, name: "Bambu X2D", createdBy: target })
    .returning({ id: pendingTools.id });
  const [imported] = await db
    .insert(bulkImports)
    .values({ batchId, sourceKind: "paste", format: "list", sourceText: "Bambu X2D", createdBy: target, status: "ready" })
    .returning({ id: bulkImports.id });
  const [proposal] = await db
    .insert(chatProposals)
    .values({
      subjectKind: "tool",
      subjectId: crypto.randomUUID(),
      proposal: sql`'{}'::jsonb`,
      baseRevision: "1",
      chatId: "mcp",
      createdBy: target,
    })
    .returning({ id: chatProposals.id });
  // Something they did, recorded while they were here.
  await recordAuditEvent({ actorUserId: target, action: "tool.published", subjectType: "tool", subjectId: "t1" }, { db });

  return { ticket: ticket.id, correction: correction.id, project: project.id, pending: pending.id, imported: imported.id, proposal: proposal.id };
}

async function count(db: Db, table: string, where: string): Promise<number> {
  const rows = await rawRows<{ n: number }>(db, sql.raw(`select count(*)::int as n from ${table} where ${where}`));
  return Number(rows[0]?.n ?? 0);
}

describe("removeUserAccount", () => {
  it("revokes every credential and deletes the account", async () => {
    const cast = await setup();
    await populate(cast);
    const { db, target, director } = cast;

    const result = await removeUserAccount({ userId: target, actorUserId: director }, { db });

    expect(result).toEqual({
      ok: true,
      removed: { id: target, name: "Tara Get", email: "tara@cornell.edu", role: "admin" },
      blocked: false,
      revoked: { sessions: 2, tokens: 1, grants: 1 },
    });
    expect(await db.select().from(user).where(eq(user.id, target))).toEqual([]);
    expect(await count(db, "session", `user_id = '${target}'`)).toBe(0);
    expect(await count(db, "account", `user_id = '${target}'`)).toBe(0);
    expect(await count(db, "api_tokens", `user_id = '${target}'`)).toBe(0);
    expect(await count(db, "oauth_access_token", `user_id = '${target}'`)).toBe(0);
    expect(await count(db, "oauth_consent", `user_id = '${target}'`)).toBe(0);
    expect(await count(db, "research_allowances", `user_id = '${target}'`)).toBe(0);
    // Nobody else's account moved.
    expect(await count(db, `"user"`, "true")).toBe(2);
  });

  it("keeps every record that names them, with the name it had and 'removed' derivable", async () => {
    const cast = await setup();
    const ids = await populate(cast);
    const { db, target, director } = cast;

    await removeUserAccount({ userId: target, actorUserId: director }, { db });

    const [ticket] = await db.select().from(maintenanceLogs).where(eq(maintenanceLogs.id, ids.ticket));
    expect(ticket).toMatchObject({
      reportedByName: "Tara Get",
      reportedByEmail: "tara@cornell.edu",
      reportedByUserId: target,
      assignedToUserId: null,
      assignedToName: "Tara Get",
    });
    expect((await listMaintenanceQueue({ db })).find((row) => row.id === ids.ticket)).toMatchObject({
      reportedByName: "Tara Get",
      reporterRemoved: true,
    });
    expect((await listFeedbackQueue({ db })).find((row) => row.id === ids.correction)).toMatchObject({
      reporterName: "Tara Get",
      reporterRemoved: true,
    });
    expect((await listProjectsForModeration({ db })).find((row) => row.id === ids.project)).toMatchObject({
      authorName: "Tara Get",
      authorRemoved: true,
    });

    // The two tables whose owner used to cascade keep the row, and the name.
    expect(await getPendingTool(ids.pending, { db })).toMatchObject({
      createdBy: null,
      createdByName: "Tara Get",
      createdByRemoved: true,
    });
    expect((await listBulkImports({}, { db })).find((row) => row.id === ids.imported)).toMatchObject({
      createdBy: null,
      createdByName: "Tara Get",
      createdByRemoved: true,
    });
    const [proposal] = await db.select().from(chatProposals).where(eq(chatProposals.id, ids.proposal));
    expect(proposal).toMatchObject({ createdBy: null, createdByName: "Tara Get" });

    // What they did is still attributed.
    const published = (await listAuditEvents({ db })).find((event) => event.action === "tool.published");
    expect(published).toMatchObject({ actorUserId: null, actorName: "Tara Get" });
  });

  it("leaves people still on the roster reading exactly as before", async () => {
    const cast = await setup();
    const { db, director } = cast;
    const [ticket] = await db
      .insert(maintenanceLogs)
      .values({ title: "Belt", reportedByName: "Dee Rector", reportedByUserId: director })
      .returning({ id: maintenanceLogs.id });
    const [anonymous] = await db
      .insert(maintenanceLogs)
      .values({ title: "Anon", reportedByName: "Somebody" })
      .returning({ id: maintenanceLogs.id });

    const queue = await listMaintenanceQueue({ db });
    expect(queue.find((row) => row.id === ticket.id)?.reporterRemoved).toBe(false);
    expect(queue.find((row) => row.id === anonymous.id)?.reporterRemoved).toBe(false);
  });

  it("records user.removed with actor, subject, name and email — and email.blocked when blocking", async () => {
    const cast = await setup();
    await populate(cast);
    const { db, target, director } = cast;

    const result = await removeUserAccount(
      { userId: target, actorUserId: director, block: { reason: "Misuse" } },
      { db }
    );
    expect(result).toMatchObject({ ok: true, blocked: true });

    const events = await listAuditEvents({ db });
    expect(events.find((event) => event.action === "user.removed")).toMatchObject({
      actorUserId: director,
      actorName: "Dee Rector",
      subjectType: "user",
      subjectId: target,
      detail: { name: "Tara Get", email: "tara@cornell.edu", role: "admin", blocked: true },
    });
    expect(events.find((event) => event.action === "email.blocked")).toMatchObject({
      actorUserId: director,
      subjectType: "email",
      subjectId: "tara@cornell.edu",
      detail: { userId: target, reason: "Misuse" },
    });
    expect(await db.select().from(blockedEmails)).toEqual([
      expect.objectContaining({ email: "tara@cornell.edu", reason: "Misuse", blockedBy: director }),
    ]);
  });

  it("drops their account-bound mirror and marks their changes for everybody else's mirror", async () => {
    const cast = await setup();
    const ids = await populate(cast);
    const { db, target, director, mirrorId } = cast;
    await saveMirrorConnection(
      { ownerUserId: target, tokenCiphertext: new Uint8Array([2]), parentPageId: crypto.randomUUID(), parentPageTitle: null },
      { db }
    );
    // "Pushed" just now: nothing is newer than this until the removal.
    const [{ stamp }] = await rawRows<{ stamp: string }>(db, sql`select clock_timestamp()::text as stamp`);
    // PGlite's clock can read the same millisecond twice; the push compares `>`.
    await new Promise((resolve) => setTimeout(resolve, 10));

    await removeUserAccount({ userId: target, actorUserId: director }, { db });

    expect(await count(db, "notion_mirrors", `owner_user_id = '${target}'`)).toBe(0);
    expect(await db.select().from(notionMirrors)).toHaveLength(1);

    const tickets = await listSourceRows("maintenance", { db, mirrorId, since: stamp, limit: 50 });
    expect(tickets.find((row) => row.id === ids.ticket)).toMatchObject({
      reportedByName: "Tara Get",
      reportedByEmail: "tara@cornell.edu",
      assignedToName: "Tara Get",
      assigneeEmail: null,
    });
    const projectsOut = await listSourceRows("projects", { db, mirrorId, since: stamp, limit: 50 });
    expect(projectsOut.find((row) => row.id === ids.project)).toMatchObject({ authorName: "Tara Get", authorEmail: null });
  });

  it("refuses to remove the last director, and changes nothing", async () => {
    const db = await createPgliteDb();
    await db.insert(user).values([
      { id: "u-only", name: "Only Director", email: "only@cornell.edu", role: "super_admin" },
      { id: "u-banned", name: "Banned Director", email: "banned@cornell.edu", role: "super_admin", banned: true },
    ]);

    expect(await removeUserAccount({ userId: "u-only", actorUserId: null }, { db })).toEqual({
      ok: false,
      error: "last_super_admin",
    });
    expect(await db.select().from(user).where(eq(user.id, "u-only"))).toHaveLength(1);
    expect(await db.select().from(auditEvents)).toEqual([]);
  });

  it("allows removing a director while another remains", async () => {
    const db = await createPgliteDb();
    await db.insert(user).values([
      { id: "u-one", name: "One", email: "one@cornell.edu", role: "super_admin" },
      { id: "u-two", name: "Two", email: "two@cornell.edu", role: "super_admin" },
    ]);

    expect(await removeUserAccount({ userId: "u-one", actorUserId: "u-two" }, { db })).toMatchObject({ ok: true });
  });

  it("refuses an id that names nobody", async () => {
    const db = await createPgliteDb();
    expect(await removeUserAccount({ userId: "nobody", actorUserId: null }, { db })).toEqual({
      ok: false,
      error: "unknown_user",
    });
  });

  it("keeps an earlier block when the same address is removed and blocked again", async () => {
    const cast = await setup();
    const { db, target, director } = cast;
    await db.insert(blockedEmails).values({ email: "tara@cornell.edu", reason: "First time", blockedBy: director });

    const result = await removeUserAccount({ userId: target, actorUserId: director, block: { reason: "Second" } }, { db });
    expect(result).toMatchObject({ ok: true, blocked: true });
    expect(await db.select().from(blockedEmails)).toEqual([expect.objectContaining({ reason: "First time" })]);
    // Nothing new happened to the list, so nothing new is recorded about it.
    expect((await listAuditEvents({ db })).filter((event) => event.action === "email.blocked")).toEqual([]);
  });
});

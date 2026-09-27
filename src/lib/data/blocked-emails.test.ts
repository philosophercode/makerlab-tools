// @vitest-environment node
import { createPgliteDb } from "../db/pglite";
import { user } from "../db/schema/index";
import type { Db } from "../db/types";
import { listAuditEvents } from "./audit";
import { insertBlockedEmail, isEmailBlocked, listBlockedEmails, unblockEmail } from "./blocked-emails";

/**
 * `blocked_emails` (auth spec amendment 2026-09-25): stored normalised, read
 * with the blocker's name, and unblocked with an audit event in the same
 * transaction.
 */

let db: Db;

beforeEach(async () => {
  db = await createPgliteDb();
  await db.insert(user).values({ id: "u-dee", name: "Dee Rector", email: "dee@cornell.edu", role: "super_admin" });
});

describe("blocked emails", () => {
  it("stores an address normalised and matches it however it is written", async () => {
    expect(await insertBlockedEmail({ email: "  Ada@Cornell.EDU ", reason: " Misuse ", blockedBy: "u-dee" }, { db })).toEqual({
      inserted: true,
    });
    expect(await isEmailBlocked("ada@cornell.edu", { db })).toBe(true);
    expect(await isEmailBlocked("ADA@cornell.edu", { db })).toBe(true);
    expect(await isEmailBlocked("grace@cornell.edu", { db })).toBe(false);
    expect(await isEmailBlocked("", { db })).toBe(false);
  });

  it("keeps the first block when the same address is blocked twice", async () => {
    await insertBlockedEmail({ email: "ada@cornell.edu", reason: "First", blockedBy: "u-dee" }, { db });
    expect(await insertBlockedEmail({ email: "ADA@cornell.edu", reason: "Second", blockedBy: null }, { db })).toEqual({
      inserted: false,
    });
    expect(await listBlockedEmails({ db })).toEqual([
      expect.objectContaining({ email: "ada@cornell.edu", reason: "First", blockedByName: "Dee Rector" }),
    ]);
  });

  it("lists who blocked it while that account exists, and nobody after", async () => {
    await insertBlockedEmail({ email: "ada@cornell.edu", blockedBy: "u-dee" }, { db });
    await db.delete(user);

    const [row] = await listBlockedEmails({ db });
    // Removing the blocker does not unblock the address.
    expect(row).toMatchObject({ email: "ada@cornell.edu", reason: null, blockedByName: null });
  });

  it("unblocks, recording email.unblocked with the actor", async () => {
    await insertBlockedEmail({ email: "ada@cornell.edu", reason: "Misuse", blockedBy: "u-dee" }, { db });

    expect(await unblockEmail({ email: "Ada@cornell.edu", actorUserId: "u-dee" }, { db })).toEqual({ removed: true });
    expect(await isEmailBlocked("ada@cornell.edu", { db })).toBe(false);
    expect(await listAuditEvents({ db })).toEqual([
      expect.objectContaining({
        actorUserId: "u-dee",
        actorName: "Dee Rector",
        action: "email.unblocked",
        subjectType: "email",
        subjectId: "ada@cornell.edu",
        detail: { reason: "Misuse" },
      }),
    ]);
  });

  it("records nothing for an address that was not blocked", async () => {
    expect(await unblockEmail({ email: "nobody@cornell.edu", actorUserId: "u-dee" }, { db })).toEqual({ removed: false });
    expect(await listAuditEvents({ db })).toEqual([]);
  });
});

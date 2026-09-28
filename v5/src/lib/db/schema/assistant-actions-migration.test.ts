// @vitest-environment node
import { eq, sql } from "drizzle-orm";
import { recordAuditEvent, listAuditEvents } from "../../data/audit";
import { createPgliteDb } from "../pglite";
import { actionProposals } from "./action-proposals";
import { auditEvents } from "./audit";
import { user } from "./auth";

/**
 * Migration `0020` (assistant–GUI parity spec §3.5, §3.7): `action_proposals`
 * with its `updated_at` trigger, and `audit_events.surface` / `proposal_id` —
 * every existing event reads as the GUI's, and a surface outside the
 * vocabulary is refused by the database itself.
 */

describe("migration 0020 — action proposals and the audit surface", () => {
  it("defaults every event to the GUI, with no proposal", async () => {
    const db = await createPgliteDb();
    await db.insert(user).values({ id: "u-dee", name: "Dee", email: "dee@cornell.edu", role: "super_admin" });
    await db.insert(auditEvents).values({ actorUserId: "u-dee", action: "role.changed", subjectType: "user", subjectId: "s" });
    const [row] = await db.select().from(auditEvents);
    expect(row).toMatchObject({ surface: "gui", proposalId: null });
  });

  it("records a card's surface and proposal, and refuses an unknown surface", async () => {
    const db = await createPgliteDb();
    await db.insert(user).values({ id: "u-dee", name: "Dee", email: "dee@cornell.edu", role: "super_admin" });
    const proposalId = crypto.randomUUID();
    await recordAuditEvent(
      { actorUserId: "u-dee", action: "user.title_changed", subjectType: "user", subjectId: "s", surface: "assistant", proposalId },
      { db }
    );
    expect((await listAuditEvents({ db }))[0]).toMatchObject({ surface: "assistant", proposalId, actorName: "Dee" });
    await expect(
      db.insert(auditEvents).values({ actorUserId: null, action: "role.changed", subjectType: "user", subjectId: "s", surface: "model" })
    ).rejects.toThrow();
  });

  it("keeps action_proposals.updated_at current on every update", async () => {
    const db = await createPgliteDb();
    const [row] = await db
      .insert(actionProposals)
      .values({
        groupId: crypto.randomUUID(),
        actionId: "tickets.update",
        input: {},
        subjectType: "maintenance_log",
        subjectId: "x",
        preview: {},
        surface: "assistant",
        expiresAt: sql`now() + interval '1 hour'`,
        createdAt: sql`now() - interval '1 hour'`,
        updatedAt: sql`now() - interval '1 hour'`,
      })
      .returning();
    await db.update(actionProposals).set({ status: "cancelled" }).where(eq(actionProposals.id, row.id));
    const [after] = await db.select().from(actionProposals).where(eq(actionProposals.id, row.id));
    expect(after.updatedAt.getTime()).toBeGreaterThan(row.updatedAt.getTime());
  });
});

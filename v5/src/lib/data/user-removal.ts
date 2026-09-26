import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import {
  account,
  apiTokens,
  bulkImports,
  chatProposals,
  oauthAccessToken,
  oauthConsent,
  pendingTools,
  projects,
  session,
  user,
} from "../db/schema/index.ts";
import type { Role } from "../db/schema/vocabulary.ts";
import type { Db } from "../db/types.ts";
import { recordAuditEvent } from "./audit.ts";
import { insertBlockedEmail } from "./blocked-emails.ts";

/**
 * Removing a person (auth spec amendment 2026-09-25, "Remove a person, and
 * block an address").
 *
 * **One transaction**: the name snapshots, the revocations, the account, the
 * optional block and the audit events commit together or not at all. The app
 * owns the whole write here — no admin-plugin call in the middle — so unlike a
 * role change there is no "landed without its audit event" state to report.
 *
 * **What goes, and what stays.** Every credential goes: sessions, personal
 * access tokens, OAuth access tokens and consents, the Google `account` link,
 * and the `user` row itself. What still references the row follows its foreign
 * key — dynamic OAuth clients they registered, their research ledger and setup
 * allowances, and their own Notion mirror cascade; every actor column is
 * `on delete set null`. History stays: tickets, corrections and projects keep
 * the reporter's or author's name and email as written (their `*_user_id` is
 * not a foreign key and keeps the old id — "an id that names no account" is how
 * the queues know to say "(removed)"), and the three tables that only ever
 * showed a person's name through a join get it written down here first.
 *
 * The guards that need the environment or the caller — the super-admin floor,
 * removing yourself — are the server action's (`app/admin/users/actions.ts`).
 * The one that needs the database to be still — the last super admin — is
 * checked here, under a lock, so two directors removing each other at once
 * cannot both succeed.
 *
 * Relative imports with `.ts` extensions, no `@/` alias and no `"server-only"`,
 * like every other module under `src/lib/data/`.
 */

export type RemovalRefusal = "unknown_user" | "last_super_admin";

export interface RemovedPerson {
  id: string;
  name: string;
  email: string;
  role: Role;
}

/** How many of each credential the removal revoked. */
export interface RevokedCounts {
  sessions: number;
  tokens: number;
  /** Distinct OAuth clients the person had granted or consented to. */
  grants: number;
}

export type RemovalResult =
  | { ok: true; removed: RemovedPerson; blocked: boolean; revoked: RevokedCounts }
  | { ok: false; error: RemovalRefusal };

export interface RemoveUserInput {
  userId: string;
  /** Who is removing them — the audit actor and the blocker. */
  actorUserId: string | null;
  /** Also block the address from signing up again, with an optional reason. */
  block?: { reason?: string | null } | null;
}

export interface RemovalOptions {
  /** A handle to use instead of {@link getDb} — tests pass an isolated one. */
  db?: Db;
}

export async function removeUserAccount(
  input: RemoveUserInput,
  options: RemovalOptions = {}
): Promise<RemovalResult> {
  if (!input.userId) return { ok: false, error: "unknown_user" };
  const db = options.db ?? (await getDb());

  return db.transaction(async (tx) => {
    const [target] = await tx.select().from(user).where(eq(user.id, input.userId)).for("update").limit(1);
    if (!target) return { ok: false, error: "unknown_user" } as const;

    if (target.role === "super_admin") {
      // Lock every director's row before counting, so a concurrent removal of
      // the other one waits for this one and then sees it.
      await tx.select({ id: user.id }).from(user).where(eq(user.role, "super_admin")).for("update");
      const [row] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(user)
        .where(
          and(
            eq(user.role, "super_admin"),
            ne(user.id, target.id),
            // `banned` is nullable; see `countUsersWithRole`.
            or(eq(user.banned, false), isNull(user.banned))
          )
        );
      if (Number(row?.total ?? 0) === 0) return { ok: false, error: "last_super_admin" } as const;
    }

    // The names the foreign keys are about to lose (the three reads that only
    // ever showed them through a join). Written before the delete, which then
    // clears `created_by`.
    await tx.update(pendingTools).set({ createdByName: target.name }).where(eq(pendingTools.createdBy, target.id));
    await tx.update(bulkImports).set({ createdByName: target.name }).where(eq(bulkImports.createdBy, target.id));
    await tx.update(chatProposals).set({ createdByName: target.name }).where(eq(chatProposals.createdBy, target.id));
    // Touched so the Notion mirror re-pushes them without the author's email
    // (it reads that through a join). A ticket's assignee needs nothing: the
    // foreign key clears `assigned_to_user_id` and the trigger stamps it.
    await tx.update(projects).set({ updatedAt: sql`now()` }).where(eq(projects.authorUserId, target.id));

    // Revoke. Each would cascade from the `user` delete below anyway; deleting
    // them by name first is what makes the counts — and the intent — explicit.
    const sessions = await tx.delete(session).where(eq(session.userId, target.id)).returning({ id: session.id });
    const tokens = await tx.delete(apiTokens).where(eq(apiTokens.userId, target.id)).returning({ id: apiTokens.id });
    const oauthTokens = await tx
      .delete(oauthAccessToken)
      .where(eq(oauthAccessToken.userId, target.id))
      .returning({ clientId: oauthAccessToken.clientId });
    const consents = await tx
      .delete(oauthConsent)
      .where(eq(oauthConsent.userId, target.id))
      .returning({ clientId: oauthConsent.clientId });
    const grants = new Set([...oauthTokens, ...consents].map((row) => row.clientId)).size;

    await tx.delete(account).where(eq(account.userId, target.id));
    await tx.delete(user).where(eq(user.id, target.id));

    const revoked: RevokedCounts = { sessions: sessions.length, tokens: tokens.length, grants };
    const blocked = Boolean(input.block);

    await recordAuditEvent(
      {
        actorUserId: input.actorUserId,
        action: "user.removed",
        subjectType: "user",
        subjectId: target.id,
        detail: { name: target.name, email: target.email, role: target.role, blocked, revoked },
      },
      { db: tx }
    );

    if (input.block) {
      const { inserted } = await insertBlockedEmail(
        { email: target.email, reason: input.block.reason ?? null, blockedBy: input.actorUserId },
        { db: tx }
      );
      // Already on the list (an earlier removal of the same address): the
      // block stands and nothing new happened to it.
      if (inserted) {
        await recordAuditEvent(
          {
            actorUserId: input.actorUserId,
            action: "email.blocked",
            subjectType: "email",
            subjectId: target.email.trim().toLowerCase(),
            detail: { userId: target.id, reason: (input.block.reason ?? "").trim() || null },
          },
          { db: tx }
        );
      }
    }

    return {
      ok: true,
      removed: { id: target.id, name: target.name, email: target.email, role: (target.role ?? "user") as Role },
      blocked,
      revoked,
    } as const;
  });
}

import { asc, eq } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { blockedEmails, user } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";
import { recordAuditEvent } from "./audit.ts";

/**
 * `blocked_emails` — addresses that may not sign up (auth spec amendment
 * 2026-09-25, "Remove a person, and block an address").
 *
 * Written by removal (`user-removal.ts`, inside its transaction) and cleared by
 * **Unblock** on the People page. Read at sign-in by
 * `lib/auth/blocked-sign-in.ts`, which is where the super-admin floor is
 * applied — this module does not read the environment, because it runs under
 * plain Node like every other module in `src/lib/data/`.
 *
 * Addresses are compared normalised: trimmed and lower-cased, the same as
 * `normalizeEmail` in `lib/auth/roles.ts` (not imported: that module is not
 * plain-Node loadable).
 */

export interface BlockedEmailRecord {
  email: string;
  reason: string | null;
  /** Who blocked it, when that account still exists. */
  blockedByName: string | null;
  createdAt: Date;
}

export interface BlockedEmailOptions {
  /** A handle to use instead of {@link getDb} — tests and transactions pass one. */
  db?: Db;
}

/** Trimmed and lower-cased; `""` for nothing usable. */
export function normalizeBlockedEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/** True when `email` is on the list. The floor is the caller's concern. */
export async function isEmailBlocked(
  email: string | null | undefined,
  options: BlockedEmailOptions = {}
): Promise<boolean> {
  const normalized = normalizeBlockedEmail(email);
  if (!normalized) return false;
  const db = options.db ?? (await getDb());
  const [row] = await db
    .select({ email: blockedEmails.email })
    .from(blockedEmails)
    .where(eq(blockedEmails.email, normalized))
    .limit(1);
  return Boolean(row);
}

/**
 * Put `email` on the list. Idempotent: an address already blocked keeps its
 * first reason and blocker, and the answer says nothing new was written.
 */
export async function insertBlockedEmail(
  input: { email: string; reason?: string | null; blockedBy: string | null },
  options: BlockedEmailOptions = {}
): Promise<{ inserted: boolean }> {
  const normalized = normalizeBlockedEmail(input.email);
  if (!normalized) return { inserted: false };
  const db = options.db ?? (await getDb());
  const reason = (input.reason ?? "").trim() || null;
  const rows = await db
    .insert(blockedEmails)
    .values({ email: normalized, reason, blockedBy: input.blockedBy })
    .onConflictDoNothing({ target: blockedEmails.email })
    .returning({ email: blockedEmails.email });
  return { inserted: rows.length > 0 };
}

/** Every blocked address, oldest first, with the blocker's current name. */
export async function listBlockedEmails(options: BlockedEmailOptions = {}): Promise<BlockedEmailRecord[]> {
  const db = options.db ?? (await getDb());
  const rows = await db
    .select({
      email: blockedEmails.email,
      reason: blockedEmails.reason,
      blockedByName: user.name,
      createdAt: blockedEmails.createdAt,
    })
    .from(blockedEmails)
    .leftJoin(user, eq(user.id, blockedEmails.blockedBy))
    .orderBy(asc(blockedEmails.createdAt), asc(blockedEmails.email));
  return rows.map((row) => ({
    email: row.email,
    reason: row.reason ?? null,
    blockedByName: row.blockedByName ?? null,
    createdAt: row.createdAt,
  }));
}

/**
 * Take `email` off the list and record `email.unblocked`, in one transaction.
 * `removed: false` when it was not on the list — nothing is recorded then,
 * because nothing changed.
 */
export async function unblockEmail(
  input: { email: string; actorUserId: string | null },
  options: BlockedEmailOptions = {}
): Promise<{ removed: boolean }> {
  const normalized = normalizeBlockedEmail(input.email);
  if (!normalized) return { removed: false };
  const db = options.db ?? (await getDb());
  return db.transaction(async (tx) => {
    const deleted = await tx
      .delete(blockedEmails)
      .where(eq(blockedEmails.email, normalized))
      .returning({ email: blockedEmails.email, reason: blockedEmails.reason });
    if (deleted.length === 0) return { removed: false };
    await recordAuditEvent(
      {
        actorUserId: input.actorUserId,
        action: "email.unblocked",
        subjectType: "email",
        subjectId: normalized,
        detail: { reason: deleted[0].reason ?? null },
      },
      { db: tx }
    );
    return { removed: true };
  });
}

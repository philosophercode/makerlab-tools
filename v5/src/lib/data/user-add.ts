import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { user } from "../db/schema/index.ts";
import type { Role } from "../db/schema/vocabulary.ts";
import type { Db } from "../db/types.ts";
import { recordAuditEvent, type AuditTrail } from "./audit.ts";
import { toUserRecord, type UserRecord } from "./users.ts";

/**
 * Adding a person before they have signed in (People page, "Add person").
 *
 * The row is an ordinary `user` row with no `account` and no session, and
 * `first_signed_in_at` null — that null is what the roster reads as "Not signed
 * in yet". When the person later signs in with Google, Better Auth finds the
 * row by email and **links** the Google account to it instead of creating a
 * second one (`account.accountLinking` in `auth/config.ts`), so the role and
 * title set here are what they arrive with.
 *
 * The caller (`addPerson` in `app/admin/users/actions.ts`) has already
 * normalised the address and checked the domain rule, the blocked list and the
 * floor; this module only guarantees one row per address and writes the row
 * and its `user.added` event in **one transaction**, like a removal.
 *
 * Relative imports with `.ts` extensions, no `@/` alias and no `"server-only"`,
 * like every other module under `src/lib/data/`.
 */

export interface AddPersonInput {
  /** Already trimmed and lower-cased. */
  email: string;
  /** Shown until their first sign-in replaces it with their Google name. */
  name: string;
  role: Role;
  /** Normalised custom title, or null for the role's default. */
  title: string | null;
  /** Who added them — the audit actor. */
  actorUserId: string | null;
  /** The surface and proposal the addition came from, for its audit event (parity spec §3.7). */
  trail?: AuditTrail;
}

export type AddPersonResult =
  | { ok: true; person: UserRecord }
  | { ok: false; error: "duplicate_email" };

export interface AddPersonOptions {
  /** A handle to use instead of {@link getDb} — tests pass an isolated one. */
  db?: Db;
}

/** Postgres' unique_violation: two adds of the same address raced. */
const UNIQUE_VIOLATION = "23505";

export async function addPersonAccount(
  input: AddPersonInput,
  options: AddPersonOptions = {}
): Promise<AddPersonResult> {
  const db = options.db ?? (await getDb());

  try {
    return await db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: user.id }).from(user).where(eq(user.email, input.email)).limit(1);
      if (existing) return { ok: false, error: "duplicate_email" } as const;

      const now = new Date();
      const [row] = await tx
        .insert(user)
        .values({
          id: randomUUID(),
          email: input.email,
          name: input.name,
          // Nobody has proved they own the address yet. Better Auth sets it
          // true when Google does, at the link.
          emailVerified: false,
          role: input.role,
          title: input.title,
          // Explicitly null: the column's default is "now", which would claim
          // a sign-in that has not happened.
          firstSignedInAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      await recordAuditEvent(
        {
          ...input.trail,
          actorUserId: input.actorUserId,
          action: "user.added",
          subjectType: "user",
          subjectId: row.id,
          detail: { email: row.email, name: row.name, role: input.role, title: input.title },
        },
        { db: tx }
      );

      return { ok: true, person: toUserRecord(row) } as const;
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: "duplicate_email" };
    throw err;
  }
}

function isUniqueViolation(err: unknown): boolean {
  for (let current: unknown = err; current; current = (current as { cause?: unknown }).cause) {
    if ((current as { code?: unknown }).code === UNIQUE_VIOLATION) return true;
  }
  return false;
}

import "server-only";

import { z } from "zod";
import { ADMIN_USERS_PATH, PERSON_NAME_MAX_LENGTH, type AdminActionError } from "../../app/admin/users/action-result";
import { isSignUpBlocked } from "../auth/blocked-sign-in";
import { isAllowedEmail, normalizeEmail } from "../auth/roles";
import { isSuperAdminFloor } from "../auth/super-admins";
import { maskEmail } from "../capabilities/admin-reads";
import { isEmailBlocked, unblockEmail } from "../data/blocked-emails";
import { addPersonAccount } from "../data/user-add";
import { removeUserAccount } from "../data/user-removal";
import { findUserById } from "../data/users";
import { isOneOf, ROLES, type Role } from "../db/schema/vocabulary";
import { requestMirrorPush } from "../mirror/trigger";
import { normalizeTitle, USER_TITLE_MAX_LENGTH } from "../people/title";
import { auditTrail, defineAction, toolShape } from "./define";
import { reconcileFloorAfterGate } from "./people-gate";

/**
 * Who is on the roster: add, remove, unblock (spec §4.7 #46–48; auth spec
 * amendment 2026-09-25). Moved verbatim from `app/admin/users/actions.ts`.
 * Each of these writes its audit events inside its own transaction
 * (`lib/data/user-add.ts`, `user-removal.ts`, `blocked-emails.ts`), so a
 * success carries no audit gap of its own — only the floor reconciliation's.
 */

type PeopleError = Exclude<AdminActionError, "not_signed_in" | "not_permitted" | "rate_limited">;

// ── people.add ──────────────────────────────────────────────────────

/** Good enough to refuse a typo; Google is what proves the address is real. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface AddInput {
  email: string;
  name?: string;
  role: string;
  title?: string | null;
}

type NormalizedAdd = { email: string; name: string; role: Role; title: string | null };

/**
 * Add person's rules, in the order the page always refused them: an address
 * that is not one, a name or title too long, a role outside the vocabulary,
 * an address the domain rule would refuse at sign-in. **The floor wins**, as
 * at sign-in: a floor address is stored `super_admin` whatever was chosen.
 */
function normalizeAdd(input: AddInput): { ok: true; value: NormalizedAdd } | { ok: false; error: PeopleError } {
  const email = normalizeEmail(input.email);
  if (!EMAIL_SHAPE.test(email)) return { ok: false, error: "invalid_email" };
  const typedName = typeof input.name === "string" ? input.name.replace(/\s+/g, " ").trim() : "";
  if (typedName.length > PERSON_NAME_MAX_LENGTH) return { ok: false, error: "invalid_name" };
  const title = normalizeTitle(input.title ?? null);
  if (!title.ok) return { ok: false, error: "invalid_title" };
  if (!isOneOf(ROLES, input.role)) return { ok: false, error: "invalid_role" };
  if (!isAllowedEmail(email)) return { ok: false, error: "email_not_allowed" };
  return {
    ok: true,
    value: {
      email,
      // The address is the honest placeholder when nobody typed a name, and the
      // only name Google's replaces at their first sign-in (`lib/auth/provider-name.ts`).
      name: typedName || email,
      role: isSuperAdminFloor(email) ? "super_admin" : input.role,
      title: title.title,
    },
  };
}

export const PEOPLE_ADD = defineAction<
  AddInput,
  { person: { id: string; name: string; email: string; role: Role; title: string | null } },
  PeopleError
>({
  id: "people.add",
  toolName: "add_person",
  description:
    "Add somebody to the roster before their first sign-in, with an email, optional name, a role and an optional title. Proposes the addition; nothing changes until the person confirms it on the card.",
  permission: "users.manage",
  risk: "people",
  input: z.object({
    email: z.string(),
    name: z.string().optional(),
    role: z.string(),
    title: z.string().nullable().optional(),
  }),
  invalidInput: "invalid_email",
  subject: (input) => ({ type: "email", id: normalizeEmail(input.email) }),
  afterGate: reconcileFloorAfterGate,
  check: async (input) => {
    const normalized = normalizeAdd(input);
    if (!normalized.ok) return normalized.error;
    return (await isSignUpBlocked(normalized.value.email)) ? "email_blocked" : null;
  },
  tool: toolShape(
    z.strictObject({
      email: z.string().min(3).max(254).describe("Their address, exactly as the person typed it"),
      name: z.string().max(PERSON_NAME_MAX_LENGTH).optional().describe("Their name, if the person gave one; their Google name replaces a blank one at first sign-in"),
      role: z.enum(ROLES).describe("user, admin or super_admin — the authorization level, never a title"),
      title: z.string().max(USER_TITLE_MAX_LENGTH).nullable().optional().describe("A custom title such as \"Supermaker\", if the person gave one"),
    }),
    (args) => ({ ok: true, inputs: [{ email: args.email, name: args.name, role: args.role, title: args.title ?? null }] })
  ),
  preview: async (input) => {
    const normalized = normalizeAdd(input);
    if (!normalized.ok) return null;
    const person = normalized.value;
    return {
      summary: { key: "people_add", values: { email: person.email } },
      rows: [
        { field: "email", before: null, after: person.email },
        // The placeholder is the address; say nothing rather than repeat it.
        ...(person.name !== person.email ? [{ field: "name", before: null, after: person.name }] : []),
        { field: "role", before: null, after: person.role, format: "role" as const },
        ...(person.title ? [{ field: "title", before: null, after: person.title }] : []),
      ],
      subjectName: person.email,
      link: ADMIN_USERS_PATH,
    };
  },
  run: async (input, ctx) => {
    const normalized = normalizeAdd(input);
    if (!normalized.ok) return normalized;
    if (await isSignUpBlocked(normalized.value.email)) return { ok: false, error: "email_blocked" };
    const result = await addPersonAccount({ ...normalized.value, actorUserId: ctx.identity.userId, trail: auditTrail(ctx) });
    if (!result.ok) return result;
    const { person } = result;
    return {
      ok: true,
      value: { person: { id: person.id, name: person.name, email: person.email, role: person.role, title: person.title } },
      committed: true,
    };
  },
  revalidate: [ADMIN_USERS_PATH],
});

// ── people.remove ───────────────────────────────────────────────────

/** The longest block reason kept; the field is a note, not a document. */
const BLOCK_REASON_MAX = 200;

/**
 * Remove one person, optionally blocking their address. Refuses an unknown
 * target, removing yourself and a floor address; the data layer refuses the
 * last super admin under a lock. A removal changes what the Notion mirror
 * carries (an assignee's or author's email goes), so a push follows it.
 */
export const PEOPLE_REMOVE = defineAction<
  { userId: string; block?: boolean; reason?: string },
  { removed: { id: string; name: string; email: string }; blocked: boolean },
  PeopleError
>({
  id: "people.remove",
  toolName: "remove_person",
  description:
    "Remove one person's account (sessions, tokens and sign-in go; the audit trail keeps their name), optionally blocking their address. Proposes the removal; nothing changes until the person types the name and confirms it on the card.",
  permission: "users.manage",
  risk: "destructive",
  input: z.object({ userId: z.string(), block: z.boolean().optional(), reason: z.string().optional() }),
  invalidInput: "unknown_user",
  subject: (input) => ({ type: "user", id: input.userId }),
  afterGate: reconcileFloorAfterGate,
  check: async (input, ctx) => removalRefusal(input.userId, ctx.identity.userId),
  // The card (§5.4): who goes, as the People page shows them, with "Also block
  // this address" off unless the person said "block". Typed name to confirm.
  tool: toolShape(
    z.strictObject({
      user_id: z.string().min(1).max(64).describe("The person's id, from find_people"),
      block: z.boolean().optional().describe("Also block their address from signing up again — only if the person said so"),
      reason: z.string().max(BLOCK_REASON_MAX).optional().describe("Why they are blocked, if the person said"),
    }),
    (args) => ({
      ok: true,
      inputs: [{ userId: args.user_id, block: args.block ?? false, ...(args.block && args.reason ? { reason: args.reason } : {}) }],
    })
  ),
  preview: async (input) => {
    const target = await findUserById(input.userId);
    if (!target) return null;
    return {
      summary: { key: input.block ? "people_remove_block" : "people_remove", values: { name: target.name } },
      rows: [
        { field: "role", before: target.role, after: null, format: "role" as const },
        ...(target.title ? [{ field: "title", before: target.title, after: null }] : []),
        ...(input.block ? [{ field: "blocked", before: null, after: maskEmail(target.email) }] : []),
      ],
      subjectName: target.name,
      link: ADMIN_USERS_PATH,
    };
  },
  run: async (input, ctx) => {
    const refusal = await removalRefusal(input.userId, ctx.identity.userId);
    if (refusal) return { ok: false, error: refusal };
    const reason = (input.reason ?? "").trim().slice(0, BLOCK_REASON_MAX) || null;
    const result = await removeUserAccount({
      userId: input.userId,
      actorUserId: ctx.identity.userId,
      block: input.block ? { reason } : null,
      trail: auditTrail(ctx),
    });
    if (!result.ok) return result;
    const { removed } = result;
    return {
      ok: true,
      value: { removed: { id: removed.id, name: removed.name, email: removed.email }, blocked: result.blocked },
      committed: true,
    };
  },
  afterCommit: async () => {
    await requestMirrorPush();
    return undefined;
  },
  revalidate: [ADMIN_USERS_PATH],
});

async function removalRefusal(userId: string, callerId: string | null): Promise<PeopleError | null> {
  const target = await findUserById(userId);
  if (!target) return "unknown_user";
  if (target.id === callerId) return "self_remove";
  // The floor can be neither removed nor blocked: it is the lock-out guarantee.
  if (isSuperAdminFloor(target.email)) return "protected_floor";
  return null;
}

// ── people.unblock_email ────────────────────────────────────────────

/**
 * Take an address off the blocked list, so it may sign up again as a new
 * account with the default role. An address not on the list is a no-op
 * success — and the page is refreshed either way, as it always was.
 */
export const PEOPLE_UNBLOCK_EMAIL = defineAction<{ email?: string | null }, { email: string }, PeopleError>({
  id: "people.unblock_email",
  toolName: "unblock_email",
  description:
    "Take an address off the blocked list so it may sign up again. Proposes the change; nothing changes until the person confirms it on the card.",
  permission: "users.manage",
  risk: "people",
  input: z.object({ email: z.string().nullish() }),
  invalidInput: "invalid_email",
  subject: (input) => ({ type: "email", id: (input.email ?? "").trim().toLowerCase() }),
  afterGate: reconcileFloorAfterGate,
  tool: toolShape(
    z.strictObject({ email: z.string().min(3).max(254).describe("The blocked address, exactly as the person typed it") }),
    (args) => ({ ok: true, inputs: [{ email: args.email }] })
  ),
  // An address that is not on the list has nothing to confirm: the card would
  // promise a change the click cannot make.
  preview: async (input) => {
    const email = (input.email ?? "").trim().toLowerCase();
    if (!email || !(await isEmailBlocked(email))) return null;
    return {
      summary: { key: "people_unblock_email", values: { email } },
      rows: [],
      subjectName: email,
      link: ADMIN_USERS_PATH,
    };
  },
  run: async (input, ctx) => {
    const email = (input.email ?? "").trim().toLowerCase();
    await unblockEmail({ email, actorUserId: ctx.identity.userId, trail: auditTrail(ctx) });
    return { ok: true, value: { email }, committed: true };
  },
  revalidate: [ADMIN_USERS_PATH],
});

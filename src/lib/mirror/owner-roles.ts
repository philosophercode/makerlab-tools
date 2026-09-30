import type { Role } from "../db/schema/vocabulary.ts";

/**
 * The stored roles that hold `mirror.manage` (spec §3.5, §8 "owner-only").
 *
 * A mirror pushes only while its owner still holds that permission and is not
 * banned: every claim in `data/mirrors.ts` joins the owner's `user` row and
 * requires `role` in this list and `banned is not true`. Demoting or banning
 * an admin therefore stops their mirror on the next trigger — without it, a
 * demoted admin's personal Notion would keep receiving reporter names and
 * emails, and nobody left in the app could pause it.
 *
 * A constant rather than a call to `can()`: this list is read by workflow step
 * code under plain Node, which must not load Better Auth's access-control
 * module. `owner-roles.test.ts` derives the same list from `can()` and fails
 * the moment the two disagree.
 *
 * The super-admin floor (`AUTH_SUPER_ADMIN_EMAILS`) is not consulted: the row
 * is what the claim reads, and a floor address's row is set right by
 * `reconcileSuperAdminFloor`.
 */
export const MIRROR_OWNER_ROLES: readonly Role[] = ["admin", "super_admin"];

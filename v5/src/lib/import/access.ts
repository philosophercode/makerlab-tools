import type { Permission } from "../auth/permissions";
import { canActOnPendingTool } from "../intake/access";

/**
 * Who may import, and act on an import (bulk intake spec §8 "Authorization").
 *
 * - Importing, reviewing and researching need `tools.add` — the chat's
 *   `identify_tools` rule, since an import is the same first step.
 * - An import, like a pending item, is its owner's, or anybody's who holds
 *   `tools.approve` too.
 * - Approving stays `tools.approve`, on `/admin/intake`, unchanged.
 * - Granting a setup allowance is `users.manage` (a super admin).
 *
 * Client-safe: `permissions.ts` is pure data.
 */

export const IMPORT_PERMISSION: Permission = "tools.add";
export const ALLOWANCE_PERMISSION: Permission = "users.manage";

export const canActOnImport = canActOnPendingTool;

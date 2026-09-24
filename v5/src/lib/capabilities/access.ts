import { can, type Permission } from "../auth/permissions";
import type { Role } from "../auth/roles";
import type { Capability } from "./types";

/**
 * Who may use which capability on a session surface (data platform design spec
 * §3.5). A capability declares the *permission* it needs; this module is the one
 * place that declaration is enforced, so the chat composes the assistant from
 * {@link capabilitiesForIdentity} instead of checking inside tools.
 *
 * Phase 4 replaced the rank comparison this used to do. `minimumRole` plus
 * `isAtLeast` ordered four role names; `requiredPermission` plus `can()` asks
 * the declaration in `auth/permissions.ts`, which is the same declaration the
 * route handlers and the admin plugin use. One check, everywhere.
 *
 * MCP is deliberately not a session surface. Its trust boundary is `MCP_TOKEN`,
 * which already gates every write tool there, and an MCP caller has no role.
 *
 * Client-safe: `permissions.ts` is pure data and the `Capability` import is
 * type-only, so the header can ask {@link canAddEquipment} without pulling the
 * registry (and the Notion client behind it) into the browser bundle.
 */

/** The permission intake requires. Named so call sites read as intent. */
export const INTAKE_PERMISSION: Permission = "tools.add";

/** Anything that carries a role: an `Identity`, or a client identity. */
export type AccessSubject = { role: Role | null | undefined } | null | undefined;

/** True when `subject` may add equipment to the catalogue. */
export function canAddEquipment(subject: AccessSubject): boolean {
  return can(subject, INTAKE_PERMISSION);
}

/**
 * True when `subject` holds `permission`. A capability with no
 * `requiredPermission` is open to everyone, anonymous visitors included —
 * browsing and asking questions never required an account.
 */
export function meetsRequiredPermission(
  subject: AccessSubject,
  permission: Permission | undefined
): boolean {
  if (!permission) return true;
  return can(subject, permission);
}

/**
 * The registry as `subject` may use it. A capability the subject does not hold
 * keeps its place in the order but contributes no tools, and its prompt fragment
 * is swapped for `lockedPromptFragment`, so the assistant can say why rather
 * than improvise around tools it cannot see.
 */
export function capabilitiesForIdentity(
  capabilities: Capability[],
  subject: AccessSubject
): Capability[] {
  return capabilities.map((capability) =>
    meetsRequiredPermission(subject, capability.requiredPermission)
      ? capability
      : {
          id: capability.id,
          promptFragment: capability.lockedPromptFragment ?? (() => ""),
          tools: [],
        }
  );
}

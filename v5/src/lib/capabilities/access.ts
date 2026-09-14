import { isAtLeast, type Role } from "../auth/roles";
import type { Capability } from "./types";

/**
 * Who may use which capability on a session surface (auth spec amendment
 * 2026-09-14). A capability declares the least-privileged role that may use it;
 * this module is the one place that rule is enforced, so the chat composes the
 * assistant from {@link capabilitiesForRole} instead of checking inside tools.
 *
 * MCP is deliberately not a session surface. Its trust boundary is `MCP_TOKEN`,
 * which already gates every write tool there, and an MCP caller has no role.
 *
 * Client-safe: `roles.ts` is universal and the `Capability` import is type-only,
 * so the header can ask {@link canAddEquipment} without pulling the registry
 * (and the Notion client behind it) into the browser bundle.
 */

/** The least-privileged role that may add equipment through intake. */
export const INTAKE_MINIMUM_ROLE: Role = "staff";

/**
 * True when `role` meets `minimumRole`. No minimum means everyone, and a missing
 * role is treated as anonymous — never as a pass.
 */
export function meetsMinimumRole(
  role: Role | null | undefined,
  minimumRole: Role | undefined
): boolean {
  if (!minimumRole) return true;
  return isAtLeast(role ?? "anonymous", minimumRole);
}

/** True when `role` may add equipment to the catalog. */
export function canAddEquipment(role: Role | null | undefined): boolean {
  return meetsMinimumRole(role, INTAKE_MINIMUM_ROLE);
}

/**
 * The registry as `role` may use it. A capability the role does not meet keeps
 * its place in the order but contributes no tools, and its prompt fragment is
 * swapped for `lockedPromptFragment`, so the assistant can say why rather than
 * improvise around tools it cannot see.
 */
export function capabilitiesForRole(
  capabilities: Capability[],
  role: Role | null | undefined
): Capability[] {
  return capabilities.map((capability) =>
    meetsMinimumRole(role, capability.minimumRole)
      ? capability
      : {
          id: capability.id,
          promptFragment: capability.lockedPromptFragment ?? (() => ""),
          tools: [],
        }
  );
}

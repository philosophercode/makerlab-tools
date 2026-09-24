import type { Identity } from "../../src/lib/auth/identity";
import type { Role } from "../../src/lib/auth/roles";

/**
 * Hand-built identities for tests that need a caller but no database row —
 * the MCP adapter's listing, capability access, prompt fragments. A test that
 * writes on somebody's behalf seeds a real `user` row with `seedUser` instead,
 * because every `created_by` is a foreign key.
 */
export function identityFor(role: Role, overrides: Partial<Identity> = {}): Identity {
  if (role === "anonymous") {
    return { role, userId: null, email: null, name: null, rateLimitKey: "ip:test", ...overrides };
  }
  const userId = overrides.userId ?? `test-${role}`;
  return {
    role,
    userId,
    email: `${userId}@cornell.edu`,
    name: `Test ${role}`,
    rateLimitKey: `user:${userId}`,
    ...overrides,
  };
}

/** The MCP adapter's access for `role`, read-only when asked. */
export function mcpAccessFor(role: Role, readOnly = false): { identity: Identity; readOnly: boolean } {
  return { identity: identityFor(role), readOnly };
}

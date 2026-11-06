import { fc, RUNS } from "./fc";
import { evaluateUser } from "@/lib/auth/identity";
import { ROLES } from "@/lib/db/schema/vocabulary";

/**
 * INVARIANT 13 — an account acts with its stored role or not at all, and the
 * super admin floor always holds.
 *
 * `evaluateUser` is the one rule every credential (session, access token,
 * OAuth token) goes through. For any user row:
 *
 * - An address outside the allowed domain never acts.
 * - A banned person never acts — unless the floor names them.
 * - A role outside the vocabulary never acts — unless the floor names them.
 * - A floor address always acts as super_admin, whatever its row says.
 * - Otherwise the role is exactly the stored one: never promoted.
 */

const DOMAIN = "lab.example.edu";
const FLOOR = "director@lab.example.edu";

beforeEach(() => {
  vi.stubEnv("AUTH_ALLOWED_EMAIL_DOMAIN", DOMAIN);
  vi.stubEnv("AUTH_ALLOWED_EMAILS", "");
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", FLOOR);
});

const local = fc.stringMatching(/^[a-z0-9._-]{1,20}$/);
const email = fc.oneof(
  local.map((l) => `${l}@${DOMAIN}`),
  local.map((l) => `${l}@evil-${DOMAIN}`),
  local.map((l) => `${l}@${DOMAIN}.evil.com`),
  local.map((l) => `${l}@sub.${DOMAIN}`),
  local.map((l) => `${l}@gmail.com`),
  fc.constant(FLOOR),
  fc.constant(FLOOR.toUpperCase()),
  fc.constant(` ${FLOOR} `),
  fc.string()
);
const role = fc.oneof(fc.constantFrom<string | null>(...ROLES, null, "", "anonymous", "demo_admin", "SUPER_ADMIN", "owner"), fc.string());

describe("invariant: accounts act with their stored role, or not at all", () => {
  it("holds for any user row", () => {
    fc.assert(
      fc.property(email, role, fc.boolean(), (address, stored, banned) => {
        const verdict = evaluateUser({ id: "u1", email: address, role: stored, banned });
        const normalized = address.trim().toLowerCase();
        const onFloor = normalized === FLOOR;
        const inDomain = normalized.endsWith(`@${DOMAIN}`);

        if (!inDomain) expect(verdict.ok).toBe(false);
        else if (onFloor) expect(verdict).toEqual({ ok: true, role: "super_admin" });
        else if (banned) expect(verdict).toEqual({ ok: false, reason: "banned" });
        else if (!(ROLES as readonly string[]).includes(stored ?? "")) expect(verdict.ok).toBe(false);
        else expect(verdict).toEqual({ ok: true, role: stored });
      }),
      { numRuns: RUNS }
    );
  });
});

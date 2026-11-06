import { fc, RUNS } from "./fc";
import { PERMISSIONS, can, canView, roles, type Permission } from "@/lib/auth/permissions";
import { IDENTITY_ROLES, type Role } from "@/lib/auth/roles";

/**
 * INVARIANT 1 — `can()` fails closed, is monotonic, and bounds the demo.
 *
 * Every write in the app is gated by `can(subject, permission)`
 * (`src/lib/auth/permissions.ts`). These properties must hold for *any*
 * subject and *any* string, not just the table in `permissions.test.ts`:
 *
 * - Nobody holds anything by accident: anonymous, null, undefined, an unknown
 *   role, or a permission string that is not in the declaration → false.
 * - The role ladder is monotonic: user ⊆ admin ⊆ super_admin. A grant added to
 *   a lower role and forgotten on a higher one is a bug.
 * - `canView` only ever widens access for the demo identity; for every real
 *   role it is exactly `can`.
 *
 * And the demo identity is bounded.
 *
 * The public demo (`DEMO_ADMIN`) makes anonymous visitors a `demo_admin`. It
 * may add equipment and read drafts and serials — nothing else, ever — and
 * under `DEMO_ADMIN=view` (or `readOnly`) it may do nothing at all.
 */

const LADDER = ["user", "admin", "super_admin"] as const;
const DEMO_MAY = new Set<Permission>(["tools.add", "catalog.view_drafts", "catalog.view_serials"]);

const permission = fc.constantFrom(...PERMISSIONS);
const realRole = fc.constantFrom<Role>(...IDENTITY_ROLES);
/** Strings that look like permissions but are not: typos, case, padding, injected dots. */
const bogusPermission = fc
  .oneof(
    fc.string(),
    permission.map((p) => p.toUpperCase()),
    permission.map((p) => ` ${p}`),
    permission.map((p) => `${p}.extra`),
    permission.map((p) => p.replace(".", ":")),
    fc.tuple(fc.string(), fc.string()).map(([a, b]) => `${a}.${b}`)
  )
  .filter((s) => !(PERMISSIONS as string[]).includes(s));

describe("invariant: can() fails closed and is monotonic", () => {
  beforeEach(() => vi.stubEnv("DEMO_ADMIN", ""));

  it("an absent or unknown subject holds nothing", () => {
    const nobody = fc.oneof(
      fc.constant(null),
      fc.constant(undefined),
      fc.constant({ role: "anonymous" as Role }),
      fc.constant({ role: null }),
      fc.string().filter((s) => !(s in roles) && s !== "demo_admin").map((role) => ({ role: role as Role }))
    );
    fc.assert(
      fc.property(nobody, permission, (subject, p) => {
        expect(can(subject, p)).toBe(false);
        expect(canView(subject, p)).toBe(false);
      }),
      { numRuns: RUNS }
    );
  });

  it("a permission string outside the declaration is false for every role", () => {
    fc.assert(
      fc.property(realRole, bogusPermission, fc.boolean(), (role, p, readOnly) => {
        expect(can({ role, readOnly }, p as Permission)).toBe(false);
        expect(can({ role: "demo_admin", readOnly }, p as Permission)).toBe(false);
      }),
      { numRuns: RUNS }
    );
  });

  it("user ⊆ admin ⊆ super_admin", () => {
    fc.assert(
      fc.property(permission, fc.integer({ min: 0, max: LADDER.length - 2 }), (p, i) => {
        const lower = LADDER[i];
        const higher = LADDER[i + 1];
        if (can({ role: lower }, p)) expect(can({ role: higher }, p)).toBe(true);
      }),
      { numRuns: RUNS }
    );
  });

  it("canView is can() for every real role", () => {
    fc.assert(
      fc.property(realRole, permission, (role, p) => {
        expect(canView({ role }, p)).toBe(can({ role }, p));
      }),
      { numRuns: RUNS }
    );
  });
});

describe("invariant: the demo identity is bounded", () => {
  const mode = fc.constantFrom("", "0", "off", "1", "true", "TRUE", " 1 ", "view", "VIEW", "yes", "booth");

  it("holds at most tools.add + two reads, and nothing when read-only", () => {
    fc.assert(
      fc.property(mode, fc.boolean(), permission, (demoEnv, readOnly, p) => {
        vi.stubEnv("DEMO_ADMIN", demoEnv);
        const allowed = can({ role: "demo_admin", readOnly }, p);
        if (allowed) expect(DEMO_MAY.has(p)).toBe(true);
        const viewMode = demoEnv.trim().toLowerCase() === "view";
        if (readOnly || viewMode) expect(allowed).toBe(false);
        // Never more than a director could do.
        if (allowed) expect(can({ role: "super_admin" }, p)).toBe(true);
      }),
      { numRuns: RUNS }
    );
  });

  it("never holds a people, export, mirror or publish grant in any mode", () => {
    const dangerous = PERMISSIONS.filter((p) => !DEMO_MAY.has(p));
    fc.assert(
      fc.property(mode, fc.boolean(), fc.constantFrom(...dangerous), (demoEnv, readOnly, p) => {
        vi.stubEnv("DEMO_ADMIN", demoEnv);
        expect(can({ role: "demo_admin", readOnly }, p)).toBe(false);
      }),
      { numRuns: RUNS }
    );
  });
});

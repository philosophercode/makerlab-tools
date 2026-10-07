// @vitest-environment node
import { sql } from "drizzle-orm";
import { expectViolation } from "../../../test/db";
import { createPgliteDb } from "../db/pglite";
import { demoSignups } from "../db/schema/index";
import type { Db } from "../db/types";
import { chargeDemoPass, countDemoSignups, findOrCreateDemoSignup, getDemoPassLedger, listDemoSignups, type NewDemoSignup } from "./demo-signups";

/**
 * `demo_signups` (demo pass spec 2026-10-07 §4, §5): one pass per address,
 * the first sign-up stands, the ledger only grows, and the chat's read carries
 * no personal data.
 */

let db: Db;

const ENDS = new Date("2026-10-25T15:00:00.000Z");

function signup(overrides: Partial<NewDemoSignup> = {}): NewDemoSignup {
  return {
    name: "Ada Lovelace",
    email: "ada@example.org",
    institution: "Analytical Engines Lab",
    role: "lab_manager",
    runsMakerspace: true,
    useCase: "Inducting new members",
    consentToContact: true,
    passExpiresAt: ENDS,
    ...overrides,
  };
}

beforeEach(async () => {
  db = await createPgliteDb();
});

describe("demo sign-ups", () => {
  it("creates a sign-up with a fresh pass, then returns the same pass unchanged for the same address", async () => {
    const first = await findOrCreateDemoSignup(signup(), { db });
    expect(first.created).toBe(true);
    expect(first.pass).toMatchObject({ passExpiresAt: ENDS, spentUsd: 0, chargedTurns: 0 });

    await chargeDemoPass(first.pass.id, 0.1, { db });
    const again = await findOrCreateDemoSignup(signup({ name: "Someone Else", institution: "Elsewhere", consentToContact: false, passExpiresAt: new Date("2027-01-01T00:00:00Z") }), { db });
    expect(again.created).toBe(false);
    expect(again.pass).toMatchObject({ id: first.pass.id, passExpiresAt: ENDS, spentUsd: 0.1 });

    const [row] = await listDemoSignups({ db });
    expect(row).toMatchObject({ name: "Ada Lovelace", institution: "Analytical Engines Lab", consentToContact: true });
    expect(await countDemoSignups({ db })).toBe(1);
  });

  it("gives the chat's read no name, email or answers", async () => {
    const { pass } = await findOrCreateDemoSignup(signup(), { db });
    const ledger = await getDemoPassLedger(pass.id, { db });
    expect(Object.keys(ledger ?? {}).sort()).toEqual(["chargedTurns", "id", "passExpiresAt", "spentUsd"]);
    expect(JSON.stringify(ledger)).not.toMatch(/Ada|example\.org|Analytical/);
    expect(await getDemoPassLedger("not-a-uuid", { db })).toBeNull();
    expect(await getDemoPassLedger("3f2504e0-4f89-41d3-9a0c-0305e82c3301", { db })).toBeNull();
  });

  it("charges turns atomically, counting each one, and never subtracts", async () => {
    const { pass } = await findOrCreateDemoSignup(signup(), { db });
    await Promise.all([chargeDemoPass(pass.id, 0.012345, { db }), chargeDemoPass(pass.id, 0.02, { db }), chargeDemoPass(pass.id, -5, { db })]);
    const ledger = await getDemoPassLedger(pass.id, { db });
    expect(ledger?.spentUsd).toBeCloseTo(0.032345, 6);
    expect(ledger?.chargedTurns).toBe(3);
    expect(await chargeDemoPass("3f2504e0-4f89-41d3-9a0c-0305e82c3301", 0.1, { db })).toBeNull();
  });

  it("lists sign-ups newest first, with whether each pass is still running", async () => {
    await findOrCreateDemoSignup(signup({ email: "old@example.org", passExpiresAt: new Date("2020-01-01T00:00:00Z") }), { db });
    await db.execute(sql`update demo_signups set created_at = now() - interval '1 day'`);
    await findOrCreateDemoSignup(signup({ email: "new@example.org", passExpiresAt: new Date(Date.now() + 86_400_000) }), { db });
    const rows = await listDemoSignups({ db });
    expect(rows.map((row) => [row.email, row.passActive])).toEqual([
      ["new@example.org", true],
      ["old@example.org", false],
    ]);
  });

  it("refuses a role outside the vocabulary and a second row for one address", async () => {
    await expectViolation(db.insert(demoSignups).values({ ...signup(), role: "admin" }), /demo_signups_role_check/);
    await db.insert(demoSignups).values(signup());
    await expectViolation(db.insert(demoSignups).values(signup()), /demo_signups_email_key/);
  });
});

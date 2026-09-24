// @vitest-environment node
import { nextCacheMock } from "../../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());

import { revalidatePath } from "next/cache";
import { resetAuthForTests } from "../../../lib/auth/config";
import { readToolRevision } from "../../../lib/data/tools";
import { getDb, resetDbForTests } from "../../../lib/db/client";
import { maintenanceLogs, session, tools, units, user } from "../../../lib/db/schema/index";
import type { Db } from "../../../lib/db/types";
import { signInAsNew } from "../../../../test/utils/session";
import { addUnit, deleteUnit, editUnit, retireUnit } from "./unit-actions";

/**
 * The Units section's endpoints (spec §5.3(3), §4.5).
 *
 * Called directly, with no panel: each one is a POST endpoint and has to check
 * `tools.edit` for itself. The writes underneath are covered in
 * `src/lib/inventory/unit-edits.test.ts`; what is under test here is the gate,
 * the token, and that each refusal comes back as a code the panel can render.
 */

const AUTH_SECRET = "unit-actions-test-secret";

let db: Db;
let toolId: string;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  resetAuthForTests();
  vi.mocked(revalidatePath).mockClear();

  db = await getDb();
  await db.delete(maintenanceLogs);
  await db.delete(units);
  await db.delete(tools);
  await db.delete(session);
  await db.delete(user);

  const [row] = await db
    .insert(tools)
    .values({ slug: "form-4", name: "Form 4" })
    .returning({ id: tools.id });
  toolId = row.id;
});

afterEach(() => {
  resetAuthForTests();
  resetDbForTests();
});

async function asSuperMaker(email = "maker@cornell.edu") {
  const signedIn = await signInAsNew({ email, role: "admin" });
  setMockHeaders({ cookie: signedIn.cookie });
  return signedIn;
}

async function revision(): Promise<string> {
  return (await readToolRevision(toolId))!;
}

/** Add a unit as a signed-in SuperMaker and return its id. */
async function seedUnit(label: string, serialNumber?: string): Promise<string> {
  const result = await addUnit({
    toolId,
    expectedRevision: await revision(),
    unit: { unitLabel: label, ...(serialNumber ? { serialNumber } : {}) },
  });
  if (!result.ok) throw new Error(`expected the unit to be added: ${result.error}`);
  return result.unitId;
}

it("refuses every unit action from an anonymous caller, and adds nothing", async () => {
  setMockHeaders();
  const input = { toolId, expectedRevision: await revision() };

  expect(await addUnit({ ...input, unit: { unitLabel: "Form 4 #1" } })).toEqual({
    ok: false,
    error: "not_signed_in",
  });
  expect(await editUnit({ ...input, unitId: crypto.randomUUID(), patch: {} })).toEqual({
    ok: false,
    error: "not_signed_in",
  });
  expect(await retireUnit({ ...input, unitId: crypto.randomUUID() })).toEqual({
    ok: false,
    error: "not_signed_in",
  });
  expect(await deleteUnit({ ...input, unitId: crypto.randomUUID() })).toEqual({
    ok: false,
    error: "not_signed_in",
  });

  expect(await db.select().from(units)).toEqual([]);
});

it("refuses a student, who may browse the catalogue and nothing else", async () => {
  const student = await signInAsNew({ email: "student@cornell.edu", role: "user" });
  setMockHeaders({ cookie: student.cookie });

  expect(
    await addUnit({
      toolId,
      expectedRevision: await revision(),
      unit: { unitLabel: "Form 4 #1" },
    })
  ).toEqual({ ok: false, error: "not_permitted" });
  expect(await db.select().from(units)).toEqual([]);
});

it("adds a unit, moves the tool's token with it and refreshes the table", async () => {
  await asSuperMaker();
  const before = await revision();

  const result = await addUnit({
    toolId,
    expectedRevision: before,
    unit: { unitLabel: "Form 4 #1", status: "available" },
  });

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  // The tool is the token for the whole panel, so a unit-only edit has to move
  // it — otherwise a second editor's stale token would still match.
  expect(result.revision).not.toBe(before);
  expect(revalidatePath).toHaveBeenCalledWith("/admin/inventory");
});

it("edits the fields the panel offers", async () => {
  await asSuperMaker();
  const unitId = await seedUnit("Form 4 #1");

  const result = await editUnit({
    toolId,
    expectedRevision: await revision(),
    unitId,
    patch: { serialNumber: "FL-0042", condition: "good", dateAcquired: "2025-01-15" },
  });

  expect(result.ok).toBe(true);
  const [row] = await db.select().from(units);
  expect(row.serialNumber).toBe("FL-0042");
  expect(row.condition).toBe("good");
  expect(row.dateAcquired).toBe("2025-01-15");
});

it("refuses a status outside the vocabulary before Postgres sees it", async () => {
  await asSuperMaker();
  const unitId = await seedUnit("Form 4 #1");

  // `units_status_check` would refuse the whole statement with a message no
  // page can render; `invalid_field` is one the panel can put next to the field.
  expect(
    await editUnit({
      toolId,
      expectedRevision: await revision(),
      unitId,
      patch: { status: "on fire" },
    })
  ).toEqual({ ok: false, error: "invalid_field" });
});

it("names a duplicate serial rather than leaking the constraint", async () => {
  await asSuperMaker();
  await seedUnit("Form 4 #1", "FL-0042");
  const second = await seedUnit("Form 4 #2");

  expect(
    await editUnit({
      toolId,
      expectedRevision: await revision(),
      unitId: second,
      patch: { serialNumber: "fl-0042" },
    })
  ).toEqual({ ok: false, error: "duplicate_serial" });
});

it("retires a unit rather than deleting it once it has history", async () => {
  await asSuperMaker();
  const unitId = await seedUnit("Form 4 #1");
  await db.insert(maintenanceLogs).values({
    toolId,
    unitId,
    title: "Tank cloudy",
    status: "open",
  });

  // `maintenance_logs.unit_id` is `on delete set null`, so Postgres would allow
  // the delete and quietly detach the ticket. The refusal is the feature.
  expect(await deleteUnit({ toolId, expectedRevision: await revision(), unitId })).toEqual({
    ok: false,
    error: "unit_has_history",
  });

  expect((await retireUnit({ toolId, expectedRevision: await revision(), unitId })).ok).toBe(true);
  expect((await db.select().from(units))[0].status).toBe("retired");
});

it("deletes a unit that nothing refers to", async () => {
  await asSuperMaker();
  const unitId = await seedUnit("Form 4 #1");

  expect((await deleteUnit({ toolId, expectedRevision: await revision(), unitId })).ok).toBe(true);
  expect(await db.select().from(units)).toEqual([]);
});

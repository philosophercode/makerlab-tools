// @vitest-environment node
import { nextCacheMock } from "../../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());

/**
 * Withhold or grant one permission, to prove the action asks for its own.
 *
 * No role in `permissions.ts` holds `tools.edit` without also holding
 * `maintenance.manage`, so the only way to test "this endpoint checks the
 * permission it needs, not one that happens to travel with it" is to take the
 * declaration out of the picture for one test. Null means the real `can()`, so
 * every other test in this file runs against the genuine article.
 */
const override = vi.hoisted(() => ({ permissions: null as Set<string> | null }));

vi.mock("../../../lib/auth/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/auth/permissions")>();
  return {
    ...actual,
    can: (subject: Parameters<typeof actual.can>[0], permission: string) =>
      override.permissions
        ? override.permissions.has(permission)
        : actual.can(subject, permission as Parameters<typeof actual.can>[1]),
  };
});

import { eq } from "drizzle-orm";
import { resetAuthForTests } from "../../../lib/auth/config";
import { getDb, resetDbForTests } from "../../../lib/db/client";
import { maintenanceLogs, session, tools, units, user } from "../../../lib/db/schema/index";
import type { Db } from "../../../lib/db/types";
import { signInAsNew } from "../../../../test/utils/session";
import { updateTicket } from "./actions";

/**
 * `/admin/maintenance`'s one endpoint (spec §5.6, §8).
 *
 * Called directly, with no page — which is the point: a server action is a POST
 * endpoint with a generated name, reachable by anybody who can read the page
 * source, so the gate is the only thing standing in front of the write. The
 * write itself is covered in `src/lib/data/maintenance.test.ts`; what is under
 * test here is who may call it, and that every refusal comes back as a code the
 * island can render rather than as an exception.
 */

const AUTH_SECRET = "admin-maintenance-test-secret";

let db: Db;
let ticketId: string;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  vi.stubEnv("LAB_TIMEZONE", "America/New_York");
  resetAuthForTests();
  override.permissions = null;

  db = await getDb();
  await db.delete(maintenanceLogs);
  await db.delete(units);
  await db.delete(tools);
  await db.delete(session);
  await db.delete(user);

  const [tool] = await db
    .insert(tools)
    .values({ slug: "trotec", name: "Trotec Speedy 400" })
    .returning({ id: tools.id });
  const [ticket] = await db
    .insert(maintenanceLogs)
    .values({
      title: "Laser bed out of focus",
      status: "open",
      priority: "high",
      toolId: tool.id,
      reportedByName: "Casey",
    })
    .returning({ id: maintenanceLogs.id });
  ticketId = ticket.id;
});

afterEach(() => {
  override.permissions = null;
  resetAuthForTests();
  resetDbForTests();
});

async function storedTicket() {
  const [row] = await db.select().from(maintenanceLogs).where(eq(maintenanceLogs.id, ticketId));
  return row;
}

async function asSuperMaker(email = "niti@cornell.edu") {
  const signedIn = await signInAsNew({ email, role: "admin" });
  setMockHeaders({ cookie: signedIn.cookie });
  return signedIn;
}

it("refuses an anonymous caller, and changes nothing", async () => {
  setMockHeaders();

  expect(await updateTicket({ logId: ticketId, patch: { status: "resolved" } })).toEqual({
    ok: false,
    error: "not_signed_in",
  });
  expect((await storedTicket()).status).toBe("open");
});

it("refuses a student, who may file a ticket but not work one", async () => {
  const student = await signInAsNew({ email: "casey@cornell.edu", role: "user" });
  setMockHeaders({ cookie: student.cookie });

  expect(await updateTicket({ logId: ticketId, patch: { status: "closed" } })).toEqual({
    ok: false,
    error: "not_permitted",
  });
  expect((await storedTicket()).status).toBe("open");
});

it("checks maintenance.manage, not a permission that happens to travel with it", async () => {
  await asSuperMaker();

  // Somebody who may edit the catalogue but was never given the tickets.
  override.permissions = new Set(["tools.edit", "tools.publish"]);
  expect(await updateTicket({ logId: ticketId, patch: { status: "resolved" } })).toEqual({
    ok: false,
    error: "not_permitted",
  });

  override.permissions = new Set(["maintenance.manage"]);
  expect(await updateTicket({ logId: ticketId, patch: { status: "resolved" } })).toEqual({
    ok: true,
  });
});

it("moves a ticket, stamps who moved it and refreshes the queue", async () => {
  const signedIn = await asSuperMaker();
  const { revalidatePath } = await import("next/cache");

  expect(await updateTicket({ logId: ticketId, patch: { status: "in_progress" } })).toEqual({
    ok: true,
  });

  const row = await storedTicket();
  expect(row.status).toBe("in_progress");
  expect(row.updatedBy).toBe(signedIn.user.id);
  expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/admin/maintenance");
});

it("assigns a ticket, keeping the name beside the id", async () => {
  await asSuperMaker();
  const assignee = await signInAsNew({ email: "luis@cornell.edu", role: "admin" });

  expect(
    await updateTicket({
      logId: ticketId,
      patch: { assignedToUserId: assignee.user.id, assignedToName: "Luis" },
    })
  ).toEqual({ ok: true });

  const row = await storedTicket();
  expect(row.assignedToUserId).toBe(assignee.user.id);
  expect(row.assignedToName).toBe("Luis");
});

it("passes the write layer's refusals through as codes, not exceptions", async () => {
  await asSuperMaker();

  expect(await updateTicket({ logId: ticketId, patch: { status: "spicy" } })).toEqual({
    ok: false,
    error: "invalid_field",
  });
  expect(await updateTicket({ logId: crypto.randomUUID(), patch: { status: "open" } })).toEqual({
    ok: false,
    error: "not_found",
  });
  // Still open: a refused write is a write that did not happen.
  expect((await storedTicket()).status).toBe("open");
});

it("refuses once the caller is over the ceiling, without touching the row", async () => {
  await asSuperMaker();

  // `ADMIN_ACTION_TIER` is 120 a minute per person (§8). The 121st is refused
  // — and the limiter runs before the permission check, so an anonymous
  // prodder spends their own key rather than finding that refusals are free.
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await updateTicket({ logId: ticketId, patch: { status: "open" } });
  }

  expect(await updateTicket({ logId: ticketId, patch: { status: "closed" } })).toEqual({
    ok: false,
    error: "rate_limited",
  });
  expect((await storedTicket()).status).toBe("open");
});

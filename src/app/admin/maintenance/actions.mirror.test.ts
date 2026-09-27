// @vitest-environment node
import { nextCacheMock } from "../../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());

// The trigger has its own tests; here it is only asked whether it was called.
const mirror = vi.hoisted(() => ({ requestMirrorPush: vi.fn() }));

vi.mock("../../../lib/mirror/trigger", () => ({ requestMirrorPush: mirror.requestMirrorPush }));

import { resetAuthForTests } from "../../../lib/auth/config";
import { getDb, resetDbForTests } from "../../../lib/db/client";
import { maintenanceLogs, session, tools, units, user } from "../../../lib/db/schema/index";
import { signInAsNew } from "../../../../test/utils/session";
import { updateTicket } from "./actions";

/**
 * Working a ticket is a mirror trigger (spec §3.8): the mirror carries every
 * maintenance log, so a status, priority, assignee or resolution is a change it
 * should hold. A refused write changes nothing and asks for nothing, and a
 * trigger that fails never turns a landed write into a failure.
 */

const AUTH_SECRET = "admin-maintenance-mirror-test-secret";

let ticketId: string;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  vi.stubEnv("LAB_TIMEZONE", "America/New_York");
  resetAuthForTests();
  mirror.requestMirrorPush.mockReset().mockResolvedValue(undefined);

  const db = await getDb();
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
    .values({ title: "Laser bed out of focus", status: "open", priority: "high", toolId: tool.id })
    .returning({ id: maintenanceLogs.id });
  ticketId = ticket.id;
});

afterEach(() => {
  resetAuthForTests();
  resetDbForTests();
});

it("requests a push after a ticket changes", async () => {
  const admin = await signInAsNew({ email: "niti@cornell.edu", role: "admin" });
  setMockHeaders({ cookie: admin.cookie });

  expect(await updateTicket({ logId: ticketId, patch: { status: "resolved" } })).toEqual({ ok: true });
  expect(mirror.requestMirrorPush).toHaveBeenCalledTimes(1);
});

it("requests nothing when the caller is refused", async () => {
  const student = await signInAsNew({ email: "casey@cornell.edu", role: "user" });
  setMockHeaders({ cookie: student.cookie });

  expect(await updateTicket({ logId: ticketId, patch: { status: "closed" } })).toEqual({
    ok: false,
    error: "not_permitted",
  });
  expect(mirror.requestMirrorPush).not.toHaveBeenCalled();
});

it("requests nothing when the ticket does not exist", async () => {
  const admin = await signInAsNew({ email: "niti@cornell.edu", role: "admin" });
  setMockHeaders({ cookie: admin.cookie });

  const result = await updateTicket({ logId: crypto.randomUUID(), patch: { status: "resolved" } });

  expect(result.ok).toBe(false);
  expect(mirror.requestMirrorPush).not.toHaveBeenCalled();
});

import { eq, inArray } from "drizzle-orm";
import { start } from "workflow/api";
import { server } from "../../test/msw/server";
import { useResendFake } from "../../test/msw/resend";
import { createMaintenanceLog } from "../lib/data/maintenance";
import { createSchedules } from "../lib/data/maintenance-schedules";
import { getDb, resetDbForTests } from "../lib/db/client";
import { DEMO_ACCOUNTS } from "../lib/db/demo-seed";
import { maintenanceSchedules, notificationDeliveries, notifications, tools, user } from "../lib/db/schema/index";
import { deliverNotification, maintenanceReminder } from "./notifications";

/**
 * The notification workflows in process (email notifications spec §10,
 * workflow tier): the real workflow runtime and step bundle, the seeded
 * PGlite database, and the Resend fake answering through MSW, which reaches
 * step code where `vi.mock` does not. No network and no real credential.
 *
 * The step bundle has its own copy of `db/client.ts`, which keeps its handle
 * on `globalThis`, so calling `getDb()` here first means the steps find this
 * same database.
 */

const SECRET = "notifications-workflow-secret-0123456789";

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  await getDb();
});

afterAll(() => {
  resetDbForTests();
});

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("RESEND_API_KEY", "re_workflow_test");
  vi.stubEnv("EMAIL_FROM", "notify@notify.lab.example");
  vi.stubEnv("AUTH_SECRET", SECRET);
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://makerlab.example");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("NOTIFY_TICKET_HOURLY_CAP", "");
  const db = await getDb();
  await db.delete(notifications);
  await db.delete(maintenanceSchedules);
});

/** The demo accounts that may work tickets, as the database has them. */
async function staffAddresses(): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .select({ email: user.email })
    .from(user)
    .where(inArray(user.role, ["admin", "super_admin"]));
  return rows.map((row) => row.email).sort();
}

async function fileTicket(): Promise<string> {
  const created = await createMaintenanceLog({
    title: "Laser not firing",
    description: "The head moves but there is no beam.",
    type: "Issue Report",
    priority: "High",
    status: "Open",
    reportedByName: DEMO_ACCOUNTS.user.name,
    reportedByEmail: DEMO_ACCOUNTS.user.email,
    reportedByUserId: DEMO_ACCOUNTS.user.id,
    surface: "chat",
  });
  if (!created.notificationId) throw new Error("no notification was queued");
  return created.notificationId;
}

describe("deliverNotification (in process)", () => {
  it("emails every staff member once, with distinct idempotency keys, and a second run sends nothing", { timeout: 120_000 }, async () => {
    const fake = useResendFake(server);
    const notificationId = await fileTicket();
    const staff = await staffAddresses();
    expect(staff).toContain(DEMO_ACCOUNTS.admin.email);
    expect(staff).not.toContain(DEMO_ACCOUNTS.user.email);

    const first = await (await start(deliverNotification, [notificationId])).returnValue;
    expect(first.outcomes).toEqual(staff.map(() => "sent"));
    expect(fake.requests.map((r) => r.body.to?.[0]).sort()).toEqual(staff);
    expect(new Set(fake.requests.map((r) => r.headers["idempotency-key"])).size).toBe(staff.length);

    const second = await (await start(deliverNotification, [notificationId])).returnValue;
    expect(second.outcomes).toEqual([]);
    expect(fake.requests).toHaveLength(staff.length);
  });

  it("retries a 503 through the SDK and records the send on the second attempt", { timeout: 120_000 }, async () => {
    const fake = useResendFake(server);
    fake.script(503);
    const notificationId = await fileTicket();

    const summary = await (await start(deliverNotification, [notificationId])).returnValue;
    expect(summary.outcomes.every((outcome) => outcome === "sent")).toBe(true);

    const db = await getDb();
    const rows = await db.select().from(notificationDeliveries).where(eq(notificationDeliveries.notificationId, notificationId));
    // The first send met the 503 and went twice; everyone else's went once.
    expect(rows.map((row) => row.attempts).sort()).toEqual([...Array(rows.length - 1).fill(1), 2]);
    expect(rows.every((row) => row.status === "sent")).toBe(true);
    expect(fake.delivered()).toHaveLength(rows.length);
  });
});

describe("maintenanceReminder (in process)", () => {
  it("queues the day's reminder once and emails staff what came due; a second run sends nothing", { timeout: 120_000 }, async () => {
    const fake = useResendFake(server);
    const db = await getDb();
    const [tool] = await db.select({ id: tools.id }).from(tools).limit(1);
    // Due long ago, so it is overdue whatever today is in the lab.
    await createSchedules(
      [{ toolId: tool.id, unitId: null, title: "Clean the lens", instructions: null, interval: { count: 1, unit: "week" }, firstDueOn: "2026-01-05" }],
      { userId: DEMO_ACCOUNTS.admin.id, name: DEMO_ACCOUNTS.admin.name }
    );

    // Hour 0: midnight has passed, so the run does not wait for 08:00.
    const first = await (await start(maintenanceReminder, [0])).returnValue;
    expect(first.queued).toBe(true);
    const staff = await staffAddresses();
    expect(fake.requests.map((r) => r.body.to?.[0]).sort()).toEqual(staff);
    expect(fake.requests[0].body.subject).toMatch(/^Shift checklist: 1 recurring task came due$/);

    // The task was named for its due date, so the next run has nothing new.
    const second = await (await start(maintenanceReminder, [0])).returnValue;
    expect(second).toMatchObject({ queued: false, reason: "nothing_due" });
    expect(fake.requests).toHaveLength(staff.length);
  });

  it("sends nothing when nothing is due", { timeout: 120_000 }, async () => {
    const fake = useResendFake(server);
    const summary = await (await start(maintenanceReminder, [0])).returnValue;
    expect(summary).toMatchObject({ queued: false, reason: "nothing_due" });
    expect(fake.requests).toHaveLength(0);
  });
});

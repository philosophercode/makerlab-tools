// @vitest-environment node

/**
 * The daily cron's notification stage against PGlite (email notifications
 * spec §3.6, §10 integration; reminder amendment 2026-10-07): stuck sends
 * given up, a `queued` row restarted once and never twice, old rows deleted,
 * and the reminder started (configured) or recorded in process (offline).
 * `start.ts` is mocked: starting a run is the workflow tier's business.
 */

const starter = vi.hoisted(() => ({
  startNotificationDelivery: vi.fn(async (_id: string) => true),
  startMaintenanceReminder: vi.fn(async () => true),
}));
vi.mock("../notifications/start", () => starter);

import { eq, sql } from "drizzle-orm";
import { insertUserRow } from "../../../test/utils/session";
import { createSchedules } from "../data/maintenance-schedules";
import { createPgliteDb } from "../db/pglite";
import { maintenanceSchedules, notificationDeliveries, notifications, tools, user } from "../db/schema/index";
import type { Db } from "../db/types";
import { runNotificationStage } from "./notifications";

const TODAY = "2026-10-07";
let db: Db;
let toolId: string;

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  starter.startNotificationDelivery.mockReset().mockResolvedValue(true);
  starter.startMaintenanceReminder.mockReset().mockResolvedValue(true);
  await db.delete(notifications);
  await db.delete(maintenanceSchedules);
  await db.delete(tools);
  await db.delete(user);
  await insertUserRow(db, { id: "u-niti", email: "niti@cornell.edu", name: "Niti Parikh", role: "admin" });
  const [tool] = await db.insert(tools).values({ slug: "trotec", name: "Trotec Speedy 400", published: true }).returning({ id: tools.id });
  toolId = tool.id;
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("EMAIL_FROM", "");
  vi.stubEnv("AUTH_SECRET", "cron-notifications-secret-0123456789");
});

function configure() {
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  vi.stubEnv("EMAIL_FROM", "notify@notify.lab.example");
}

/** An outbox row as if written `ageMinutes` ago. */
async function outboxRow(ageMinutes: number, status = "queued", dedupe = crypto.randomUUID()): Promise<string> {
  const [row] = await db
    .insert(notifications)
    .values({ event: "ticket.filed", subjectType: "maintenance_log", subjectId: crypto.randomUUID(), dedupeKey: `ticket.filed:${dedupe}`, status })
    .returning({ id: notifications.id });
  await db.execute(sql`update notifications set created_at = now() - make_interval(mins => ${ageMinutes}) where id = ${row.id}::uuid`);
  return row.id;
}

async function delivery(notificationId: string, ageMinutes: number, status = "pending"): Promise<string> {
  const [row] = await db.insert(notificationDeliveries).values({ notificationId, userId: "u-niti", status }).returning({ id: notificationDeliveries.id });
  await db.execute(sql`update notification_deliveries set created_at = now() - make_interval(mins => ${ageMinutes}) where id = ${row.id}::uuid`);
  return row.id;
}

describe("runNotificationStage", () => {
  it("restarts a queued row whose run never started, once and never twice", async () => {
    configure();
    const stale = await outboxRow(30);
    await outboxRow(5); // still inside the 15 minutes the trigger is given

    const first = await runNotificationStage({ db, today: TODAY });
    expect(first.restarted).toBe(1);
    expect(starter.startNotificationDelivery).toHaveBeenCalledTimes(1);
    expect(starter.startNotificationDelivery).toHaveBeenCalledWith(stale);

    const second = await runNotificationStage({ db, today: TODAY });
    expect(second.restarted).toBe(0);
    expect(starter.startNotificationDelivery).toHaveBeenCalledTimes(1);
  });

  it("restarts a row with a send left pending over an hour, and gives up on one past 20 hours", async () => {
    configure();
    const retry = await outboxRow(120, "fanned_out");
    await delivery(retry, 90);
    const old = await outboxRow(24 * 60, "fanned_out");
    const stuck = await delivery(old, 21 * 60, "sending");

    const result = await runNotificationStage({ db, today: TODAY });
    expect(result.stuck).toBe(1);
    expect(starter.startNotificationDelivery.mock.calls.map(([id]) => id)).toEqual([retry]);
    const [row] = await db.select().from(notificationDeliveries).where(eq(notificationDeliveries.id, stuck));
    expect(row).toMatchObject({ status: "failed", reason: "stuck" });
  });

  it("deletes rows older than 180 days, their deliveries with them", async () => {
    const old = await outboxRow(181 * 24 * 60, "done");
    await delivery(old, 181 * 24 * 60, "sent");
    const recent = await outboxRow(60 * 24, "done");

    const result = await runNotificationStage({ db, today: TODAY });
    expect(result.deleted).toBe(1);
    expect((await db.select({ id: notifications.id }).from(notifications)).map((r) => r.id)).toEqual([recent]);
    expect(await db.select().from(notificationDeliveries)).toHaveLength(0);
  });

  it("starts the maintenance reminder when email is configured, and fails the stage when it cannot", async () => {
    configure();
    expect((await runNotificationStage({ db, today: TODAY })).reminder).toBe("started");
    starter.startMaintenanceReminder.mockResolvedValue(false);
    const failed = await runNotificationStage({ db, today: TODAY });
    expect(failed).toMatchObject({ reminder: "failed", failed: 1 });
  });

  it("offline, records the reminder in process when something is due, and nothing when nothing is", async () => {
    expect((await runNotificationStage({ db, today: TODAY })).reminder).toBe("nothing_due");
    await createSchedules(
      [{ toolId, unitId: null, title: "Clean the lens", instructions: null, interval: { count: 1, unit: "week" }, firstDueOn: TODAY }],
      { userId: "u-niti", name: "Niti Parikh" },
      { db }
    );
    expect((await runNotificationStage({ db, today: TODAY })).reminder).toBe("recorded");
    const deliveries = await db.select().from(notificationDeliveries);
    expect(deliveries).toEqual([expect.objectContaining({ userId: "u-niti", status: "failed", reason: "not_configured" })]);
    expect((await runNotificationStage({ db, today: TODAY })).reminder).toBe("already_queued");
    expect(starter.startMaintenanceReminder).not.toHaveBeenCalled();
  });
});

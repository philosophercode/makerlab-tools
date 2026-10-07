// @vitest-environment node
import { eq, sql } from "drizzle-orm";
import { server } from "../../../test/msw/server";
import { useResendFake } from "../../../test/msw/resend";
import { insertUserRow } from "../../../test/utils/session";
import { createMaintenanceLog, logCompletedMaintenance } from "../data/maintenance";
import { completeSchedule, createSchedules } from "../data/maintenance-schedules";
import { createPgliteDb } from "../db/pglite";
import { rawRows } from "../db/raw";
import {
  auditEvents,
  maintenanceLogs,
  maintenanceReminderItems,
  maintenanceSchedules,
  notificationDeliveries,
  notificationPreferences,
  notifications,
  tools,
  units,
  user,
} from "../db/schema/index";
import type { Db } from "../db/types";
import { deliverInline, fanOutNotification, finishNotification, MAX_SEND_ATTEMPTS, sendDelivery } from "./deliver";
import { setEventOff } from "./preferences";
import { enqueueMaintenanceReminder } from "./reminder";
import { verifyUnsubscribeToken } from "./unsubscribe";

/**
 * Delivering a notification against a real (in-process) Postgres and the
 * MSW Resend fake (email notifications spec §10, integration tier): who gets
 * it, exactly once each, what happens offline, and what the provider's
 * failures turn into. The workflow wrapper around these functions is
 * `src/workflows/notifications.workflow.test.ts`.
 */

const SECRET = "deliver-test-secret-0123456789abcdef";
const ORIGIN = "https://makerlab.example";
const TODAY = "2026-10-07";

let db: Db;
let toolId: string;
let unitId: string;

const STAFF = {
  niti: { id: "u-niti", email: "niti@cornell.edu", name: "Niti Parikh", role: "admin" as const },
  isaac: { id: "u-isaac", email: "isaac@cornell.edu", name: "Isaac Steinberg", role: "super_admin" as const },
  casey: { id: "u-casey", email: "casey@cornell.edu", name: "Casey Rivera", role: "user" as const },
  banned: { id: "u-banned", email: "banned@cornell.edu", name: "Former Staff", role: "admin" as const, banned: true },
};
const ADDRESSES = Object.values(STAFF).map((person) => person.email);

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  await db.delete(notifications);
  await db.delete(notificationPreferences);
  await db.delete(maintenanceSchedules);
  await db.delete(maintenanceLogs);
  await db.delete(auditEvents);
  await db.delete(tools);
  await db.delete(user);
  for (const person of Object.values(STAFF)) await insertUserRow(db, person);
  const [tool] = await db.insert(tools).values({ slug: "trotec", name: "Trotec Speedy 400", published: true }).returning({ id: tools.id });
  const [unit] = await db.insert(units).values({ toolId: tool.id, unitLabel: "Speedy #2" }).returning({ id: units.id });
  toolId = tool.id;
  unitId = unit.id;
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("EMAIL_FROM", "");
  vi.stubEnv("AUTH_SECRET", SECRET);
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", ORIGIN);
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("EMAIL_PREVIEW_RECIPIENTS", "");
  vi.stubEnv("NOTIFY_TICKET_HOURLY_CAP", "");
  vi.stubEnv("LAB_TIMEZONE", "America/New_York");
});

function configure() {
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  vi.stubEnv("EMAIL_FROM", "notify@notify.lab.example");
}

async function fileTicket(overrides: { surface?: "chat" | "mcp"; reporter?: string | null } = {}) {
  const created = await createMaintenanceLog(
    {
      title: "Laser not firing",
      description: "Pressed start, the head moves but no beam.",
      type: "Issue Report",
      priority: "High",
      status: "Open",
      unitId,
      reportedByName: overrides.reporter === undefined ? STAFF.casey.name : overrides.reporter,
      reportedByEmail: overrides.reporter === null ? null : STAFF.casey.email,
      reportedByUserId: overrides.reporter === null ? null : STAFF.casey.id,
      surface: overrides.surface ?? "chat",
    },
    { db }
  );
  if (!created.notificationId) throw new Error("no notification was queued");
  return created as typeof created & { notificationId: string };
}

async function deliveries(notificationId: string) {
  return db
    .select({ id: notificationDeliveries.id, userId: notificationDeliveries.userId, status: notificationDeliveries.status, reason: notificationDeliveries.reason, attempts: notificationDeliveries.attempts })
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.notificationId, notificationId))
    .orderBy(notificationDeliveries.userId);
}

async function outbox(id: string) {
  const [row] = await db.select().from(notifications).where(eq(notifications.id, id));
  return row;
}

/** Fan out and send each delivery once, as one workflow run would without retries. */
async function runOnce(notificationId: string) {
  const ids = await fanOutNotification(notificationId, { db });
  const outcomes = [];
  for (const id of ids) outcomes.push(await sendDelivery(id, { db }));
  await finishNotification(notificationId, { db });
  return outcomes;
}

describe("the outbox row a ticket writes", () => {
  it("is one queued ticket.filed row per ticket, with the surface it came from", async () => {
    const created = await fileTicket({ surface: "mcp" });
    const rows = await db.select().from(notifications);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: created.notificationId,
      event: "ticket.filed",
      subjectType: "maintenance_log",
      subjectId: created.id,
      dedupeKey: `ticket.filed:${created.id}`,
      surface: "mcp",
      status: "queued",
    });
  });

  it("rolls the ticket back when the outbox cannot be written", async () => {
    await db.execute(sql`alter table notifications rename to notifications_away`);
    try {
      await expect(fileTicket()).rejects.toThrow();
    } finally {
      await db.execute(sql`alter table notifications_away rename to notifications`);
    }
    expect(await db.select().from(maintenanceLogs)).toHaveLength(0);
  });

  it("is not written for work staff record as already done", async () => {
    await logCompletedMaintenance(
      {
        toolId,
        toolName: "Trotec Speedy 400",
        unitId,
        unitLabel: "Speedy #2",
        title: "Replaced the lens",
        resolution: "New lens fitted",
        type: "repair",
        actor: { userId: STAFF.niti.id, name: STAFF.niti.name },
      },
      { db }
    );
    expect(await db.select().from(notifications)).toHaveLength(0);
  });
});

describe("with email not configured (offline)", () => {
  it("records every staff delivery as not_configured, reaches no network, and finishes", async () => {
    const created = await fileTicket();
    // MSW refuses any unhandled request, so a fetch here would fail the test.
    await deliverInline(created.notificationId, { db });

    const rows = await deliveries(created.notificationId);
    expect(rows.map((row) => row.userId).sort()).toEqual([STAFF.isaac.id, STAFF.niti.id]);
    for (const row of rows) expect(row).toMatchObject({ status: "failed", reason: "not_configured" });
    expect((await outbox(created.notificationId)).status).toBe("done");
  });
});

describe("with email configured", () => {
  it("emails each maintenance.manage holder once, never a user or a banned account", async () => {
    configure();
    const fake = useResendFake(server);
    const created = await fileTicket();

    const outcomes = await runOnce(created.notificationId);

    expect(outcomes).toEqual([{ state: "sent" }, { state: "sent" }]);
    expect(fake.requests.map((r) => r.body.to?.[0]).sort()).toEqual([STAFF.isaac.email, STAFF.niti.email]);
    const rows = await deliveries(created.notificationId);
    // The idempotency key is the delivery id: distinct per person.
    expect(fake.requests.map((r) => r.headers["idempotency-key"]).sort()).toEqual(rows.map((row) => row.id).sort());
    for (const row of rows) expect(row).toMatchObject({ status: "sent", attempts: 1 });
    expect((await outbox(created.notificationId)).status).toBe("done");
  });

  it("puts a working one-click unsubscribe on every email, signed for that person", async () => {
    configure();
    const fake = useResendFake(server);
    const created = await fileTicket();
    await runOnce(created.notificationId);

    for (const request of fake.requests) {
      expect(request.body.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
      const link = request.body.headers?.["List-Unsubscribe"] ?? "";
      expect(link).toMatch(new RegExp(`^<${ORIGIN}/api/notifications/unsubscribe\\?t=`));
      const token = new URL(link.slice(1, -1)).searchParams.get("t");
      const claim = verifyUnsubscribeToken(token, SECRET);
      const person = Object.values(STAFF).find((p) => p.email === request.body.to?.[0]);
      expect(claim).toMatchObject({ userId: person?.id, event: "ticket.filed" });
      expect(request.body.subject).toBe("New ticket on Trotec Speedy 400: Laser not firing (High)");
      expect(request.body.text).toContain(`${ORIGIN}/admin/maintenance#ticket-${created.id}`);
    }
  });

  it("sends nothing new when the same notification is delivered again", async () => {
    configure();
    const fake = useResendFake(server);
    const created = await fileTicket();
    await runOnce(created.notificationId);
    await runOnce(created.notificationId);
    expect(fake.requests).toHaveLength(2);
  });

  it("converges on one email when a send is replayed after the provider's 200 but before our write", async () => {
    configure();
    const fake = useResendFake(server);
    const created = await fileTicket();
    const [first] = await fanOutNotification(created.notificationId, { db });
    await sendDelivery(first, { db });
    // As if the process died before `sent` was written.
    await db.update(notificationDeliveries).set({ status: "sending" }).where(eq(notificationDeliveries.id, first));
    await sendDelivery(first, { db });

    expect(fake.requests).toHaveLength(2);
    expect(fake.delivered()).toHaveLength(1);
  });

  it("retries a 503 and records sent on the second attempt", async () => {
    configure();
    const fake = useResendFake(server);
    fake.script(503);
    const created = await fileTicket();
    const [first] = await fanOutNotification(created.notificationId, { db });

    expect(await sendDelivery(first, { db })).toEqual({ state: "retry", attempts: 1 });
    expect(await sendDelivery(first, { db })).toEqual({ state: "sent" });
    const [row] = (await deliveries(created.notificationId)).filter((d) => d.id === first);
    expect(row).toMatchObject({ status: "sent", attempts: 2 });
  });

  it(`gives up as provider_error after ${MAX_SEND_ATTEMPTS} retryable failures`, async () => {
    configure();
    const fake = useResendFake(server);
    fake.script(...Array.from({ length: MAX_SEND_ATTEMPTS }, () => 503));
    const created = await fileTicket();
    const [first] = await fanOutNotification(created.notificationId, { db });
    for (let i = 1; i < MAX_SEND_ATTEMPTS; i += 1) expect((await sendDelivery(first, { db })).state).toBe("retry");
    expect(await sendDelivery(first, { db })).toEqual({ state: "failed", reason: "provider_error" });
    expect(await sendDelivery(first, { db })).toEqual({ state: "not_claimed" });
  });

  it("fails a 422 as invalid_recipient and never retries it", async () => {
    configure();
    const fake = useResendFake(server);
    fake.script(422);
    const created = await fileTicket();
    const [first] = await fanOutNotification(created.notificationId, { db });
    expect(await sendDelivery(first, { db })).toEqual({ state: "failed", reason: "invalid_recipient" });
    expect(await sendDelivery(first, { db })).toEqual({ state: "not_claimed" });
    expect(fake.requests).toHaveLength(1);
  });

  it("sends nothing about a ticket resolved before the run reached it", async () => {
    configure();
    const fake = useResendFake(server);
    const created = await fileTicket();
    await db.update(maintenanceLogs).set({ status: "resolved" }).where(eq(maintenanceLogs.id, created.id));

    expect(await fanOutNotification(created.notificationId, { db })).toEqual([]);
    expect(await outbox(created.notificationId)).toMatchObject({ status: "skipped", skipReason: "subject_gone" });
    expect(fake.requests).toHaveLength(0);
  });

  it("skips a send whose ticket was resolved between the fan-out and the send", async () => {
    configure();
    const fake = useResendFake(server);
    const created = await fileTicket();
    const ids = await fanOutNotification(created.notificationId, { db });
    await db.update(maintenanceLogs).set({ status: "closed" }).where(eq(maintenanceLogs.id, created.id));
    expect(await sendDelivery(ids[0], { db })).toEqual({ state: "skipped", reason: "subject_gone" });
    expect(fake.requests).toHaveLength(0);
  });

  it("leaves out someone who turned the email off, and skips someone who did so mid-run", async () => {
    configure();
    const fake = useResendFake(server);
    await setEventOff(db, STAFF.niti.id, "ticket.filed");
    const created = await fileTicket();
    const ids = await fanOutNotification(created.notificationId, { db });
    expect((await deliveries(created.notificationId)).map((d) => d.userId)).toEqual([STAFF.isaac.id]);

    await setEventOff(db, STAFF.isaac.id, "ticket.filed");
    expect(await sendDelivery(ids[0], { db })).toEqual({ state: "skipped", reason: "pref_off" });
    expect(fake.requests).toHaveLength(0);
  });

  it("skips someone demoted between the fan-out and the send", async () => {
    configure();
    useResendFake(server);
    const created = await fileTicket();
    await fanOutNotification(created.notificationId, { db });
    await db.update(user).set({ role: "user" }).where(eq(user.id, STAFF.niti.id));
    const niti = (await deliveries(created.notificationId)).find((d) => d.userId === STAFF.niti.id)!;
    expect(await sendDelivery(niti.id, { db })).toEqual({ state: "skipped", reason: "no_permission" });
  });

  it("mails nobody from a preview without an allow-list, and only the listed people with one", async () => {
    configure();
    vi.stubEnv("VERCEL_ENV", "preview");
    const fake = useResendFake(server);
    const first = await fileTicket();
    await runOnce(first.notificationId);
    expect(fake.requests).toHaveLength(0);
    for (const row of await deliveries(first.notificationId)) expect(row).toMatchObject({ status: "skipped", reason: "preview_blocked" });

    vi.stubEnv("EMAIL_PREVIEW_RECIPIENTS", "Isaac@Cornell.edu");
    const second = await fileTicket();
    await runOnce(second.notificationId);
    expect(fake.requests.map((r) => r.body.to?.[0])).toEqual([STAFF.isaac.email]);
  });

  it("fans out at most NOTIFY_TICKET_HOURLY_CAP tickets an hour, and skips the rest as capped", async () => {
    configure();
    vi.stubEnv("NOTIFY_TICKET_HOURLY_CAP", "1");
    const fake = useResendFake(server);
    const first = await fileTicket();
    await runOnce(first.notificationId);
    const second = await fileTicket();
    await runOnce(second.notificationId);

    expect(await outbox(second.notificationId)).toMatchObject({ status: "skipped", skipReason: "capped" });
    expect(fake.requests).toHaveLength(2);
  });

  it("leaves no address in any notification table, the audit trail or the log", async () => {
    configure();
    useResendFake(server);
    const printed: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        printed.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
      });
    }
    const created = await fileTicket();
    await runOnce(created.notificationId);
    await setEventOff(db, STAFF.niti.id, "ticket.filed");

    const dump = JSON.stringify([
      await rawRows(db, sql`select * from notifications`),
      await rawRows(db, sql`select * from notification_deliveries`),
      await rawRows(db, sql`select * from notification_preferences`),
      await rawRows(db, sql`select * from audit_events`),
    ]);
    for (const address of ADDRESSES) {
      expect(dump).not.toContain(address);
      expect(printed.join("\n")).not.toContain(address);
    }
  });
});

describe("the maintenance reminder (each task's cadence)", () => {
  const TOMORROW = "2026-10-08";

  async function schedule(title: string, firstDueOn: string, interval: { count: number; unit: "day" | "week" } = { count: 1, unit: "week" }) {
    const [id] = await createSchedules(
      [{ toolId, unitId: null, title, instructions: null, interval, firstDueOn }],
      { userId: STAFF.niti.id, name: STAFF.niti.name },
      { db }
    );
    return id;
  }

  async function remind(labDate: string) {
    const queued = await enqueueMaintenanceReminder(labDate, { db });
    if (queued.queued) await runOnce(queued.id);
    return queued;
  }

  it("queues nothing when nothing is due today or overdue", async () => {
    await schedule("Next week's task", "2026-10-12");
    expect(await enqueueMaintenanceReminder(TODAY, { db })).toEqual({ queued: false, reason: "nothing_due" });
    expect(await db.select().from(notifications)).toHaveLength(0);
    expect(await db.select().from(maintenanceReminderItems)).toHaveLength(0);
  });

  it("emails staff once about the tasks that came due, today's first, and records each task's due date", async () => {
    configure();
    const fake = useResendFake(server);
    await schedule("Clean the lens", "2026-10-04");
    await schedule("Empty the dust bin", TODAY);
    await schedule("Next week's task", "2026-10-12");

    const queued = await enqueueMaintenanceReminder(TODAY, { db });
    expect(queued).toMatchObject({ queued: true, tasks: 2 });
    expect(await enqueueMaintenanceReminder(TODAY, { db })).toEqual({ queued: false, reason: "nothing_due" });
    if (!queued.queued) throw new Error("unreachable");

    await runOnce(queued.id);
    expect(fake.requests.map((r) => r.body.to?.[0]).sort()).toEqual([STAFF.isaac.email, STAFF.niti.email]);
    const [email] = fake.requests;
    expect(email.body.subject).toBe("Shift checklist: 2 recurring tasks came due");
    expect(email.body.text).toContain("Due today (1)");
    expect(email.body.text).toContain("Empty the dust bin");
    expect(email.body.text).toContain("Came due earlier (1)");
    expect(email.body.text).toContain("Clean the lens · Trotec Speedy 400 · 3 days overdue");
    expect(email.body.text).not.toContain("Next week's task");
    expect(email.body.text).toContain(`${ORIGIN}/admin/maintenance#due-tasks`);
    expect(verifyUnsubscribeToken(new URL((email.body.headers?.["List-Unsubscribe"] ?? "").slice(1, -1)).searchParams.get("t"), SECRET)?.event).toBe(
      "maintenance.due"
    );
    const items = await db.select().from(maintenanceReminderItems);
    expect(items.map((item) => item.dueOn).sort()).toEqual(["2026-10-04", TODAY]);
    expect(items.every((item) => item.notificationId === queued.id)).toBe(true);
  });

  it("does not email a task again while it stays overdue, and emails only what came due the next day", async () => {
    configure();
    const fake = useResendFake(server);
    await schedule("Clean the lens", TODAY);
    expect(await remind(TODAY)).toMatchObject({ queued: true, tasks: 1 });
    const sentToday = fake.requests.length;

    // Still overdue tomorrow, and nothing else came due: no email.
    expect(await remind(TOMORROW)).toEqual({ queued: false, reason: "nothing_due" });
    expect(fake.requests).toHaveLength(sentToday);

    // A task that comes due tomorrow is emailed alone; the overdue lens is not named again.
    await schedule("Empty the dust bin", TOMORROW);
    expect(await remind(TOMORROW)).toMatchObject({ queued: true, tasks: 1 });
    const tomorrow = fake.requests.slice(sentToday);
    expect(tomorrow[0].body.subject).toBe("Shift checklist: 1 recurring task came due");
    expect(tomorrow[0].body.text).toContain("Empty the dust bin");
    expect(tomorrow[0].body.text).not.toContain("Clean the lens");
  });

  it("emails a task again when its next due date arrives after it was checked off", async () => {
    configure();
    const fake = useResendFake(server);
    const id = await schedule("Wipe the benches", TODAY, { count: 1, unit: "day" });
    expect(await remind(TODAY)).toMatchObject({ queued: true, tasks: 1 });
    const done = await completeSchedule(
      { id, note: null, expectedDueOn: TODAY, today: TODAY, actor: { userId: STAFF.niti.id, name: STAFF.niti.name } },
      { db }
    );
    expect(done).toMatchObject({ ok: true });

    expect(await remind(TOMORROW)).toMatchObject({ queued: true, tasks: 1 });
    expect(fake.requests.at(-1)?.body.text).toContain("Wipe the benches");
  });

  it("leaves out a task checked off before the email went, and skips an email left with nothing", async () => {
    configure();
    const fake = useResendFake(server);
    const id = await schedule("Wipe the benches", TODAY, { count: 1, unit: "day" });
    const queued = await enqueueMaintenanceReminder(TODAY, { db });
    if (!queued.queued) throw new Error("expected a reminder");
    await completeSchedule(
      { id, note: null, expectedDueOn: TODAY, today: TODAY, actor: { userId: STAFF.niti.id, name: STAFF.niti.name } },
      { db }
    );
    await runOnce(queued.id);
    expect(fake.requests).toHaveLength(0);
    const [row] = await db.select().from(notifications).where(eq(notifications.id, queued.id));
    expect(row).toMatchObject({ status: "skipped", skipReason: "subject_gone" });
  });

  it("skips the reminder for someone who turned it off, but keeps their ticket emails", async () => {
    configure();
    const fake = useResendFake(server);
    await setEventOff(db, STAFF.niti.id, "maintenance.due");
    await schedule("Clean the lens", TODAY);
    const queued = await enqueueMaintenanceReminder(TODAY, { db });
    if (!queued.queued) throw new Error("expected a reminder");
    await runOnce(queued.id);
    expect(fake.requests.map((r) => r.body.to?.[0])).toEqual([STAFF.isaac.email]);

    const ticket = await fileTicket();
    await runOnce(ticket.notificationId);
    expect(fake.requests.map((r) => r.body.to?.[0]).slice(1).sort()).toEqual([STAFF.isaac.email, STAFF.niti.email]);
  });
});

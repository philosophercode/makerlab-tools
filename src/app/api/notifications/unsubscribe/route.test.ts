// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { getDb, resetDbForTests } from "../../../../lib/db/client";
import { DEMO_ACCOUNTS } from "../../../../lib/db/demo-seed";
import { auditEvents, notificationPreferences } from "../../../../lib/db/schema/index";
import { signUnsubscribeToken } from "../../../../lib/notifications/unsubscribe";
import { ROUTE_TIERS } from "../../../../lib/rate-limit";
import * as route from "./route";

/**
 * `POST /api/notifications/unsubscribe` (email notifications spec §5.4, §10
 * integration): the limiter runs before the token is read; a valid token
 * turns that one email off for that one person, audited, signed out; the
 * confirm page's form gets a redirect; and there is no GET for a link
 * scanner to trip.
 */

const SECRET = "unsubscribe-route-secret-0123456789";
const NITI: string = DEMO_ACCOUNTS.admin.id;

let ipCounter = 0;
function post(query: string, body?: Record<string, string>, ip = `10.40.0.${++ipCounter}`) {
  const init: RequestInit = { method: "POST", headers: { "x-forwarded-for": ip } };
  if (body) {
    init.body = new URLSearchParams(body).toString();
    (init.headers as Record<string, string>)["content-type"] = "application/x-www-form-urlencoded";
  }
  return route.POST(new Request(`https://makerlab-ai.vercel.app/api/notifications/unsubscribe${query}`, init));
}

function token(event: "ticket.filed" | "maintenance.due" = "ticket.filed", userId = NITI) {
  return signUnsubscribeToken({ userId, event, issuedAt: 1_791_000_000 }, SECRET)!;
}

async function preference(userId = NITI) {
  const db = await getDb();
  const [row] = await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId));
  return row ?? null;
}

async function unsubscribeAudits(userId = NITI) {
  const db = await getDb();
  return db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.action, "notification.unsubscribed"), eq(auditEvents.subjectId, userId)));
}

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("PGLITE_DATA_DIR", "");
  vi.stubEnv("AUTH_SECRET", SECRET);
  const db = await getDb();
  await db.delete(notificationPreferences);
  await db.delete(auditEvents).where(eq(auditEvents.action, "notification.unsubscribed"));
});

afterAll(() => {
  resetDbForTests();
});

describe("POST /api/notifications/unsubscribe", () => {
  it("turns the event off for the person in the token on a one-click POST, and audits it without an address", async () => {
    const res = await post(`?t=${encodeURIComponent(token())}`, { "List-Unsubscribe": "One-Click" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect((await preference())?.events).toEqual({ "ticket.filed": "off" });
    const audits = await unsubscribeAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorUserId: NITI, subjectType: "user", detail: { event: "ticket.filed", from: "immediate", to: "off" } });
    expect(JSON.stringify(audits)).not.toContain(DEMO_ACCOUNTS.admin.email);
  });

  it("keeps the person's other choices, and audits a repeat only once", async () => {
    await post(`?t=${encodeURIComponent(token("maintenance.due"))}`, { "List-Unsubscribe": "One-Click" });
    await post(`?t=${encodeURIComponent(token("ticket.filed"))}`, { "List-Unsubscribe": "One-Click" });
    await post(`?t=${encodeURIComponent(token("ticket.filed"))}`, { "List-Unsubscribe": "One-Click" });
    expect((await preference())?.events).toEqual({ "maintenance.due": "off", "ticket.filed": "off" });
    expect(await unsubscribeAudits()).toHaveLength(2);
  });

  it("redirects the confirm page's form back to its done state", async () => {
    const t = token();
    const res = await post(`?t=${encodeURIComponent(t)}`, { from: "page" });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/notifications/unsubscribe");
    expect(location.searchParams.get("state")).toBe("done");
    expect(location.searchParams.get("t")).toBe(t);
  });

  it("refuses a forged or missing token and changes nothing", async () => {
    const forged = signUnsubscribeToken({ userId: NITI, event: "ticket.filed", issuedAt: 1 }, "another-secret")!;
    expect((await post(`?t=${encodeURIComponent(forged)}`)).status).toBe(400);
    expect((await post("")).status).toBe(400);
    const fromPage = await post("?t=junk", { from: "page" });
    expect(fromPage.status).toBe(303);
    expect(new URL(fromPage.headers.get("location") ?? "").searchParams.get("state")).toBe("invalid");
    expect(await preference()).toBeNull();
  });

  it("answers a token for a removed person as done, and writes nothing", async () => {
    const res = await post(`?t=${encodeURIComponent(token("ticket.filed", "no-such-person"))}`);
    expect(res.status).toBe(200);
    expect(await preference("no-such-person")).toBeNull();
  });

  it("runs the limiter before the token: past the tier even a valid token changes nothing", async () => {
    const ip = "10.41.0.1";
    for (let i = 0; i < ROUTE_TIERS.notificationsUnsubscribe.limit; i += 1) await post("?t=junk", undefined, ip);
    const res = await post(`?t=${encodeURIComponent(token())}`, undefined, ip);
    expect(res.status).toBe(429);
    expect(await preference()).toBeNull();
  });

  it("has no GET: opening the link can never unsubscribe anybody", () => {
    expect("GET" in route).toBe(false);
  });
});

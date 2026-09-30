// @vitest-environment node
import { nextCacheMock } from "../../../../test/mocks/next-cache";

vi.mock("next/cache", () => nextCacheMock());

import { eq, sql } from "drizzle-orm";
import { resetAuthForTests } from "../../../lib/auth/config";
import { getDb, resetDbForTests } from "../../../lib/db/client";
import { rawRows } from "../../../lib/db/raw";
import { tools, usageEvents } from "../../../lib/db/schema/index";
import { ROUTE_TIERS } from "../../../lib/rate-limit";
import { signInAsNew } from "../../../../test/utils/session";
import { POST } from "./route";

/**
 * `POST /api/usage` (usage insight spec §5.3, §10): the beacon's tier, the
 * signals that record nothing, the published-tool check — and that what is
 * stored says nothing about the visitor but a role bucket.
 */

let ipCounter = 0;
const BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15";

function beacon(body: unknown, headers: Record<string, string> = {}, ip = `10.40.0.${++ipCounter}`) {
  return new Request("http://localhost/api/usage", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip, "user-agent": BROWSER, ...headers },
    body: JSON.stringify(body),
  });
}

let form4: string;

async function newEvents() {
  const db = await getDb();
  return db.select().from(usageEvents).where(sql`${usageEvents.occurredAt} > now() - interval '1 minute' and ${usageEvents.kind} in ('tool_view', 'kiosk_view')`);
}

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", "usage-route-secret");
  resetAuthForTests();
  const db = await getDb();
  await db.delete(usageEvents);
  const [row] = await db.select({ id: tools.id }).from(tools).where(eq(tools.slug, "form-4"));
  form4 = row.id;
});

afterEach(() => {
  resetAuthForTests();
  resetDbForTests();
});

describe("POST /api/usage", () => {
  it("records one anonymous tool view, with its source, and answers 204", async () => {
    const res = await POST(beacon({ kind: "tool_view", toolId: form4, source: "qr" }));
    expect(res.status).toBe(204);
    const [event] = await newEvents();
    expect(event).toMatchObject({ kind: "tool_view", surface: "web", audience: "anonymous", toolId: form4, source: "qr" });
  });

  it("stores no identifier of the visitor: not the address, the agent or the session", async () => {
    const student = await signInAsNew({ email: "casey@cornell.edu", role: "user" });
    await POST(beacon({ kind: "tool_view", toolId: form4 }, { cookie: student.cookie }, "203.0.113.77"));
    const db = await getDb();
    const rows = await rawRows<Record<string, unknown>>(db, sql`select * from usage_events`);
    expect(rows).toHaveLength(1);
    expect(rows[0].audience).toBe("member");
    const stored = JSON.stringify(rows);
    for (const secret of ["203.0.113.77", "casey", student.user.id, student.token, "Mozilla"]) expect(stored).not.toContain(secret);
  });

  it.each([
    ["Sec-GPC", { "sec-gpc": "1" }],
    ["DNT", { dnt: "1" }],
    ["a bot", { "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" }],
  ])("records nothing for %s, and still answers 204", async (_label, headers) => {
    const res = await POST(beacon({ kind: "tool_view", toolId: form4 }, headers));
    expect(res.status).toBe(204);
    expect(await newEvents()).toHaveLength(0);
  });

  it("records nothing with USAGE_INSIGHT=off", async () => {
    vi.stubEnv("USAGE_INSIGHT", "off");
    expect((await POST(beacon({ kind: "tool_view", toolId: form4 }))).status).toBe(204);
    expect(await newEvents()).toHaveLength(0);
  });

  it("ignores an unpublished tool, an unknown id and a malformed body, answering 204 all the same", async () => {
    const db = await getDb();
    const [draft] = await db.insert(tools).values({ slug: `usage-draft-${Date.now()}`, name: "Draft Lathe", published: false }).returning({ id: tools.id });
    for (const body of [
      { kind: "tool_view", toolId: draft.id },
      { kind: "tool_view", toolId: "00000000-0000-4000-8000-000000000000" },
      { kind: "tool_view", toolId: "form-4" },
      { kind: "chat_turn" },
      "nonsense",
    ]) {
      expect((await POST(beacon(body))).status).toBe(204);
    }
    expect(await newEvents()).toHaveLength(0);
    await db.delete(tools).where(eq(tools.id, draft.id));
  });

  it("records an arrival from the kiosk's QR code", async () => {
    await POST(beacon({ kind: "kiosk_view" }));
    expect((await newEvents())[0]).toMatchObject({ kind: "kiosk_view", source: "qr", toolId: null });
  });

  it(`answers 429 past ${ROUTE_TIERS.usage.limit} a minute, before recording anything`, async () => {
    const ip = "10.41.0.1";
    for (let i = 0; i < ROUTE_TIERS.usage.limit; i += 1) {
      expect((await POST(beacon({ kind: "nothing" }, {}, ip))).status).toBe(204);
    }
    const res = await POST(beacon({ kind: "tool_view", toolId: form4 }, {}, ip));
    expect(res.status).toBe(429);
    expect(await newEvents()).toHaveLength(0);
  });
});

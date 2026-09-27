// @vitest-environment node
import { nextCacheMock } from "../../../../test/mocks/next-cache";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("../../../lib/mirror/trigger", () => ({ requestMirrorPush: vi.fn(async () => undefined) }));

const limiter = vi.hoisted(() => ({ allowed: true }));
vi.mock("../../../lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/rate-limit")>();
  return {
    ...actual,
    checkRateLimit: vi.fn(async (scope: string, identity: Parameters<typeof actual.checkRateLimit>[1]) =>
      scope === "actionConfirm" && !limiter.allowed
        ? { allowed: false, remaining: 0, limit: 60, windowMs: 60_000, retryAfterSeconds: 60, role: identity.role }
        : actual.checkRateLimit(scope as never, identity)
    ),
  };
});

import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { resetAuthForTests } from "../../../lib/auth/config";
import { createActionProposals } from "../../../lib/data/action-proposals";
import { getDb, resetDbForTests } from "../../../lib/db/client";
import { maintenanceLogs } from "../../../lib/db/schema/index";
import { signInAsNew } from "../../../../test/utils/session";
import { GET, POST } from "./route";

/**
 * `POST /api/action-proposals` (assistant–GUI parity spec §3.5, §8.2): the
 * session cookie only — a bearer token is anonymous here — ids and a decision
 * only, and only the creator's rows. `GET ?chatId=` re-reads the caller's own.
 */

async function post(body: unknown, headers: Record<string, string> = {}) {
  const res = await POST(
    new NextRequest("http://localhost/api/action-proposals", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the route's JSON, read by each test.
  return { status: res.status, body: (await res.json()) as any };
}

async function staff() {
  return signInAsNew({ email: `ap-${crypto.randomUUID().slice(0, 6)}@cornell.edu`, role: "admin", name: "Sam Maker" });
}

async function ticketProposal(createdBy: string) {
  const db = await getDb();
  const [ticket] = await db.insert(maintenanceLogs).values({ title: "Belt slipping", status: "open" }).returning();
  const [row] = await createActionProposals([
    {
      groupId: crypto.randomUUID(),
      actionId: "tickets.update",
      input: { logId: ticket.id, patch: { status: "resolved" } },
      subjectType: "maintenance_log",
      subjectId: ticket.id,
      preview: { subjectName: "Belt slipping", rows: [], summary: { key: "tickets_update", values: {} }, link: "/admin/maintenance" },
      surface: "assistant",
      chatId: "chat-9",
      createdBy,
    },
  ]);
  return { ticket, row };
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", "action-proposals-route-secret");
  resetAuthForTests();
  limiter.allowed = true;
});

afterEach(() => {
  resetAuthForTests();
  resetDbForTests();
});

describe("POST /api/action-proposals", () => {
  it("confirms the caller's own proposal, running its stored input", async () => {
    const me = await staff();
    const { ticket, row } = await ticketProposal(me.user.id);
    const res = await post({ ids: [row.id], decision: "confirm" }, { cookie: me.cookie });
    expect(res).toEqual({ status: 200, body: { results: [{ id: row.id, status: "confirmed", link: "/admin/maintenance" }] } });
    const db = await getDb();
    const [after] = await db.select().from(maintenanceLogs).where(eq(maintenanceLogs.id, ticket.id));
    expect(after).toMatchObject({ status: "resolved", updatedBy: me.user.id });
  });

  it("refuses an anonymous caller, and treats a bearer token as anonymous (a token never confirms)", async () => {
    const me = await staff();
    const { row } = await ticketProposal(me.user.id);
    expect((await post({ ids: [row.id], decision: "confirm" })).status).toBe(401);
    expect((await post({ ids: [row.id], decision: "confirm" }, { authorization: "Bearer mlt_abcdef" })).status).toBe(401);
  });

  it("takes ids and a decision and nothing else — no input can ride along", async () => {
    const me = await staff();
    const { row } = await ticketProposal(me.user.id);
    for (const body of [
      { ids: [row.id], decision: "confirm", input: { logId: row.subjectId, patch: { status: "closed" } } },
      { ids: ["not-a-uuid"], decision: "confirm" },
      { ids: [], decision: "confirm" },
      { ids: [row.id], decision: "approve" },
      "{not json",
    ]) {
      expect((await post(body, { cookie: me.cookie })).status).toBe(400);
    }
  });

  it("answers another person's proposal as not found", async () => {
    const owner = await staff();
    const other = await staff();
    const { row } = await ticketProposal(owner.user.id);
    expect((await post({ ids: [row.id], decision: "confirm" }, { cookie: other.cookie })).body).toEqual({
      results: [{ id: row.id, status: "not_found" }],
    });
  });

  it("is rate-limited before anything is read", async () => {
    const me = await staff();
    limiter.allowed = false;
    const res = await post({ ids: [crypto.randomUUID()], decision: "confirm" }, { cookie: me.cookie });
    expect(res).toMatchObject({ status: 429, body: { code: "rate_limited" } });
  });
});

describe("GET /api/action-proposals", () => {
  it("lists the caller's proposals in one chat, and nobody else's", async () => {
    const me = await staff();
    const other = await staff();
    const { row } = await ticketProposal(me.user.id);
    await ticketProposal(other.user.id);
    const res = await GET(new NextRequest("http://localhost/api/action-proposals?chatId=chat-9", { headers: { cookie: me.cookie } }));
    const body = await res.json();
    expect(body.proposals).toEqual([expect.objectContaining({ id: row.id, status: "open", actionId: "tickets.update" })]);
    expect((await GET(new NextRequest("http://localhost/api/action-proposals?chatId=chat-9"))).status).toBe(401);
  });
});

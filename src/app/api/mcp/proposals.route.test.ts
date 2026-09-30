// @vitest-environment node
/**
 * MCP proposals, end to end (assistant–GUI parity spec §3.8, phase 7; owner's
 * §11 answers 4, 7 and 11): an MCP token proposes, the proposal waits in its
 * owner's Assistant proposals inbox for 7 days, and only that person, signed
 * in to the app with a cookie, can confirm it — through the same
 * `POST /api/action-proposals` and `performAction` the chat's cards use,
 * audited with `surface: mcp`. Nothing is committed by the MCP call itself.
 *
 * The real MCP route and the real confirm route over the demo-seeded PGlite
 * database; identities are real tokens and real session cookies.
 */

// `nextCacheMock` is imported first on purpose: `vi.mock` is hoisted above
// every import, and its factory can only reach a module imported before it.
import { nextCacheMock } from "../../../../test/mocks/next-cache";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("../../../lib/mirror/trigger", () => ({ requestMirrorPush: vi.fn(async () => undefined) }));

import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { POST as MCP_POST } from "@/app/api/mcp/route";
import { POST as CONFIRM_POST } from "@/app/api/action-proposals/route";
import { resetAuthForTests } from "@/lib/auth/config";
import { resetLegacyWarningForTests } from "@/lib/auth/mcp-caller";
import { createApiToken } from "@/lib/data/api-tokens";
import { listInboxProposals } from "@/lib/data/action-proposals";
import { getDb, resetDbForTests } from "@/lib/db/client";
import { actionProposals, apiTokens, auditEvents, feedback, tools } from "@/lib/db/schema/index";
import { signInAsNew, type SignedInSession } from "../../../../test/utils/session";

const MCP_URL = "http://localhost/api/mcp";
let ipCounter = 0;
let nextId = 1;

async function mcpCall(name: string, args: Record<string, unknown>, headers: Record<string, string>) {
  const res = await MCP_POST(
    new Request(MCP_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "x-forwarded-for": `203.0.113.${ipCounter}`,
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } }),
    })
  );
  const json = (await res.json()) as { error?: { message: string }; result?: { isError?: boolean; content?: { type: string; text: string }[] } };
  const text = (json.result?.content ?? []).map((c) => c.text).join("\n");
  return { json, text };
}

async function confirm(ids: string[], headers: Record<string, string>) {
  const res = await CONFIRM_POST(
    new NextRequest("http://localhost/api/action-proposals", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4", ...headers },
      body: JSON.stringify({ ids, decision: "confirm" }),
    })
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the route's JSON, read by each test.
  return { status: res.status, body: (await res.json()) as any };
}

/** A staff member with both a session cookie (the app) and a token (their MCP client). */
async function staffWithToken(role: "admin" | "super_admin" = "admin"): Promise<SignedInSession & { bearer: Record<string, string> }> {
  const session = await signInAsNew({ email: `mcp-p-${crypto.randomUUID().slice(0, 8)}@cornell.edu`, role, name: "Sam Maker" });
  const created = await createApiToken({ userId: session.user.id, name: "claude code", readOnly: false });
  if (!created.ok) throw new Error("expected a token");
  return { ...session, bearer: { authorization: `Bearer ${created.token}` } };
}

async function trotec() {
  const db = await getDb();
  const [row] = await db.select().from(tools).where(eq(tools.slug, "trotec-speedy-400"));
  return row;
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", "mcp-proposals-test-secret");
  vi.stubEnv("AUTH_BASE_URL", "http://localhost");
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  vi.stubEnv("MCP_TOKEN", "");
  resetAuthForTests();
  resetLegacyWarningForTests();
  ipCounter += 1;
});

afterEach(async () => {
  const db = await getDb();
  await db.delete(actionProposals);
  await db.delete(apiTokens);
  await db.delete(feedback);
  await db.update(tools).set({ published: true }).where(eq(tools.slug, "trotec-speedy-400"));
});

afterAll(() => {
  resetDbForTests();
});

describe("an MCP proposal waits in its owner's inbox", () => {
  it("stores a proposal for 7 days and changes nothing", async () => {
    const sam = await staffWithToken();
    const tool = await trotec();
    expect(tool.published).toBe(true);

    const { json, text } = await mcpCall("set_tool_published", { tool_ids: [tool.id], published: false }, sam.bearer);
    expect(json.result?.isError).toBeFalsy();
    const answer = JSON.parse(text);
    expect(answer).toMatchObject({ proposed: true, count: 1, subjects: ["Trotec Speedy 400"], inbox: "/admin/proposals" });
    expect(answer.message).toMatch(/NOTHING HAS CHANGED YET/);

    expect((await trotec()).published).toBe(true);
    const db = await getDb();
    const [row] = await db
      .select({
        surface: actionProposals.surface,
        chatId: actionProposals.chatId,
        createdBy: actionProposals.createdBy,
        status: actionProposals.status,
        lifetimeHours: sql<number>`extract(epoch from (${actionProposals.expiresAt} - ${actionProposals.createdAt})) / 3600`,
      })
      .from(actionProposals);
    expect(row).toMatchObject({ surface: "mcp", chatId: null, createdBy: sam.user.id, status: "open" });
    expect(Math.round(Number(row.lifetimeHours))).toBe(7 * 24);

    expect(await listInboxProposals(sam.user.id)).toHaveLength(1);
  });

  it("is invisible to, and cannot be confirmed by, anybody else — even another admin", async () => {
    const sam = await staffWithToken();
    const other = await staffWithToken();
    const tool = await trotec();
    const answer = JSON.parse((await mcpCall("set_tool_published", { tool_ids: [tool.id], published: false }, sam.bearer)).text);
    const [id] = answer.proposal_ids as string[];

    expect(await listInboxProposals(other.user.id)).toEqual([]);
    const refused = await confirm([id], { cookie: other.cookie });
    expect(refused.body.results).toEqual([{ id, status: "not_found" }]);
    expect((await trotec()).published).toBe(true);
  });

  it("cannot be confirmed with the token that proposed it: the confirm route reads the cookie only", async () => {
    const sam = await staffWithToken();
    const tool = await trotec();
    const answer = JSON.parse((await mcpCall("set_tool_published", { tool_ids: [tool.id], published: false }, sam.bearer)).text);
    const refused = await confirm(answer.proposal_ids, sam.bearer);
    expect(refused.status).toBe(401);
    expect((await trotec()).published).toBe(true);
  });

  it("commits when its creator confirms in the app, audited as MCP with the proposal's id", async () => {
    const sam = await staffWithToken();
    const tool = await trotec();
    const answer = JSON.parse((await mcpCall("set_tool_published", { tool_ids: [tool.id], published: false }, sam.bearer)).text);
    const [id] = answer.proposal_ids as string[];

    const done = await confirm([id], { cookie: sam.cookie });
    expect(done.body.results).toEqual([expect.objectContaining({ id, status: "confirmed" })]);
    expect((await trotec()).published).toBe(false);

    const db = await getDb();
    const events = await db.select().from(auditEvents).where(eq(auditEvents.proposalId, id));
    expect(events).toEqual([expect.objectContaining({ action: "tool.unpublished", surface: "mcp", actorUserId: sam.user.id })]);
    const [row] = await listInboxProposals(sam.user.id);
    expect(row).toMatchObject({ id, status: "confirmed", decidedBy: sam.user.id });
  });
});

describe("what MCP may propose", () => {
  it("proposes a correction's status rather than committing it (no `act` scope, §11 answer 4)", async () => {
    const sam = await staffWithToken();
    const db = await getDb();
    const [row] = await db.insert(feedback).values({ issueDescription: "Wrong wattage", status: "new" }).returning();
    const answer = JSON.parse((await mcpCall("set_correction_status", { correction_ids: [row.id], status: "fixed" }, sam.bearer)).text);
    expect(answer).toMatchObject({ proposed: true, count: 1 });
    const [after] = await db.select().from(feedback).where(eq(feedback.id, row.id));
    expect(after.status).toBe("new");
  });

  it("offers a director's token no people action, even as a proposal", async () => {
    const director = await staffWithToken("super_admin");
    const { json, text } = await mcpCall("set_person_title", { user_ids: [director.user.id], title: "Supermaker" }, director.bearer);
    expect(json.error || json.result?.isError).toBeTruthy();
    expect(json.error?.message ?? text).toMatch(/not found/i);
    const db = await getDb();
    expect(await db.select().from(actionProposals)).toEqual([]);
  });

  it("offers no destructive or spending action over MCP", async () => {
    const sam = await staffWithToken();
    const tool = await trotec();
    for (const [name, args] of [
      ["archive_tool", { tool_id: tool.id }],
      ["queue_refresh", { tool_ids: [tool.id] }],
    ] as const) {
      const { json, text } = await mcpCall(name, args, sam.bearer);
      expect(json.error?.message ?? text, name).toMatch(/not found/i);
    }
  });
});

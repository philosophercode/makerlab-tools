// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- reads loosely-typed stream chunks. */
/**
 * `/api/chat` with a demo pass (demo pass spec 2026-10-07 §5.3–§5.5).
 *
 * The real limiter, the real identity and the real pass route: a visitor signs
 * up through `POST /api/demo-pass` and chats with the cookie it set. The model
 * is stubbed at the job registry and reports a Gateway cost on every step, so
 * the ledger's arithmetic is checked to the cent. The demo-seeded PGlite
 * database serves the catalogue, the pass and the tickets — no network.
 */
import { MockLanguageModelV3 } from "ai/test";
import { eq } from "drizzle-orm";

vi.mock("@/lib/ai/models", async (importOriginal) =>
  (await import("../../../../test/ai/models-stub")).stubModelsModule(await importOriginal())
);
vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn(), revalidateTag: vi.fn(), revalidatePath: vi.fn() }));

import { POST as chat } from "@/app/api/chat/route";
import { POST as signUp } from "@/app/api/demo-pass/route";
import { resetAuthForTests } from "@/lib/auth/config";
import { getDb, resetDbForTests } from "@/lib/db/client";
import { demoSignups, maintenanceLogs, tools, usageEvents, usageGaps } from "@/lib/db/schema/index";
import { countOpenTickets, listMaintenanceHistoryForTool, listMaintenanceQueue } from "@/lib/data/maintenance";
import { recordedCalls, resetModelStubs, setLanguageModel, toolCallModel } from "../../../../test/ai/models-stub";

const SECRET = "demo-pass-chat-test-secret";
const STEP_COST = 0.01;

const USAGE = {
  inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 20, text: 20, reasoning: 0 },
};

/** A model that answers `text` and reports `cost` dollars for the step, as the Gateway does. */
function costedModel(text = "Use the Form 4's resin tank guide.", cost = STEP_COST): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    provider: "gateway",
    modelId: "stub/model",
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({ type: "text-start", id: "t" });
          controller.enqueue({ type: "text-delta", id: "t", delta: text });
          controller.enqueue({ type: "text-end", id: "t" });
          controller.enqueue({
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage: USAGE,
            providerMetadata: { gateway: { cost: String(cost) } },
          });
          controller.close();
        },
      }),
    }),
  });
}

let counter = 0;
function uniqueIp(): string {
  counter += 1;
  return `203.0.113.${counter}`;
}

const SIGNUP = {
  name: "Grace Hopper",
  institution: "Harvard Computation Lab",
  useCase: "Debugging the Mark II, again",
};

/** Sign up through the real route; the pass's cookie and row id. */
async function newPass(): Promise<{ cookie: string; id: string; email: string }> {
  const email = `grace-${Date.now()}-${(counter += 1)}@example.org`;
  const res = await signUp(
    new Request("http://localhost/api/demo-pass", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": uniqueIp() },
      body: JSON.stringify({ ...SIGNUP, email, consent: true }),
    })
  );
  expect(res.status).toBe(201);
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
  const db = await getDb();
  const [row] = await db.select({ id: demoSignups.id }).from(demoSignups).where(eq(demoSignups.email, email));
  return { cookie, id: row.id, email };
}

async function send({ ip, cookie, text = "How do I change the resin tank?", toolId }: { ip: string; cookie?: string; text?: string; toolId?: string }) {
  const res = await chat(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ messages: [{ id: "1", role: "user", parts: [{ type: "text", text }] }], ...(toolId ? { toolId } : {}), locale: "en" }),
    })
  );
  const stream = res.ok ? await res.text() : "";
  return { res, stream };
}

/** The `data-demo-pass` part a stream carried, if any. */
function passPart(stream: string): any {
  const line = stream.split("\n").find((l) => l.startsWith("data: {") && l.includes('"data-demo-pass"'));
  return line ? JSON.parse(line.slice(6)).data : undefined;
}

async function ledger(id: string) {
  const db = await getDb();
  const [row] = await db.select({ spentUsd: demoSignups.spentUsd, chargedTurns: demoSignups.chargedTurns }).from(demoSignups).where(eq(demoSignups.id, id));
  return row;
}

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", SECRET);
  vi.stubEnv("DATABASE_URL", "");
  resetAuthForTests();
  vi.spyOn(console, "info").mockImplementation(() => {});
  setLanguageModel("chat", costedModel());
});

afterEach(() => {
  resetModelStubs();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetAuthForTests();
});

afterAll(() => resetDbForTests());

describe("POST /api/chat with a demo pass", () => {
  it("chats past the anonymous ceiling from a shared IP, and charges every turn its cost", async () => {
    const ip = uniqueIp();
    const pass = await newPass();
    for (let i = 0; i < 12; i += 1) {
      expect((await send({ ip, cookie: pass.cookie })).res.status).toBe(200);
    }
    const spent = await ledger(pass.id);
    expect(spent.chargedTurns).toBe(12);
    expect(spent.spentUsd).toBeCloseTo(12 * STEP_COST, 6);

    // The pass never touched the shared address's own allowance.
    for (let i = 0; i < 8; i += 1) expect((await send({ ip })).res.status).toBe(200);
    expect((await send({ ip })).res.status).toBe(429);
  });

  it("tells the chat the balance before each turn", async () => {
    const pass = await newPass();
    const first = await send({ ip: uniqueIp(), cookie: pass.cookie });
    expect(passPart(first.stream)).toMatchObject({ remainingUsd: 0.5, budgetUsd: 0.5, exhausted: false });
    const second = await send({ ip: uniqueIp(), cookie: pass.cookie });
    expect(passPart(second.stream).remainingUsd).toBeCloseTo(0.49, 6);
    expect(JSON.stringify(passPart(second.stream))).not.toContain(pass.id);
  });

  it("falls back to the anonymous limits once spent: says so, stops charging, and is refused with the thank-you code", async () => {
    vi.stubEnv("DEMO_PASS_BUDGET_USD", "0.025");
    const ip = uniqueIp();
    const pass = await newPass();
    for (let i = 0; i < 3; i += 1) await send({ ip, cookie: pass.cookie });
    expect((await ledger(pass.id)).spentUsd).toBeCloseTo(0.03, 6);

    // Spent: the anonymous tier, keyed on the address — eight turns, uncharged.
    for (let i = 0; i < 8; i += 1) {
      const { res, stream } = await send({ ip, cookie: pass.cookie });
      expect(res.status).toBe(200);
      expect(passPart(stream)).toMatchObject({ exhausted: true, remainingUsd: 0 });
    }
    expect(await ledger(pass.id)).toMatchObject({ chargedTurns: 3 });

    const { res } = await send({ ip, cookie: pass.cookie });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe("rate_limited_demo_pass");
    expect(body.signInPath).toBeUndefined();
  });

  it("never puts the sign-up's name, email, institution or answers in front of the model", async () => {
    const model = costedModel();
    setLanguageModel("chat", model);
    const pass = await newPass();
    await send({ ip: uniqueIp(), cookie: pass.cookie, toolId: "form-4" });
    const prompt = JSON.stringify(recordedCalls(model).map((call) => call.prompt));
    expect(prompt.length).toBeGreaterThan(1000);
    for (const value of [SIGNUP.name, "Grace", pass.email, SIGNUP.institution, SIGNUP.useCase]) {
      expect(prompt).not.toContain(value);
    }
    // To the assistant the visitor is nobody in particular.
    expect(prompt).toContain("Nobody is signed in");
  });

  it("treats a pass that has ended as an ordinary visitor", async () => {
    const ip = uniqueIp();
    const pass = await newPass();
    const db = await getDb();
    await db.update(demoSignups).set({ passExpiresAt: new Date(Date.now() - 1000) }).where(eq(demoSignups.id, pass.id));
    const { stream } = await send({ ip, cookie: pass.cookie });
    expect(passPart(stream)).toBeUndefined();
    for (let i = 0; i < 7; i += 1) await send({ ip, cookie: pass.cookie });
    const { res } = await send({ ip, cookie: pass.cookie });
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe("rate_limited_sign_in");
    expect(await ledger(pass.id)).toMatchObject({ chargedTurns: 0 });
  });

  it("records a pass's turns as demo usage", async () => {
    const db = await getDb();
    await db.delete(usageEvents);
    const pass = await newPass();
    await send({ ip: uniqueIp(), cookie: pass.cookie, text: "How do I use the laser cutter?" });
    await vi.waitFor(async () => expect((await db.select().from(usageEvents)).some((e) => e.kind === "chat_turn")).toBe(true), { timeout: 5000 });
    const turns = (await db.select().from(usageEvents)).filter((e) => e.kind === "chat_turn");
    expect(turns.map((e) => e.audience)).toEqual(["demo"]);
  });

  it("counts a pass's unanswered question but keeps it out of the lab's Unanswered queue", async () => {
    const db = await getDb();
    await db.delete(usageEvents);
    await db.delete(usageGaps);
    const pass = await newPass();
    setLanguageModel("chat", toolCallModel([{ toolName: "get_tool_details", input: { id_or_name: "waterjet" } }], "The lab does not have a waterjet."));
    await send({ ip: uniqueIp(), cookie: pass.cookie, text: "Do you have a waterjet?" });
    await vi.waitFor(async () => expect((await db.select().from(usageEvents)).some((e) => e.kind === "gap")).toBe(true), { timeout: 5000 });
    expect((await db.select().from(usageEvents)).filter((e) => e.kind === "gap").map((e) => e.audience)).toEqual(["demo"]);
    expect(await db.select().from(usageGaps)).toEqual([]);
  });

  it("files a problem reported with a pass as a demo ticket: queued and badged, out of the lab's counts and history", async () => {
    const db = await getDb();
    const [trotec] = await db.select({ id: tools.id }).from(tools).where(eq(tools.slug, "trotec-speedy-400"));
    const before = await countOpenTickets(db);
    const pass = await newPass();
    setLanguageModel(
      "chat",
      toolCallModel(
        [{ toolName: "report_issue", input: { title: "Demo: laser will not fire", description: "Pressed start, nothing happens.", priority: "High", reported_by: "Grace" } }],
        "Filed."
      )
    );

    const { stream } = await send({ ip: uniqueIp(), cookie: pass.cookie, toolId: "trotec-speedy-400", text: "The laser will not fire, please log it" });
    expect(stream).toContain("marked as a demo report");

    const [ticket] = await db.select().from(maintenanceLogs).where(eq(maintenanceLogs.title, "Demo: laser will not fire"));
    expect(ticket).toMatchObject({ demo: true, reportedByEmail: null, reportedByUserId: null });
    // The sign-up's details are never copied onto the ticket.
    expect(JSON.stringify(ticket)).not.toContain(pass.email);
    expect(JSON.stringify(ticket)).not.toContain(SIGNUP.institution);

    expect(await countOpenTickets(db)).toEqual(before);
    expect((await listMaintenanceHistoryForTool(trotec.id, { db })).some((entry) => entry.id === ticket.id)).toBe(false);
    expect((await listMaintenanceQueue({ db })).find((entry) => entry.id === ticket.id)).toMatchObject({ demo: true });
  });
});

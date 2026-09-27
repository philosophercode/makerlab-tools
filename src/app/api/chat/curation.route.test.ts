// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- reads the loosely-typed prompt and tools a stub model recorded. */

vi.mock("@/lib/ai/models", async (importOriginal) =>
  (await import("../../../../test/ai/models-stub")).stubModelsModule(await importOriginal())
);

const mocks = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: mocks.checkRateLimit, getClientIp: vi.fn(() => "1.2.3.4") };
});
vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn(), revalidateTag: vi.fn() }));

import { eq } from "drizzle-orm";
import { POST } from "@/app/api/chat/route";
import { resetAuthForTests } from "@/lib/auth/config";
import { createPendingBatch, completeResearch, markResearching, queueForResearch } from "@/lib/data/pending-tools";
import { getDb, resetDbForTests } from "@/lib/db/client";
import { chatProposals, tools as toolsTable } from "@/lib/db/schema/index";
import { researchFixture } from "@/lib/refresh/fixtures.test-helpers";
import { recordedCalls, resetModelStubs, setLanguageModel, textModel, toolCallModel } from "../../../../test/ai/models-stub";
import { signInAsNew } from "../../../../test/utils/session";

/**
 * Research with the assistant — curation turns (refresh research spec §12,
 * §12.5): the capability is composed only for a caller who may curate the
 * record the page shows; its prompt is the fenced "Curating" block with the
 * current values; `propose_change` stores a proposal and emits a
 * `data-proposal` card; and there is no model tool that accepts or writes a
 * record.
 */

let model = textModel("Hello.");

function stubChat(next: typeof model) {
  model = next;
  setLanguageModel("chat", next);
}

const userMessage = (text: string) => ({ id: "1", role: "user" as const, parts: [{ type: "text" as const, text }] });

async function send(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const res = await POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4", ...headers },
      body: JSON.stringify({ id: "chat-1", ...body }),
    })
  );
  return res.text();
}

function system(): string {
  const message = recordedCalls(model)[0]?.prompt.find((m) => m.role === "system");
  return typeof message?.content === "string" ? message.content : "";
}

function toolNames(): string[] {
  return ((recordedCalls(model)[0]?.tools ?? []) as any[]).map((tool) => tool.name);
}

async function signIn(role: "admin" | "user") {
  const signedIn = await signInAsNew({ email: `curate-${role}-${crypto.randomUUID().slice(0, 6)}@cornell.edu`, role });
  return { cookie: signedIn.cookie, userId: signedIn.user.id };
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", "curation-route-test-secret");
  resetAuthForTests();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  stubChat(textModel("Hello."));
  mocks.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 59, limit: 60, windowMs: 3_600_000, retryAfterSeconds: 3600, role: "admin" });
});

afterEach(async () => {
  resetModelStubs();
  vi.restoreAllMocks();
  const db = await getDb();
  await db.delete(chatProposals);
  resetAuthForTests();
  resetDbForTests();
});

it("composes curation for an admin on a tool page: the fenced record, and the two tools", async () => {
  const { cookie } = await signIn("admin");
  await send({ messages: [userMessage("Curate this entry")], toolId: "form-4" }, { cookie });
  expect(system()).toContain("## Curating: Form 4");
  expect(system()).toMatch(/You propose; you never change anything/);
  expect(system()).toContain('"use_restrictions"');
  expect(toolNames()).toEqual(expect.arrayContaining(["get_record", "propose_change", "read_page", "exa_search"]));
});

it("never composes it for a student or a visitor", async () => {
  const { cookie } = await signIn("user");
  await send({ messages: [userMessage("Curate this entry")], toolId: "form-4" }, { cookie });
  expect(system()).not.toContain("Curating:");
  expect(toolNames()).not.toContain("propose_change");

  stubChat(textModel("Hello."));
  await send({ messages: [userMessage("Curate this entry")], toolId: "form-4" });
  expect(toolNames()).not.toContain("get_record");
});

it("offers no tool that accepts, publishes, archives or writes a record", async () => {
  const { cookie } = await signIn("admin");
  await send({ messages: [userMessage("Curate this entry")], toolId: "form-4" }, { cookie });
  const names = toolNames();
  for (const forbidden of ["accept_proposal", "accept_change", "update_tool", "save_tool", "publish_tool", "archive_tool", "create_tool"]) {
    expect(names).not.toContain(forbidden);
  }
});

it("propose_change stores a proposal, emits a card, and leaves the tool untouched", async () => {
  const { cookie, userId } = await signIn("admin");
  const db = await getDb();
  const [tool] = await db.select().from(toolsTable).where(eq(toolsTable.slug, "form-4"));
  stubChat(
    toolCallModel(
      [
        {
          toolName: "propose_change",
          input: {
            subject: { kind: "tool", id: tool.id },
            field: "emergency_stop",
            value: "Press the power button on the back to stop the printer.",
            citations: [{ quote: "Press the power button to stop", url: "https://formlabs.example/form4" }],
            reason: "The manual names it.",
          },
        },
      ],
      "I proposed an emergency stop for you to review."
    )
  );
  const stream = await send({ messages: [userMessage("Add the emergency stop")], toolId: "form-4" }, { cookie });
  expect(stream).toContain('"type":"data-proposal"');

  const [row] = await db.select().from(chatProposals);
  expect(row).toMatchObject({ subjectKind: "tool", subjectId: tool.id, chatId: "chat-1", createdBy: userId });
  expect(row.proposal).toMatchObject({
    field: "emergency_stop",
    kind: tool.emergencyStop ? "differs" : "new",
    safety: true,
    proposed: "Press the power button on the back to stop the printer.",
    decision: "pending",
    reason: "The manual names it.",
  });
  // Nothing was read this turn, so the quote cannot be verified.
  expect((row.proposal as any).citations[0].verified).toBe(false);
  const [after] = await db.select().from(toolsTable).where(eq(toolsTable.id, tool.id));
  expect(after.emergencyStop).toBe(tool.emergencyStop);
});

it("curates a pending item for a reviewer on its preliminary page", async () => {
  const { cookie, userId } = await signIn("admin");
  const { items } = await createPendingBatch({ createdBy: userId, items: [{ name: "Grey dust box" }] });
  const id = items[0].id;
  const requestId = crypto.randomUUID();
  await queueForResearch([id], { requestedBy: userId, requestId });
  await markResearching(id, { requestId });
  await completeResearch(id, researchFixture({ canonicalName: "WEN DC3401" }), { requestId });

  await send({ messages: [userMessage("Curate this entry")], pendingId: id }, { cookie });
  expect(system()).toContain("## Curating: WEN DC3401");
  expect(system()).toContain(`"kind": "pending"`);
  expect(toolNames()).toContain("propose_change");
});

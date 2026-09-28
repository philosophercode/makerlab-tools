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
vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn(), revalidateTag: vi.fn(), revalidatePath: vi.fn() }));

import { eq } from "drizzle-orm";
import { POST } from "@/app/api/chat/route";
import { POST as DECIDE } from "@/app/api/action-proposals/route";
import { actionProposals } from "@/lib/db/schema/index";
import { resetAuthForTests } from "@/lib/auth/config";
import { getDb, resetDbForTests } from "@/lib/db/client";
import { maintenanceLogs } from "@/lib/db/schema/index";
import { recordedCalls, resetModelStubs, setLanguageModel, textModel, toolCallModel } from "../../../../test/ai/models-stub";
import { signInAsNew } from "../../../../test/utils/session";

/**
 * Managing maintenance from the site chat (MCP access spec amendment
 * 2026-09-25; assistant–GUI parity spec phase 2): the route composes the
 * staff queue tools only for a caller holding their permission, the chat's
 * `update_ticket` only proposes a card, and the person's Confirm — through
 * `POST /api/action-proposals` — writes through the admin page's own path as
 * the signed-in person. A typed "yes" changes nothing.
 */

const STAFF_TOOLS = ["list_open_tickets", "update_ticket", "list_intake_queue"];

let model = textModel("Hello.");

function stubChat(next: typeof model) {
  model = next;
  setLanguageModel("chat", next);
}

const userMessage = (text: string) => ({ id: crypto.randomUUID(), role: "user" as const, parts: [{ type: "text" as const, text }] });

async function send(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const res = await POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4", ...headers },
      body: JSON.stringify({ id: "chat-staff", ...body }),
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
  const signedIn = await signInAsNew({ email: `staff-${role}-${crypto.randomUUID().slice(0, 6)}@cornell.edu`, role });
  return { cookie: signedIn.cookie, userId: signedIn.user.id };
}

async function laserTicket() {
  const db = await getDb();
  const [ticket] = await db.select().from(maintenanceLogs).where(eq(maintenanceLogs.title, "Laser bed out of focus"));
  return ticket;
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", "staff-tools-route-test-secret");
  resetAuthForTests();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  stubChat(textModel("Hello."));
  mocks.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 59, limit: 60, windowMs: 3_600_000, retryAfterSeconds: 3600, role: "admin" });
});

afterEach(() => {
  resetModelStubs();
  vi.restoreAllMocks();
  resetAuthForTests();
  resetDbForTests();
});

it("gives a staff session the queue tools and the confirm-on-the-card rule", async () => {
  const { cookie } = await signIn("admin");
  await send({ messages: [userMessage("What maintenance is open on the Form 4?")] }, { cookie });
  expect(toolNames()).toEqual(expect.arrayContaining([...STAFF_TOOLS, "log_completed_maintenance", "set_correction_status"]));
  expect(system()).toContain("### Maintenance queue");
  expect(system()).toMatch(/The Confirm button is the only way to commit/);
  // A SuperMaker is offered no People tool.
  expect(toolNames()).not.toContain("set_person_title");
  expect(toolNames()).not.toContain("find_people");
});

it("gives a student and an anonymous visitor none of them, and no staff instructions", async () => {
  const { cookie } = await signIn("user");
  await send({ messages: [userMessage("What maintenance is open on the Form 4?")] }, { cookie });
  for (const name of STAFF_TOOLS) expect(toolNames()).not.toContain(name);
  expect(system()).not.toContain("Lab staff tools");

  stubChat(textModel("Hello."));
  await send({ messages: [userMessage("Mark the laser ticket resolved")] });
  for (const name of STAFF_TOOLS) expect(toolNames()).not.toContain(name);
  expect(system()).not.toContain("Lab staff tools");
});

it("list_open_tickets answers the staff member with reporter names and no emails", async () => {
  const { cookie } = await signIn("admin");
  stubChat(toolCallModel([{ toolName: "list_open_tickets", input: {} }], "One ticket is open."));
  const stream = await send({ messages: [userMessage("What maintenance is open?")] }, { cookie });
  expect(stream).toContain("Laser bed out of focus");
  expect(stream).toContain("Casey Rivera");
  expect(stream).not.toContain("casey@cornell.edu");
});

it("update_ticket only proposes; the person's Confirm writes as them, through the admin path", async () => {
  const { cookie, userId } = await signIn("admin");
  const ticket = await laserTicket();
  stubChat(
    toolCallModel(
      [{ toolName: "update_ticket", input: { ticket_ids: [ticket.id], status: "resolved", assign_to: "me", resolution: "Refocused the lens." } }],
      "Here is the change — confirm it on the card."
    )
  );
  const stream = await send({ messages: [userMessage("Mark the laser ticket resolved: refocused the lens")] }, { cookie });
  expect(stream).toContain('"proposed":true');
  expect(stream).toContain('"type":"data-action-proposal"');

  // Proposed is not done.
  expect((await laserTicket()).status).toBe(ticket.status);
  const db = await getDb();
  const [proposal] = await db.select().from(actionProposals).where(eq(actionProposals.subjectId, ticket.id));
  expect(proposal).toMatchObject({ actionId: "tickets.update", status: "open", surface: "assistant", chatId: "chat-staff", createdBy: userId });

  const res = await DECIDE(
    new Request("http://localhost/api/action-proposals", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ ids: [proposal.id], decision: "confirm" }),
    }) as never
  );
  expect(await res.json()).toEqual({ results: [expect.objectContaining({ id: proposal.id, status: "confirmed" })] });

  const after = await laserTicket();
  expect(after.status).toBe("resolved");
  expect(after.resolution).toBe("Refocused the lens.");
  expect(after.assignedToUserId).toBe(userId);
});

it("a typed yes after a card calls nothing and changes nothing", async () => {
  const { cookie } = await signIn("admin");
  const ticket = await laserTicket();
  stubChat(textModel("Press Confirm on the card to apply it."));
  await send(
    {
      messages: [
        userMessage("Mark the laser ticket resolved"),
        { id: "a1", role: "assistant", parts: [{ type: "text", text: "Here is the change — confirm it on the card." }] },
        userMessage("Yes, do it"),
      ],
    },
    { cookie }
  );
  expect((await laserTicket()).status).toBe(ticket.status);
});

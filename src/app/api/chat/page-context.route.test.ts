// @vitest-environment node

vi.mock("@/lib/ai/models", async (importOriginal) =>
  (await import("../../../../test/ai/models-stub")).stubModelsModule(await importOriginal())
);

const mocks = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: mocks.checkRateLimit, getClientIp: vi.fn(() => "1.2.3.4") };
});
vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn(), revalidateTag: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/mirror/trigger", () => ({ requestMirrorPush: vi.fn(async () => undefined) }));

import { POST } from "@/app/api/chat/route";
import { POST as DECIDE } from "@/app/api/action-proposals/route";
import { resetAuthForTests } from "@/lib/auth/config";
import { getDb, resetDbForTests } from "@/lib/db/client";
import { maintenanceLogs } from "@/lib/db/schema/index";
import { recordedCalls, resetModelStubs, setLanguageModel, textModel, toolCallModel } from "../../../../test/ai/models-stub";
import { signInAsNew } from "../../../../test/utils/session";

/**
 * The chat route's two server-read blocks (assistant–GUI parity spec §3.6,
 * §5.3): where the person is, re-read from the ids the page sent; and what
 * became of this chat's cards, read from `action_proposals` — never from
 * anything the client says happened.
 */

let model = textModel("Hello.");
function stubChat(next: typeof model) {
  model = next;
  setLanguageModel("chat", next);
}

const userMessage = (text: string) => ({ id: crypto.randomUUID(), role: "user" as const, parts: [{ type: "text" as const, text }] });

async function send(body: Record<string, unknown>, cookie?: string) {
  const res = await POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ id: "chat-page", ...body }),
    })
  );
  return res.text();
}

function system(): string {
  const message = recordedCalls(model)[0]?.prompt.find((m) => m.role === "system");
  return typeof message?.content === "string" ? message.content : "";
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", "page-context-route-test-secret");
  resetAuthForTests();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  stubChat(textModel("Hello."));
  mocks.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 59, limit: 60, windowMs: 60_000, retryAfterSeconds: 60, role: "admin" });
});

afterEach(() => {
  resetModelStubs();
  vi.restoreAllMocks();
  resetAuthForTests();
  resetDbForTests();
});

async function twoTickets() {
  const db = await getDb();
  return db
    .insert(maintenanceLogs)
    .values([
      { title: "Belt slipping", status: "open" },
      { title: "Fan noisy", status: "open" },
    ])
    .returning({ id: maintenanceLogs.id });
}

it("puts the page and the selected rows, as the database names them, in the prompt", async () => {
  const staff = await signInAsNew({ email: "sam@cornell.edu", role: "admin" });
  const [a, b] = await twoTickets();
  await send(
    { messages: [userMessage("Resolve these: replaced the belt")], page: { path: "/admin/maintenance", selection: { kind: "maintenance_log", ids: [a.id, b.id] } } },
    staff.cookie
  );
  expect(system()).toContain("## Where the person is");
  expect(system()).toContain("Belt slipping");
  expect(system()).toContain("Fan noisy");
});

it("drops a forged selection: rows the person may not act on are never read", async () => {
  const student = await signInAsNew({ email: "stu@cornell.edu", role: "user" });
  const [a] = await twoTickets();
  await send(
    { messages: [userMessage("Resolve these")], page: { path: "/admin/maintenance", selection: { kind: "maintenance_log", ids: [a.id] } } },
    student.cookie
  );
  expect(system()).not.toContain("Where the person is");
  expect(system()).not.toContain("Belt slipping");
});

it("ignores a page body that is not the expected shape", async () => {
  const staff = await signInAsNew({ email: "sam@cornell.edu", role: "admin" });
  await send({ messages: [userMessage("Hi")], page: { path: 42, selection: "everything" } }, staff.cookie);
  expect(system()).not.toContain("Where the person is");
});

it("tells the next turn what became of a card, from the database", async () => {
  const staff = await signInAsNew({ email: "sam@cornell.edu", role: "admin" });
  const [a] = await twoTickets();
  stubChat(toolCallModel([{ toolName: "update_ticket", input: { ticket_ids: [a.id], status: "resolved" } }], "Confirm it on the card."));
  const stream = await send({ messages: [userMessage("Resolve the belt ticket")] }, staff.cookie);
  const groupMatch = stream.match(/"type":"data-action-proposal","id":"[^"]+","data":(\{.*?"items":\[\{"id":"([0-9a-f-]{36})")/);
  const proposalId = groupMatch?.[2];
  expect(proposalId).toBeDefined();

  stubChat(textModel("Not yet."));
  await send({ messages: [userMessage("Did it work?")] }, staff.cookie);
  expect(system()).toContain("## Proposals in this conversation");
  expect(system()).toMatch(/update_ticket on "Belt slipping": waiting for the person to press Confirm/);

  await DECIDE(
    new Request("http://localhost/api/action-proposals", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: staff.cookie },
      body: JSON.stringify({ ids: [proposalId], decision: "confirm" }),
    }) as never
  );
  stubChat(textModel("Yes."));
  await send({ messages: [userMessage("Did it work?")] }, staff.cookie);
  expect(system()).toMatch(/update_ticket on "Belt slipping": confirmed and done/);
});

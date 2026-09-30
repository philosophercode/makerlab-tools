// @vitest-environment node
const mocks = vi.hoisted(() => ({ checkRateLimit: vi.fn(), scheduleUsage: vi.fn() }));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  checkRateLimit: mocks.checkRateLimit,
  getClientIp: vi.fn(() => "1.2.3.4"),
}));
vi.mock("@/lib/usage/schedule", () => ({ scheduleUsage: mocks.scheduleUsage }));

import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { starterAnswers, tools } from "@/lib/db/schema/index";
import { upsertStarterAnswer } from "@/lib/data/starter-answers";
import { currentHashInputs, starterHashContext } from "@/lib/starters/cache";
import { starterSourceHash } from "@/lib/starters/hash";
import { GET, POST } from "./route";

/**
 * `GET/POST /api/chat/starters` (starter answers) against the demo-seeded
 * PGlite database: only accepted, current answers are served; a served chip
 * is counted as a cached chat turn.
 */

let formId: string;

async function store(question: string, accepted = true, toolId: string | null = formId) {
  const db = await getDb();
  const inputs = await currentHashInputs(db, toolId);
  await upsertStarterAnswer(db, {
    toolId,
    locale: "en",
    question,
    message: { id: "starter-answer", role: "assistant", parts: [{ type: "text", text: `A: ${question}` }] },
    model: "openai/gpt-6-luna",
    accepted,
    grade: { score: accepted ? 9 : 3, reasons: [] },
    usageEvents: toolId ? [{ kind: "tool_asked", toolId, manualDocumentId: null, page: null }] : [],
    sourceHash: starterSourceHash(inputs!, starterHashContext(question)),
  });
}

const allowed = { allowed: true, remaining: 10, limit: 60, windowMs: 60_000, retryAfterSeconds: 0, role: "anonymous" };

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  const db = await getDb();
  const [form] = await db.select({ id: tools.id }).from(tools).where(eq(tools.slug, "form-4"));
  formId = form.id;
});

beforeEach(async () => {
  mocks.checkRateLimit.mockResolvedValue(allowed);
  mocks.scheduleUsage.mockClear();
  await (await getDb()).delete(starterAnswers);
});

describe("GET /api/chat/starters", () => {
  it("serves a tool's accepted, current answers by slug", async () => {
    await store("Good?");
    await store("Graded down?", false);
    const res = await GET(new Request("http://localhost/api/chat/starters?toolId=form-4&locale=en"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { answers: { question: string; message: { parts: unknown[] } }[] };
    expect(body.answers.map((a) => a.question)).toEqual(["Good?"]);
    expect(body.answers[0].message.parts).toEqual([{ type: "text", text: "A: Good?" }]);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("serves the general chips' answers with no toolId, and nothing for another locale or an unknown tool", async () => {
    await store("General?", true, null);
    const general = (await (await GET(new Request("http://localhost/api/chat/starters?locale=en"))).json()) as { answers: unknown[] };
    expect(general.answers).toHaveLength(1);
    const french = (await (await GET(new Request("http://localhost/api/chat/starters?locale=fr"))).json()) as { answers: unknown[] };
    expect(french.answers).toEqual([]);
    const unknown = (await (await GET(new Request("http://localhost/api/chat/starters?toolId=nope&locale=en"))).json()) as { answers: unknown[] };
    expect(unknown.answers).toEqual([]);
  });

  it("is rate-limited by identity", async () => {
    mocks.checkRateLimit.mockResolvedValue({ ...allowed, allowed: false, retryAfterSeconds: 30 });
    const res = await GET(new Request("http://localhost/api/chat/starters?locale=en"));
    expect(res.status).toBe(429);
    expect(mocks.checkRateLimit).toHaveBeenCalledWith("starters", expect.objectContaining({ role: "anonymous" }));
  });
});

describe("POST /api/chat/starters", () => {
  it("counts a served chip as a cached chat turn with the answer's own events", async () => {
    await store("Good?");
    const res = await POST(
      new Request("http://localhost/api/chat/starters", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toolId: "form-4", question: "Good?", locale: "en" }),
      })
    );
    expect(res.status).toBe(204);
    expect(mocks.scheduleUsage).toHaveBeenCalledTimes(1);
    const [events] = mocks.scheduleUsage.mock.calls[0];
    expect(events).toEqual([
      expect.objectContaining({ kind: "chat_turn", source: "cached", audience: "anonymous", surface: "chat" }),
      expect.objectContaining({ kind: "tool_asked", toolId: formId }),
    ]);
  });

  it("counts nothing for a chip that has no servable answer", async () => {
    await store("Graded down?", false);
    const res = await POST(
      new Request("http://localhost/api/chat/starters", { method: "POST", body: JSON.stringify({ toolId: "form-4", question: "Graded down?", locale: "en" }) })
    );
    expect(res.status).toBe(204);
    expect(mocks.scheduleUsage).not.toHaveBeenCalled();
  });
});

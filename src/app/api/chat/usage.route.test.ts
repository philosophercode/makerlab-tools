// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- reads loosely-typed stream chunks. */

// The chat model and the embedding model are stubbed at the job registry; the
// route, the tools, the search and the usage recording run for real against
// the demo-seeded PGlite database.
vi.mock("@/lib/ai/models", async (importOriginal) =>
  (await import("../../../../test/ai/models-stub")).stubModelsModule(await importOriginal())
);

const mocks = vi.hoisted(() => ({ checkRateLimit: vi.fn(), brokenDb: false }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: mocks.checkRateLimit, getClientIp: vi.fn(() => "1.2.3.4") };
});
vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn(), revalidateTag: vi.fn() }));
/** A database that throws on every usage write, when `brokenDb` is set. */
vi.mock("@/lib/usage/record", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/usage/record")>();
  const broken = { insert: () => { throw new Error("db down"); }, execute: () => { throw new Error("db down"); } };
  return {
    ...actual,
    recordUsage: (events: any, gaps: any, options: any = {}) =>
      actual.recordUsage(events, gaps, mocks.brokenDb ? { ...options, db: broken } : options),
  };
});

import { eq, inArray } from "drizzle-orm";
import { POST } from "@/app/api/chat/route";
import { resetAuthForTests } from "@/lib/auth/config";
import { getDb, resetDbForTests } from "@/lib/db/client";
import { attachments, resources, tools as toolsTable, usageEvents, usageGaps } from "@/lib/db/schema/index";
import { citationRef } from "@/lib/manuals/citation-ref";
import { buildDocumentPassages } from "@/lib/manuals/passages";
import { fakeEmbeddingTarget } from "../../../../test/ai/fake-embeddings";
import { resetModelStubs, setEmbeddingModel, setLanguageModel, textModel, toolCallModel } from "../../../../test/ai/models-stub";
import { seedManual } from "../../../../test/manuals/seed";

/**
 * Usage insight in the chat (usage insight spec §5.1, §9 phase 1, §10): a
 * finished turn writes `chat_turn`, `tool_asked` and `manual_cited` — with the
 * cited page — after the response, a turn that could not answer lands in the
 * Unanswered queue, and a failing usage write leaves the student's answer
 * exactly as it would have been.
 */

const target = fakeEmbeddingTarget();
const inserted: string[] = [];

const userMessage = (text: string) => ({ id: "1", role: "user" as const, parts: [{ type: "text" as const, text }] });

async function send(body: Record<string, unknown>) {
  const res = await POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4" },
      body: JSON.stringify(body),
    })
  );
  return res.text();
}

/** The stream's chunks with their random ids removed: what a student's browser renders. */
function rendered(stream: string): unknown[] {
  return stream
    .split("\n")
    .filter((line) => line.startsWith("data: {"))
    .map((line) => JSON.parse(line.slice(6)))
    .map((chunk: any) => {
      const rest = { ...chunk };
      delete rest.id;
      delete rest.messageId;
      delete rest.toolCallId;
      return rest;
    });
}

async function form4Id(): Promise<string> {
  const db = await getDb();
  const [row] = await db.select({ id: toolsTable.id }).from(toolsTable).where(eq(toolsTable.slug, "form-4"));
  return row.id;
}

async function eventsNow() {
  const db = await getDb();
  return db.select().from(usageEvents);
}

const PAGES = Array.from({ length: 12 }, (_, i) =>
  i === 11 ? "Replacing the resin tank. Lift the resin tank straight up and set it on a flat surface." : `General overview chapter ${i + 1}: printer basics and care.`
);
const OUTLINE = [
  { title: "Overview", page: 1, level: 1 },
  { title: "Resin tank", page: 12, level: 1 },
];

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  resetAuthForTests();
  mocks.brokenDb = false;
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  setEmbeddingModel(target.model);
  mocks.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 59, limit: 60, windowMs: 3_600_000, retryAfterSeconds: 3600, role: "anonymous" });
  const db = await getDb();
  await db.delete(usageEvents);
  await db.delete(usageGaps);
});

afterEach(async () => {
  resetModelStubs();
  vi.restoreAllMocks();
  const db = await getDb();
  await db.delete(attachments);
  if (inserted.length) await db.delete(resources).where(inArray(resources.id, inserted.splice(0)));
});

afterAll(() => resetDbForTests());

describe("usage recorded from a chat turn", () => {
  it("writes chat_turn, tool_asked and manual_cited (page 12) for a Form 4 turn that cites page 12", async () => {
    const db = await getDb();
    const toolId = await form4Id();
    const seeded = await seedManual(db, { toolId, title: "Form 4 Manual", pages: PAGES, outline: OUTLINE });
    inserted.push(seeded.resourceId);
    expect((await buildDocumentPassages(db, seeded.documentId, { target })).status).toBe("built");
    const url = `${seeded.publicUrl}#page=12`;
    setLanguageModel(
      "chat",
      toolCallModel([{ toolName: "search_manual", input: { query: "replace the resin tank" } }], `Lift it straight up ([Resin tank (Form 4 Manual, p. 12)](${url})).`)
    );

    await send({ messages: [userMessage("How do I replace the resin tank?")], toolId: "form-4", locale: "en" });

    await vi.waitFor(async () => expect((await eventsNow()).length).toBeGreaterThanOrEqual(3), { timeout: 5000 });
    const events = await eventsNow();
    expect(events.find((e) => e.kind === "chat_turn")).toMatchObject({ surface: "chat", audience: "anonymous", questionKind: "operate", locale: "en" });
    expect(events.filter((e) => e.kind === "tool_asked").map((e) => e.toolId)).toEqual([toolId]);
    expect(events.find((e) => e.kind === "manual_cited")).toMatchObject({ manualDocumentId: seeded.documentId, page: 12, toolId });
    expect(events.some((e) => e.kind === "gap")).toBe(false);
  });

  // Regression (production, 2026-09-30: Insights showed 0 manual citations
  // while the chat drew "1 MANUAL PAGE"): the model cites by `#cite-<ref>`, as
  // the prompt tells it to — never by the PDF's URL.
  it("writes manual_cited (page 12) when the answer cites the passage by #cite-<ref>", async () => {
    const db = await getDb();
    const toolId = await form4Id();
    const seeded = await seedManual(db, { toolId, title: "Form 4 Manual", pages: PAGES, outline: OUTLINE });
    inserted.push(seeded.resourceId);
    expect((await buildDocumentPassages(db, seeded.documentId, { target })).status).toBe("built");
    const ref = citationRef(seeded.documentId, 12);
    setLanguageModel(
      "chat",
      toolCallModel([{ toolName: "search_manual", input: { query: "replace the resin tank" } }], `Lift it straight up ([Resin tank (Form 4 Manual, p. 12)](#cite-${ref})).`)
    );

    const stream = await send({ messages: [userMessage("How do I replace the resin tank?")], toolId: "form-4", locale: "en" });
    // The chat received the same ref in the tool's output, so it drew the citation.
    expect(stream).toContain(`"ref":"${ref}"`);

    await vi.waitFor(async () => expect((await eventsNow()).some((e) => e.kind === "manual_cited")).toBe(true), { timeout: 5000 });
    const cited = (await eventsNow()).filter((e) => e.kind === "manual_cited");
    expect(cited).toHaveLength(1);
    expect(cited[0]).toMatchObject({ manualDocumentId: seeded.documentId, page: 12, toolId, surface: "chat", audience: "anonymous" });
  });

  it("puts a question the catalogue cannot answer in the Unanswered queue, scrubbed", async () => {
    setLanguageModel("chat", toolCallModel([{ toolName: "get_tool_details", input: { id_or_name: "waterjet" } }], "The lab does not have a waterjet."));
    await send({ messages: [userMessage("I'm abc123 — do you have a waterjet? casey@cornell.edu")] });
    await vi.waitFor(async () => expect((await eventsNow()).some((e) => e.kind === "gap")).toBe(true), { timeout: 5000 });
    const db = await getDb();
    const [gap] = await db.select().from(usageGaps);
    expect(gap.kind).toBe("not_in_catalog");
    expect(gap.question).not.toMatch(/abc123|casey/);
    expect(gap.question).toContain("do you have a waterjet?");
  });

  it("leaves the answer exactly as it was when the usage write fails", async () => {
    setLanguageModel("chat", textModel("Wear safety glasses."));
    const healthy = rendered(await send({ messages: [userMessage("what PPE for the laser?")] }));
    await vi.waitFor(async () => expect((await eventsNow()).length).toBe(1), { timeout: 5000 });

    mocks.brokenDb = true;
    setLanguageModel("chat", textModel("Wear safety glasses."));
    const broken = rendered(await send({ messages: [userMessage("what PPE for the laser?")] }));
    expect(broken).toEqual(healthy);
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("[usage]"), "db down"), { timeout: 5000 });
    expect((await eventsNow()).length).toBe(1);
  });
});

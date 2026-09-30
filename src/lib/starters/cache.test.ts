// @vitest-environment node
import { eq } from "drizzle-orm";
import type { UIMessage } from "ai";
import { getDb } from "@/lib/db/client";
import { resources, starterAnswers, tools } from "@/lib/db/schema/index";
import type { Db } from "@/lib/db/types";
import {
  deleteStarterAnswersExcept,
  findPublishedStarterTool,
  listStarterAnswers,
  loadToolHashInputs,
  upsertStarterAnswer,
} from "@/lib/data/starter-answers";
import { answerForChip, asAssistantMessage, chipStates, chipStatus, currentHashInputs, servableStarterAnswers, starterHashContext } from "./cache";
import { starterSourceHash } from "./hash";

/**
 * Starter answers: whether a stored answer may be served. Against the
 * demo-seeded PGlite database (`form-4`, `trotec-speedy-400`).
 */

const message: UIMessage = {
  id: "starter-answer",
  role: "assistant",
  parts: [{ type: "text", text: "Open PreForm, then press Print." }],
};

let db: Db;
let formId: string;

async function store(question: string, options: { toolId?: string | null; accepted?: boolean; hash?: string } = {}) {
  const toolId = options.toolId === undefined ? formId : options.toolId;
  const inputs = await currentHashInputs(db, toolId);
  await upsertStarterAnswer(db, {
    toolId,
    locale: "en",
    question,
    message,
    model: "openai/gpt-6-luna",
    accepted: options.accepted ?? true,
    grade: { score: 9, reasons: [] },
    usageEvents: [{ kind: "tool_asked", toolId, manualDocumentId: null, page: null }],
    sourceHash: options.hash ?? starterSourceHash(inputs!, starterHashContext(question)),
  });
}

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  db = await getDb();
  const [form] = await db.select({ id: tools.id }).from(tools).where(eq(tools.slug, "form-4"));
  formId = form.id;
});

beforeEach(async () => {
  await db.delete(starterAnswers);
});

describe("servableStarterAnswers", () => {
  it("serves an accepted answer whose hash matches the tool as it stands", async () => {
    await store("How do I start a print?");
    const served = await servableStarterAnswers(db, { toolId: formId });
    expect(served.map((a) => a.question)).toEqual(["How do I start a print?"]);
    expect(served[0].message.parts).toEqual(message.parts);
    expect(answerForChip(served, " How do I start  a print? ")?.question).toBe("How do I start a print?");
    expect(answerForChip(served, "Something else?")).toBeNull();
  });

  it("stops serving it once the tool is edited — stale, and the chip answers live", async () => {
    await store("How do I start a print?");
    await db.update(tools).set({ description: "Edited.", updatedAt: new Date(Date.now() + 5_000) }).where(eq(tools.id, formId));
    expect(await servableStarterAnswers(db, { toolId: formId })).toEqual([]);
    const [state] = (await chipStates(db, [{ toolId: formId, questions: ["How do I start a print?"] }])).get(formId)!;
    expect(state.status).toBe("stale");
  });

  it("stops serving it when a resource of the tool changes", async () => {
    await store("How do I start a print?");
    await db.insert(resources).values({ toolId: formId, title: "New SOP", url: "https://example.com/sop.pdf" });
    expect(await servableStarterAnswers(db, { toolId: formId })).toEqual([]);
  });

  it("never serves an answer the grader turned down, a missing one, or another locale", async () => {
    await store("Rejected?", { accepted: false });
    expect(await servableStarterAnswers(db, { toolId: formId })).toEqual([]);
    const states = (await chipStates(db, [{ toolId: formId, questions: ["Rejected?", "Never asked?"] }])).get(formId)!;
    expect(states.map((s) => s.status)).toEqual(["rejected", "live"]);

    await store("Accepted?");
    expect(await servableStarterAnswers(db, { toolId: formId, locale: "fr" })).toEqual([]);
  });

  it("keeps the general chips apart from a tool's, with their own hash", async () => {
    await store("Which machine makes a lamp?", { toolId: null });
    expect((await servableStarterAnswers(db, { toolId: null })).map((a) => a.question)).toEqual(["Which machine makes a lamp?"]);
    expect(await servableStarterAnswers(db, { toolId: formId })).toEqual([]);
  });

  it("refuses a hash from anything else", async () => {
    await store("Forged?", { hash: "sha256:0000" });
    expect(await servableStarterAnswers(db, { toolId: formId })).toEqual([]);
  });
});

describe("starter_answers writes", () => {
  it("upserts by tool, locale and question — the general chips included (nulls not distinct)", async () => {
    await store("Q?");
    await store("Q?");
    await store("G?", { toolId: null });
    await store("G?", { toolId: null });
    expect(await listStarterAnswers(db, { toolId: formId, locale: "en" })).toHaveLength(1);
    expect(await listStarterAnswers(db, { toolId: null, locale: "en" })).toHaveLength(1);
  });

  it("drops a chip set's answers to questions it no longer shows", async () => {
    await store("Keep?");
    await store("Drop?");
    await store("General?", { toolId: null });
    expect(await deleteStarterAnswersExcept(db, { toolId: formId, locale: "en" }, ["Keep?"])).toBe(1);
    expect((await listStarterAnswers(db, { toolId: formId, locale: "en" })).map((r) => r.question)).toEqual(["Keep?"]);
    expect(await listStarterAnswers(db, { toolId: null, locale: "en" })).toHaveLength(1);
  });
});

describe("helpers", () => {
  it("finds a published tool by slug or id, never a draft", async () => {
    expect((await findPublishedStarterTool(db, "form-4"))?.id).toBe(formId);
    expect((await findPublishedStarterTool(db, formId))?.slug).toBe("form-4");
    expect(await findPublishedStarterTool(db, "no-such-tool")).toBeNull();
  });

  it("loads hash inputs for the tools asked about only", async () => {
    const inputs = await loadToolHashInputs(db, [formId, "not-a-uuid"]);
    expect([...inputs.keys()]).toEqual([formId]);
  });

  it("reads a status with no row as live, and a missing tool as stale", () => {
    expect(chipStatus(undefined, null)).toBe("live");
    expect(chipStatus({ accepted: true, sourceHash: "x", question: "Q?", locale: "en" }, null)).toBe("stale");
  });

  it("only draws a stored assistant message with parts", () => {
    expect(asAssistantMessage(message)?.parts).toEqual(message.parts);
    expect(asAssistantMessage({ role: "user", parts: [{ type: "text", text: "x" }] })).toBeNull();
    expect(asAssistantMessage({ role: "assistant", parts: [] })).toBeNull();
    expect(asAssistantMessage("text")).toBeNull();
  });
});

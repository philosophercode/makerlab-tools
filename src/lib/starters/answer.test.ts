// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- reads the loosely typed prompt a stub model recorded. */
vi.mock("@/lib/ai/models", async (importOriginal) =>
  (await import("../../../test/ai/models-stub")).stubModelsModule(await importOriginal())
);
vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn(), revalidateTag: vi.fn() }));

import type { UIMessage } from "ai";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { maintenanceLogs, tools } from "@/lib/db/schema/index";
import { recordedCalls, resetModelStubs, setLanguageModel, textModel, toolCallModel } from "../../../test/ai/models-stub";
import { describeStarterTool, runStarterAnswer, storableMessage } from "./answer";

/**
 * The headless answer runner (starter answers): the real registry and
 * `composeChat` against the demo-seeded PGlite database, with the chat model
 * stubbed at the job registry — as the chat route's own tests do.
 */

let formId: string;

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  const db = await getDb();
  const [form] = await db.select({ id: tools.id }).from(tools).where(eq(tools.slug, "form-4"));
  formId = form.id;
});

afterEach(resetModelStubs);

describe("runStarterAnswer", () => {
  it("asks as an anonymous visitor on the tool's page: no floor map, no web search, no signed-in tools", async () => {
    const model = toolCallModel([{ toolName: "get_tool_details", input: { id_or_name: "form-4" } }], "Open PreForm and press Print.");
    setLanguageModel("chat", model);

    const run = await runStarterAnswer({ question: "How do I start a print?", toolId: formId });

    expect(run.text).toBe("Open PreForm and press Print.");
    const details = run.toolCalls.find((call) => call.name === "get_tool_details");
    expect(details?.output).toMatchObject({ found: true });
    // The floor map is signed-in only (`canSeeMap`): an anonymous run never sees it.
    expect(details?.output).not.toHaveProperty("map");
    const [first] = recordedCalls(model);
    const offered = (first.tools ?? []).map((t: any) => t.name);
    expect(offered).toContain("get_tool_details");
    expect(offered).toContain("search_manual");
    expect(offered).not.toContain("exa_search");
    expect(offered).not.toContain("list_open_tickets");
    const system = JSON.stringify(first.prompt[0]);
    expect(system).toContain("Form 4");
    expect(system).not.toContain("floor map is");
  });

  it("stubs every write: a report the model files is recorded, never stored", async () => {
    setLanguageModel(
      "chat",
      toolCallModel([{ toolName: "report_issue", input: { toolName: "Form 4", title: "Jammed", description: "It jammed." } }], "Reported.")
    );
    const db = await getDb();
    const before = await db.select({ id: maintenanceLogs.id }).from(maintenanceLogs);

    const run = await runStarterAnswer({ question: "It jammed — can you report it?", toolId: formId });

    expect(run.toolCalls.find((call) => call.name === "report_issue")?.output).toMatchObject({ stubbed: true });
    expect(await db.select({ id: maintenanceLogs.id }).from(maintenanceLogs)).toHaveLength(before.length);
  });

  it("returns the message the chat would draw, its usage events and its tokens", async () => {
    setLanguageModel("chat", textModel("Resin, mostly."));
    const run = await runStarterAnswer({ question: "What can I print with it?", toolId: formId });
    expect(run.message.role).toBe("assistant");
    expect(run.message.parts.some((part) => part.type === "text" && part.text === "Resin, mostly.")).toBe(true);
    expect(run.usageEvents).toContainEqual({ kind: "tool_asked", toolId: formId, manualDocumentId: null, page: null });
    expect(run.usage.inputTokens).toBeGreaterThan(0);
    expect(run.model).toBe("openai/gpt-6-luna");
  });

  it("answers a general chip with no tool in focus", async () => {
    const model = textModel("The laser cutter or the 3D printers.");
    setLanguageModel("chat", model);
    const run = await runStarterAnswer({ question: "Which machines could make a lamp?", toolId: null });
    expect(run.toolId).toBeNull();
    expect(run.usageEvents).toEqual([]);
    expect(JSON.stringify(recordedCalls(model)[0].prompt[0])).not.toContain("## Active tool context");
  });

  it("refuses a tool that is not in the published catalogue", async () => {
    setLanguageModel("chat", textModel("x"));
    await expect(runStarterAnswer({ question: "Q?", toolId: "00000000-0000-4000-8000-000000000000" })).rejects.toThrow(/not in the published catalogue/);
  });
});

describe("storableMessage", () => {
  it("drops reasoning and the run's provider metadata", () => {
    const message = {
      id: "m",
      role: "assistant",
      parts: [
        { type: "step-start" },
        { type: "reasoning", text: "thinking", providerMetadata: { openai: { itemId: "rs_1" } } },
        { type: "text", text: "Answer.", providerMetadata: { openai: { itemId: "msg_1" } } },
        { type: "tool-search_manual", toolCallId: "c1", state: "output-available", input: {}, output: { status: "ok" }, callProviderMetadata: { x: 1 } },
      ],
    } as unknown as UIMessage;
    const stored = storableMessage(message);
    expect(stored.parts.map((part) => part.type)).toEqual(["step-start", "text", "tool-search_manual"]);
    expect(JSON.stringify(stored)).not.toMatch(/providerMetadata|callProviderMetadata|itemId/);
    expect(stored.id).toBe("starter-answer");
  });

  it("drops tool cards, whose status is the moment's, and keeps the text naming the tool", () => {
    const message = {
      id: "m",
      role: "assistant",
      parts: [
        { type: "data-tool-cards", id: "cards", data: { kind: "tool-cards", tools: [{ slug: "form-4", status: "Available" }] } },
        { type: "text", text: "The [Form 4](/tools/form-4) prints in resin." },
      ],
    } as unknown as UIMessage;
    expect(storableMessage(message).parts.map((part) => part.type)).toEqual(["text"]);
  });
});

describe("describeStarterTool", () => {
  it("is the chat's own block for the tool, training and PPE included", async () => {
    const record = await describeStarterTool(formId);
    expect(record).toContain("**Form 4**");
    expect(record).toContain("PPE: Nitrile gloves");
  });
});

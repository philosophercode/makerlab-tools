import {
  convertToModelMessages,
  createUIMessageStream,
  readUIMessageStream,
  stepCountIs,
  streamText,
  type LanguageModel,
  type StepResult,
  type ToolSet,
  type UIMessage,
} from "ai";
import { chatPrepareStep } from "../../app/api/chat/prepare-step";
import { chatProviderOptions, languageModelFor, modelIdFor } from "../ai/models";
import { gatewayCallReport } from "../ai/gateway-usage";
import { systemAnonymousIdentity } from "../auth/identity";
import { CAPABILITIES, capabilitiesForIdentity, composeChat, type CapabilityCtx } from "../capabilities";
import { describeCatalogEntry } from "../capabilities/catalog";
import { describeTool, hasUsableUrl } from "../capabilities/chat-adapter";
import { getCatalogTool, getCatalogTools } from "../catalog";
import { appendManualSections } from "../chat/attached-manuals";
import { stubLiveReads, stubWrites } from "../chat/headless-stubs";
import { markOutsideReads, newTurnState } from "../chat/taint";
import { loadToolManualsForChat } from "../chat/tool-manuals";
import { fromTurn } from "../usage/from-turn";
import { turnUsage } from "../usage/turn-log";

/**
 * One starter chip's question asked through the **real chat pipeline**, with
 * nobody waiting (starter answers). The same registry, the same
 * `composeChat` prompt, the same model and call options (`languageModelFor
 * ("chat")`, `chatProviderOptions()`), the same step caps and step limit as
 * `/api/chat` — only headless, and as an **anonymous visitor** on the chip's
 * page:
 *
 * - `systemAnonymousIdentity()` composes the registry the way the route does
 *   for a visitor who is not signed in (`capabilitiesForIdentity`), so no
 *   answer can carry what only a signed-in person sees — the floor-map
 *   location `get_tool_details` gives a signed-in caller, a private manual;
 * - every write tool is a recorded no-op (`stubWrites`, the eval's own) and
 *   the grader rejects an answer that called one, so a cached answer never
 *   files, reports or proposes anything;
 * - `read_page` is recorded rather than fetched (`stubLiveReads`) and Exa web
 *   search is not offered: a cached answer rests on the lab's catalogue and
 *   its indexed manuals, which is what makes it checkable and what its hash
 *   can track;
 * - manuals that are not searchable are **not attached** as whole PDFs (the
 *   route's fallback): an answer from one would cite pages no stored passage
 *   backs. A chip that needs one grades down and answers live.
 *
 * The answer is the `UIMessage` the chat would have drawn — read back off the
 * same `toUIMessageStream()` the route streams — with reasoning left out and
 * provider metadata stripped (both belong to the run that made them, and a
 * follow-up sends the message back to the model).
 */

export interface StarterToolCall {
  name: string;
  input: unknown;
  output: unknown;
}

/** A usage event the answer counts as, replayed when a chip serves it (no audience yet). */
export interface StarterUsageEvent {
  kind: "tool_asked" | "manual_cited";
  toolId: string | null;
  manualDocumentId: string | null;
  page: number | null;
}

export interface StarterAnswerRun {
  question: string;
  toolId: string | null;
  model: string;
  message: UIMessage;
  /** The answer's prose, every step's text joined. */
  text: string;
  /** The focused tool's resource addresses the prompt listed (the chat may link them). */
  resourceUrls: string[];
  toolCalls: StarterToolCall[];
  usageEvents: StarterUsageEvent[];
  /** What Usage Insight would have logged as unanswered (`fromTurn`'s gap kind), or null. */
  gap: string | null;
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number; gatewayCost: number | null };
}

export interface RunStarterAnswerInput {
  question: string;
  /** The chip's tool (id), or null for a general chip asked off a tool page. */
  toolId: string | null;
  /** Default: the chat job's model. Tests pass a stub. */
  model?: LanguageModel;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 180_000;

export async function runStarterAnswer(input: RunStarterAnswerInput): Promise<StarterAnswerRun> {
  const identity = systemAnonymousIdentity();
  const [catalog, focused] = await Promise.all([
    getCatalogTools(),
    input.toolId ? getCatalogTool(input.toolId) : Promise.resolve(null),
  ]);
  if (input.toolId && !focused) throw new Error(`tool ${input.toolId} is not in the published catalogue`);
  const toolManuals = focused ? await loadToolManualsForChat(focused.id, identity) : { outlines: [] };

  const turn = newTurnState();
  const question: UIMessage = { id: "starter-question", role: "user", parts: [{ type: "text", text: input.question }] };
  const modelMessages = await convertToModelMessages([question]);
  let failure: unknown = null;
  let result: { steps: PromiseLike<StepResult<ToolSet>[]> } | null = null;

  const stream = createUIMessageStream({
    onError: (error) => {
      failure = error;
      return "starter answer failed";
    },
    execute: ({ writer }) => {
      const ctx: CapabilityCtx = { writer, locale: "en", focusedToolId: focused?.id, identity, turn };
      const capabilities = stubLiveReads(stubWrites(capabilitiesForIdentity(CAPABILITIES, identity)));
      const { tools, system } = composeChat(capabilities, ctx, {
        tools: catalog,
        focusedTool: focused,
        locale: "en",
        manualOutlines: toolManuals.outlines,
      });
      const streamed = streamText({
        model: input.model ?? languageModelFor("chat"),
        providerOptions: chatProviderOptions(),
        system: appendManualSections(system, focused, []),
        messages: modelMessages,
        tools,
        prepareStep: chatPrepareStep(Object.keys(tools)),
        onStepFinish: (step) => markOutsideReads(ctx.turn, step),
        stopWhen: stepCountIs(10),
        abortSignal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        onError: ({ error }) => {
          failure = error;
        },
      });
      result = streamed;
      writer.merge(streamed.toUIMessageStream({ sendReasoning: false }));
    },
  });

  let last: UIMessage | null = null;
  for await (const message of readUIMessageStream({ stream })) last = message;
  if (failure) throw failure instanceof Error ? failure : new Error(String(failure));
  if (!result || !last) throw new Error("the chat produced no answer");
  const steps = await (result as { steps: PromiseLike<StepResult<ToolSet>[]> }).steps;

  const text = steps.map((step) => step.text ?? "").join("\n").trim();
  const outputs = new Map(steps.flatMap((step) => step.toolResults.map((r) => [r.toolCallId, r.output] as const)));
  const toolCalls = steps.flatMap((step) =>
    step.toolCalls.map((call) => ({ name: call.toolName, input: call.input, output: outputs.get(call.toolCallId) }))
  );

  const log = turnUsage(turn);
  const { events, gap } = fromTurn({
    steps,
    text,
    lastUserText: input.question,
    focusedToolId: focused?.id ?? null,
    passages: log.passages,
    scopedToolIds: log.scopedToolIds,
    audience: "anonymous",
    locale: "en",
  });
  const usageEvents: StarterUsageEvent[] = events
    .filter((event) => event.kind === "tool_asked" || event.kind === "manual_cited")
    .map((event) => ({
      kind: event.kind as StarterUsageEvent["kind"],
      toolId: event.toolId ?? null,
      manualDocumentId: event.manualDocumentId ?? null,
      page: event.page ?? null,
    }));

  let gatewayCost: number | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  for (const step of steps) {
    inputTokens += step.usage.inputTokens ?? 0;
    outputTokens += step.usage.outputTokens ?? 0;
    cachedInputTokens += step.usage.cachedInputTokens ?? 0;
    const cost = gatewayCallReport(step.providerMetadata).cost;
    if (cost !== null) gatewayCost = (gatewayCost ?? 0) + cost;
  }

  return {
    question: input.question,
    toolId: focused?.id ?? null,
    model: input.model ? modelLabel(input.model) : modelIdFor("chat"),
    message: storableMessage(last),
    text,
    resourceUrls: (focused?.links ?? []).map((link) => link.href).filter((href): href is string => hasUsableUrl(href)),
    toolCalls,
    usageEvents,
    gap: gap?.kind ?? null,
    usage: { inputTokens, outputTokens, cachedInputTokens, gatewayCost },
  };
}

function modelLabel(model: LanguageModel): string {
  return typeof model === "string" ? model : `${model.provider}/${model.modelId}`;
}

/** Keys on a part that belong to the run that made it, never to a stored answer. */
const RUN_ONLY_KEYS = new Set(["providerMetadata", "callProviderMetadata", "providerExecuted"]);

/**
 * The message as it is stored and served: reasoning dropped, run-only
 * metadata stripped from every part, a fresh id. Pure.
 */
export function storableMessage(message: UIMessage): UIMessage {
  const parts = message.parts
    .filter((part) => part.type !== "reasoning")
    .map((part) => Object.fromEntries(Object.entries(part).filter(([key]) => !RUN_ONLY_KEYS.has(key))) as UIMessage["parts"][number]);
  return { id: "starter-answer", role: "assistant", parts };
}

/**
 * The focused tool's block exactly as the chat's prompt gives it
 * (`describeTool`): what an answer could draw on, for the grader and the
 * question writer. Null for a tool that is not published.
 */
export async function describeStarterTool(toolId: string): Promise<string | null> {
  const tool = await getCatalogTool(toolId);
  return tool ? describeTool(tool) : null;
}

/** The catalogue listing exactly as the chat's prompt gives it — the general chips' record. */
export async function describeStarterCatalog(): Promise<string> {
  const catalog = await getCatalogTools();
  return [`MakerLab catalog (${catalog.length} tools):`, ...catalog.map(describeCatalogEntry)].join("\n");
}

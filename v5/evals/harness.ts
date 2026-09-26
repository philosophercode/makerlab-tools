import {
  CAPABILITIES,
  capabilitiesForIdentity,
  composeChat,
  type Capability,
  type CapabilityCtx,
} from "@/lib/capabilities";
import { getCatalogTool, getCatalogTools } from "@/lib/catalog";
import { loadToolManualsForChat } from "@/lib/chat/tool-manuals";
import type { ModelMessage, Tool } from "ai";
import type { Identity } from "@/lib/auth/identity";
import { curationCapability } from "@/lib/capabilities/curation";
import type { CurationContext } from "@/lib/capabilities/types";
import { DEMO_ACCOUNTS } from "@/lib/db/demo-seed";
import { loadCurationSubject, recordFields } from "@/lib/refresh/curation";
import type { EvalCaller, EvalCase, EvalTurn } from "./cases";

/**
 * The bridge between a case and the assistant (design spec §3).
 *
 * Everything here except the model call: resolve the fixture catalogue, focus
 * the machine the case is asked from, stub the write tools, and compose the
 * system prompt and tool set **through the same registry and the same
 * `composeChat` that `/api/chat` uses**. An eval that tested a reimplementation
 * of the prompt would test nothing, so nothing in this file assembles a prompt
 * of its own.
 *
 * Split out from `run.eval.ts` so it can be tested offline, with no API key —
 * the model call is the only part that cannot be.
 */

/**
 * Replace every `write` tool's behavior with a recorded no-op (design spec §8).
 * The tool keeps its name, description, kind and schema, so the model sees —
 * and can still call — exactly the tool surface the chat route exposes; it just
 * cannot write anything.
 */
export function stubWrites(capabilities: Capability[] = CAPABILITIES): Capability[] {
  return capabilities.map((capability) => ({
    ...capability,
    tools: capability.tools.map((capTool) => {
      if (capTool.kind !== "write") return capTool;
      return {
        ...capTool,
        run: async (input: unknown) => ({
          stubbed: true,
          tool: capTool.name,
          input,
          message: "Recorded (eval harness stub — nothing was written).",
        }),
      };
    }),
  }));
}

/**
 * Tools that are `kind: "read"` — no persisted write — but still reach the
 * live network rather than looking something up in the fixture catalogue.
 * `read_page` (gateway spec §3.3) fetches whatever URL the model names with
 * `guardedFetch`; an automated eval run must not do that.
 *
 * **This harness records it, rather than allowing it.** Both are legitimate
 * per the brief; recording is the one consistent with the rest of this file
 * and with `evals/README.md`'s stated policy — "nothing in the case set
 * depends on the assistant reading a page" (the same reasoning that already
 * kept the old provider-native `web_search`/`web_fetch` out of every case).
 * Recording, not just omitting, is necessary here in a way it never was for
 * those: `web_search`/`web_fetch` were added directly in the chat route,
 * outside `CAPABILITIES`, so `composeCase` never saw them. `read_page` is a
 * capability tool, so it *is* in `CAPABILITIES` and would otherwise reach a
 * real host on every run that calls it.
 */
const LIVE_NETWORK_TOOLS: readonly string[] = ["read_page"];

/**
 * Replace `read_page`'s behavior with a recorded no-op, the same shape
 * `stubWrites` gives a write tool — see {@link LIVE_NETWORK_TOOLS}. Every other
 * `read` tool (catalogue lookups) is untouched.
 */
export function stubLiveReads(capabilities: Capability[] = CAPABILITIES): Capability[] {
  return capabilities.map((capability) => ({
    ...capability,
    tools: capability.tools.map((capTool) => {
      if (!LIVE_NETWORK_TOOLS.includes(capTool.name)) return capTool;
      return {
        ...capTool,
        run: async (input: unknown) => ({
          stubbed: true,
          tool: capTool.name,
          input,
          message: "Recorded (eval harness stub — no page was actually read).",
        }),
      };
    }),
  }));
}

/** What the assistant is given for one case. */
export interface ComposedCase {
  system: string;
  tools: Record<string, Tool>;
}

/**
 * Build the system prompt and tool set for a case, exactly as the chat route
 * would for a student asking the same question from the same page.
 */
export async function composeCase(evalCase: EvalCase): Promise<ComposedCase> {
  const tools = await getCatalogTools();
  const focused = evalCase.context.toolId
    ? await getCatalogTool(evalCase.context.toolId)
    : null;
  if (evalCase.context.toolId && !focused) {
    throw new Error(
      `case "${evalCase.id}" focuses toolId "${evalCase.context.toolId}", which is not in the fixture catalog`
    );
  }

  // A curation case (refresh research spec §12): the tool's record, as the
  // chat route loads it for staff; `propose_change` is a write and is stubbed.
  const curation = evalCase.context.curate && focused ? await curationFor(focused.id) : null;
  const identity = evalCase.context.as ? evalIdentity(evalCase.context.as) : undefined;
  const ctx: CapabilityCtx = {
    locale: "en",
    focusedToolId: focused?.id,
    ...(curation ? { curation } : {}),
    ...(identity ? { identity } : {}),
  };
  // The focused tool's searchable manuals, as the chat route loads them — the
  // eval's fixture manual (`manual-fixture.ts`) once `npm run eval` seeded it,
  // nothing offline. `search_manual` itself stays live: it reads the eval's
  // own PGlite database and nothing else.
  const manualOutlines = focused ? (await loadToolManualsForChat(focused.id, null)).outlines : [];
  const capabilities = curation ? [...CAPABILITIES, curationCapability("tool")] : CAPABILITIES;
  // A case that names its caller gets that caller's registry, through the same
  // `capabilitiesForIdentity` the route uses; one that does not keeps the
  // historical, unfiltered composition.
  const permitted = identity ? capabilitiesForIdentity(capabilities, identity) : capabilities;
  const composed = composeChat(stubLiveReads(stubWrites(permitted)), ctx, {
    tools,
    focusedTool: focused,
    locale: "en",
    manualOutlines,
    ...(curation ? { curation } : {}),
  });

  return { system: composed.system, tools: composed.tools };
}

/**
 * The signed-in person a case asks as: the demo seed's student or SuperMaker,
 * as `resolveIdentity` would return them. Writes are stubbed, so the ids are
 * only ever read.
 */
export function evalIdentity(caller: EvalCaller): Identity {
  const account = caller === "staff" ? DEMO_ACCOUNTS.admin : DEMO_ACCOUNTS.user;
  return {
    role: account.role,
    userId: account.id,
    email: account.email,
    name: account.name,
    rateLimitKey: account.id,
  };
}

/** The conversation a case sends: its history, oldest first, then its prompt. */
export function caseMessages(evalCase: EvalCase): ModelMessage[] {
  const turns: EvalTurn[] = [...(evalCase.history ?? []), { role: "user", text: evalCase.prompt }];
  return turns.map((turn): ModelMessage =>
    turn.role === "user" ? { role: "user", content: turn.text } : { role: "assistant", content: turn.text }
  );
}

/** The focused tool's record for a curation case, shaped as the chat route shapes it. */
async function curationFor(toolId: string): Promise<CurationContext | null> {
  const subject = await loadCurationSubject("tool", toolId);
  if (!subject) return null;
  return {
    kind: "tool",
    id: subject.id,
    name: subject.name,
    revision: subject.revision,
    fields: recordFields(subject.record),
    sources: subject.sources,
  };
}

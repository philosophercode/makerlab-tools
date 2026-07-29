import {
  CAPABILITIES,
  composeChat,
  type Capability,
  type CapabilityCtx,
} from "@/lib/capabilities";
import { getCatalogTool, getCatalogTools } from "@/lib/catalog";
import type { Tool } from "ai";
import type { EvalCase } from "./cases";

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
 * cannot write anything. The `card` renderer is dropped with it, since it
 * expects the real result shape.
 */
export function stubWrites(capabilities: Capability[] = CAPABILITIES): Capability[] {
  return capabilities.map((capability) => ({
    ...capability,
    tools: capability.tools.map((capTool) => {
      if (capTool.kind !== "write") return capTool;
      return {
        ...capTool,
        card: undefined,
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

  const ctx: CapabilityCtx = { locale: "en", focusedToolId: focused?.id };
  const composed = composeChat(stubWrites(CAPABILITIES), ctx, {
    tools,
    focusedTool: focused,
    locale: "en",
  });

  return { system: composed.system, tools: composed.tools };
}

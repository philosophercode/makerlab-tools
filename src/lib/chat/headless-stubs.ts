import { CAPABILITIES, type Capability, type CapabilityCtx } from "../capabilities";
import { TAINT_REFUSED_RISKS } from "../actions/proposals";
import { ACTION_DEFINITIONS } from "../actions/registry";

/**
 * The assistant run without a person on the other end: the agent evals
 * (`evals/harness.ts`) and the starter-answer runner (`lib/starters/answer.ts`)
 * compose the chat exactly as `/api/chat` does, then swap what must not
 * happen headlessly — a write, a live page read — for a recorded no-op.
 * Moved here from the eval harness so the app's own runner shares them.
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
      // An action tool only ever proposes (assistant–GUI parity spec §3.4);
      // its stub answers the way the real one does, so the model is judged on
      // what it says after a real proposal.
      if (capability.id === "actions") {
        const risk = ACTION_DEFINITIONS.find((def) => def.toolName === capTool.name)?.risk;
        return {
          ...capTool,
          // A turn that read outside content may not propose people or
          // destructive changes (§8.4) — the real tool refuses before storing
          // anything, and so does this stub, from the same turn state.
          run: async (input: unknown, ctx?: CapabilityCtx) =>
            ctx?.turn?.readOutside && risk && TAINT_REFUSED_RISKS.includes(risk)
              ? {
                  proposed: false,
                  stubbed: true,
                  code: "tainted_turn",
                  message:
                    "This turn read content from outside the lab, so it may not propose changes to people or anything that cannot be undone. Nothing was proposed or changed. Ask the person to repeat the request in a new message.",
                }
              : {
                  proposed: true,
                  stubbed: true,
                  tool: capTool.name,
                  count: 1,
                  input,
                  message:
                    "A confirmation card is now in front of the person. NOTHING HAS CHANGED YET: it changes only if they press Confirm on the card. Say so in one short line and point them to the card; never say it is done.",
                },
        };
      }
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

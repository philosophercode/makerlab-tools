import { z } from "zod";
import { getCatalogTool, getCatalogTools } from "../catalog";
import type { ImageThumbnails } from "../images/thumbnail-urls";
import { findTool } from "./helpers";
import type { Capability, CapabilityCtx, CapabilityTool } from "./types";
import type { MakerLabTool, ToolStatus } from "../../components/catalog-types";

/**
 * The `tool-cards` capability (assistant–GUI parity spec, amendment
 * 2026-10-07 "Images in the chat"): the lab's own photo of the machine an
 * answer is about.
 *
 * `show_tool` resolves up to three **published** tools — by id, slug or name —
 * and writes one `data-tool-cards` part, which `ChatMessage` draws as a small
 * card per tool under the answer: the catalogue image (its pre-rendered
 * thumbnails), the name, the category, the status and a link to the tool's
 * page (`components/chat/ChatToolCards.tsx`).
 *
 * - **Real images only.** Every picture is the tool's own catalogue image, read
 *   from the database by the server; nothing the model writes becomes an image
 *   URL, and nothing is fetched from the web.
 * - **A read, for everybody**, anonymous visitors included; it records nothing
 *   and returns only catalogue data, so it does not taint a turn.
 * - **Published tools only, for staff too**: a card links to the tool's public
 *   page, and a draft has none.
 * - **Not the tool on screen.** The tool whose page the person is on is
 *   skipped: the page already shows it.
 * - **Once per reply**, at most {@link MAX_TOOL_CARDS} tools: counted here (one
 *   step can hold parallel calls) and withdrawn by the route's `prepareStep`.
 * - **Chat only.** A card has no meaning over MCP, where `get_tool_details`
 *   already returns the tool's page.
 */

export const SHOW_TOOL_TOOL = "show_tool";

/** Tools one card row may show: a comparison of three is the most that reads well. */
export const MAX_TOOL_CARDS = 3;

const input = z.object({
  tools: z
    .array(z.string().max(200))
    .min(1)
    .max(MAX_TOOL_CARDS)
    .describe("The tools' slugs (from the catalog list), ids or names — at most three."),
});
type Input = z.infer<typeof input>;

/** One card (`data-tool-cards`). Every field comes from the catalogue row. */
export interface ChatToolCard {
  slug: string;
  name: string;
  category: string;
  status: ToolStatus;
  /** The original image, or "" when the tool has none (the card shows its initials). */
  imageSrc: string;
  thumbnails: ImageThumbnails | null;
}

/** The chat part's payload. */
export interface ToolCardsPayload {
  kind: "tool-cards";
  tools: ChatToolCard[];
}

type Skip = { asked: string; reason: "not_found" | "on_its_page" };

interface Result {
  shown: { name: string; slug: string }[];
  skipped: Skip[];
  message: string;
}

export function toChatToolCard(tool: MakerLabTool): ChatToolCard {
  return {
    slug: tool.slug,
    name: tool.name,
    category: tool.categorySub || tool.category,
    status: tool.status,
    imageSrc: tool.imageSrc,
    thumbnails: tool.thumbnails ?? null,
  };
}

async function resolvePublishedTool(needle: string, catalog: () => Promise<MakerLabTool[]>): Promise<MakerLabTool | null> {
  return (await getCatalogTool(needle)) ?? findTool(await catalog(), needle);
}

/**
 * Calls taken per turn, keyed on the turn's `ctx` (built once per request by
 * the chat adapter), so the count lives exactly as long as the turn.
 */
const callsThisTurn = new WeakMap<CapabilityCtx, number>();

export const showTool: CapabilityTool<Input, Result> = {
  name: SHOW_TOOL_TOOL,
  description:
    "Show the lab's own catalogue photo of one to three tools as small cards with your answer, each with its status and a link to its page. Use it when the answer is about a specific tool or compares two or three; not for list answers, and not for the tool whose page the person is on.",
  inputSchema: input,
  kind: "read",
  chatOnly: true,
  async run({ tools: asked }, ctx) {
    const taken = callsThisTurn.get(ctx) ?? 0;
    if (taken >= 1) {
      return { shown: [], skipped: [], message: "The cards are already shown for this reply. Do not call show_tool again." };
    }
    callsThisTurn.set(ctx, taken + 1);

    // One catalogue read, shared by every name that needs a search.
    let catalog: Promise<MakerLabTool[]> | null = null;
    const loadCatalog = () => (catalog ??= getCatalogTools());

    const cards: ChatToolCard[] = [];
    const skipped: Skip[] = [];
    for (const raw of asked.slice(0, MAX_TOOL_CARDS)) {
      const needle = raw.trim();
      if (!needle) continue;
      const tool = await resolvePublishedTool(needle, loadCatalog);
      if (!tool) {
        skipped.push({ asked: needle.slice(0, 80), reason: "not_found" });
        continue;
      }
      if (tool.id === ctx.focusedToolId) {
        skipped.push({ asked: needle.slice(0, 80), reason: "on_its_page" });
        continue;
      }
      if (!cards.some((card) => card.slug === tool.slug)) cards.push(toChatToolCard(tool));
    }

    if (cards.length === 0) {
      return {
        shown: [],
        skipped,
        message: skipped.some((s) => s.reason === "on_its_page")
          ? "That is the tool whose page the person is on; the page already shows it."
          : "No published tool matches. Only published tools have cards.",
      };
    }

    const payload: ToolCardsPayload = { kind: "tool-cards", tools: cards };
    ctx.writer?.write({ type: "data-tool-cards", id: `tool-cards-${cards.map((c) => c.slug).join("-")}`, data: payload });
    return {
      shown: cards.map((card) => ({ name: card.name, slug: card.slug })),
      skipped,
      message: "The cards are shown with your answer. Do not describe the photos or paste image links.",
    };
  },
};

const TOOL_CARDS_SECTION = `## Showing a tool\n\nWhen your answer is about one specific tool, or compares two or three, call \`${SHOW_TOOL_TOOL}\` with their slugs from the catalog list, in the same step as your other lookups so it adds no wait. The chat shows each tool's catalogue photo, status and a link to its page as a small card beside your answer, so do not paste image links or describe the picture. Do not call it for list answers ("what 3D printers do you have?"), for general questions that are not about a particular machine, or for the tool whose page the person is on: the page already shows it. Once per reply. These photos are the lab's own catalogue images; never present any other picture as one of the lab's machines.`;

export const toolCards: Capability = {
  id: "tool-cards",
  promptFragment: () => TOOL_CARDS_SECTION,
  tools: [showTool as CapabilityTool<unknown, unknown>],
};

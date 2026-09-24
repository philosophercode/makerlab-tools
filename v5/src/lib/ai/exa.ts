import type { Tool } from "ai";
import type { ImageHint } from "../web/read-page.ts";
import { gatewayProvider } from "./models.ts";
import { countToolCalls, isPart, type StepLike } from "./tool-caps.ts";

export type { StepLike } from "./tool-caps.ts";

/**
 * Web search through the Gateway: Exa, as a provider-executed tool any model can
 * call (gateway spec §3.2). It replaces Anthropic's `web_search`, which only
 * Anthropic models had.
 *
 * The Gateway runs the search and feeds the result back to the model itself, so
 * our process sees one request per model step; the calls and their results
 * still come back in that step's `toolCalls` / `toolResults`, which is what the
 * caps and the image hints below read.
 *
 * Plain Node: step code imports this.
 */

/** The key every tools record uses, and the name the Gateway reports calls under. */
export const EXA_SEARCH_TOOL = "exa_search";

/**
 * The tools are typed as `ai`'s own `Tool`. `exaSearch` exists only in the
 * top-level `@ai-sdk/gateway` (3.0.160; the copy nested under `ai` predates it),
 * and that package brings its own `@ai-sdk/provider-utils`, whose `Schema`
 * carries a unique symbol `ai`'s copy does not — so, to the type checker, its
 * tool does not fit a `generateText` tools record, though at runtime it is
 * exactly what `generateText` expects (`gateway-wire.test.ts` proves the round
 * trip). The cast lives here once instead of at every call site; it can go when
 * the two packages share one `provider-utils` again.
 */
function asAiTool(tool: unknown): Tool {
  return tool as Tool;
}

/** Chat's search: five results, highlights only. Capped at `CHAT_MAX_EXA_SEARCHES` per turn. */
export function chatExaSearch(): Tool {
  return asAiTool(gatewayProvider().tools.exaSearch({ numResults: 5, contents: { highlights: true } }));
}

/**
 * The most page text Exa returns per research result. Enough for a product
 * page's specs table (bambulab.com's X2D specs page is about 9k characters of
 * text), small enough that six results a search stay a modest prompt.
 */
export const RESEARCH_EXA_TEXT_MAX_CHARS = 12_000;

/**
 * Research's search: six results, highlights, **each page's text** (at most
 * {@link RESEARCH_EXA_TEXT_MAX_CHARS}), and up to three image links per result —
 * the top-up the image stage uses when the pages research reads declare fewer
 * than three images (§3.5). Capped at `RESEARCH_MAX_WEB_SEARCHES` per item.
 * `numResults` is enforced by the Gateway whatever the model asks for (Phase 0).
 *
 * The text is the read step's fallback (amendment "Search text fallback and
 * confidence cap"): a manufacturer site that answers our server-side reader
 * with a bot challenge (bambulab.com, 403) is still a page Exa has read, and
 * {@link exaPageTexts} carries that copy on to the read step.
 */
export function researchExaSearch(): Tool {
  return asAiTool(
    gatewayProvider().tools.exaSearch({
      numResults: 6,
      contents: {
        text: { maxCharacters: RESEARCH_EXA_TEXT_MAX_CHARS },
        highlights: true,
        extras: { imageLinks: 3 },
      },
    })
  );
}

/** One search result's page text, as Exa captured it. */
export interface SearchPageText {
  url: string;
  title: string | null;
  text: string;
}

/**
 * Every page text Exa returned across `steps`, in the order the results came
 * back, one per URL (the first, which is also the longest-standing). http(s)
 * only; results with no text (a chat search, or an Exa error) give nothing.
 * Capped again at {@link RESEARCH_EXA_TEXT_MAX_CHARS}: Exa's own cap is a
 * request, not something this code has seen enforced.
 */
export function exaPageTexts(steps: readonly StepLike[]): SearchPageText[] {
  const texts: SearchPageText[] = [];
  const seen = new Set<string>();
  for (const output of exaOutputs(steps)) {
    for (const result of resultsOf(output)) {
      const url = httpUrl(result.url);
      const text = typeof result.text === "string" ? result.text.trim() : "";
      if (!url || !text || seen.has(url)) continue;
      seen.add(url);
      const title = typeof result.title === "string" && result.title.trim() ? result.title.trim() : null;
      texts.push({ url, title, text: text.slice(0, RESEARCH_EXA_TEXT_MAX_CHARS) });
    }
  }
  return texts;
}

/** How many Exa searches `steps` made. */
export function countExaCalls(steps: readonly StepLike[]): number {
  return countToolCalls(steps, EXA_SEARCH_TOOL);
}

/**
 * The images Exa reported across `steps`: each result's own `image`, then its
 * `extras.imageLinks`, in the order the results came back. http(s) only,
 * de-duplicated, each attributed to the page it came from.
 *
 * Exa has been seen returning image links with HTML-escaped ampersands
 * (`&amp;w=3840`) — the URL as it appeared in the page's markup, not the URL.
 * They are unescaped here, because the escaped form names a different resource.
 */
export function exaImageHints(steps: readonly StepLike[]): ImageHint[] {
  const hints: ImageHint[] = [];
  const seen = new Set<string>();

  const add = (raw: unknown, pageUrl: string | null) => {
    const url = httpUrl(raw);
    if (!url || seen.has(url)) return;
    seen.add(url);
    hints.push({ url, source: "exa", pageUrl });
  };

  for (const output of exaOutputs(steps)) {
    for (const result of resultsOf(output)) {
      const pageUrl = httpUrl(result.url);
      add(result.image, pageUrl);
      const links = (result.extras as { imageLinks?: unknown } | undefined)?.imageLinks;
      if (Array.isArray(links)) for (const link of links) add(link, pageUrl);
    }
  }
  return hints;
}

/**
 * Every result Exa returned across `steps`, as the text the model was shown of
 * it: its title, its highlights (chat's search) and its text (research's), one
 * entry per URL. A curation turn checks quotes against these (refresh research
 * spec §12.2) and lets `read_page` open their hosts (§12.1).
 */
export function exaResultTexts(steps: readonly StepLike[]): SearchPageText[] {
  const out: SearchPageText[] = [];
  const seen = new Set<string>();
  for (const output of exaOutputs(steps)) {
    for (const result of resultsOf(output)) {
      const url = httpUrl(result.url);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const title = typeof result.title === "string" && result.title.trim() ? result.title.trim() : null;
      const highlights = Array.isArray(result.highlights) ? result.highlights.filter((h): h is string => typeof h === "string") : [];
      const text = typeof result.text === "string" ? result.text : "";
      out.push({ url, title, text: [title ?? "", ...highlights, text].filter(Boolean).join("\n").slice(0, RESEARCH_EXA_TEXT_MAX_CHARS) });
    }
  }
  return out;
}

function* exaOutputs(steps: readonly StepLike[]): Generator<unknown> {
  for (const step of steps) {
    if (step.toolResults) {
      for (const result of step.toolResults) {
        if (result.toolName === EXA_SEARCH_TOOL) yield result.output;
      }
      continue;
    }
    for (const part of step.content ?? []) {
      if (isPart(part, "tool-result") && part.toolName === EXA_SEARCH_TOOL) yield part.output;
    }
  }
}

/** The `results` of an Exa response; nothing for an Exa error or anything else. */
function resultsOf(output: unknown): Record<string, unknown>[] {
  if (typeof output !== "object" || output === null) return [];
  const results = (output as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  return results.filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null);
}

function httpUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().replace(/&amp;/g, "&");
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

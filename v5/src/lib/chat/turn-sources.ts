import type { ReadText } from "../refresh/citations";

/**
 * What the assistant read in **this chat turn** (refresh research spec §12.1,
 * §12.2): the text of every page `read_page` opened, every Exa result, every
 * manual passage `search_manual` returned. A curation turn verifies each quote
 * of `propose_change` against exactly these — a quote that is not on a page
 * read this turn is shown unverified — and lets `read_page` open the hosts the
 * turn's searches returned.
 *
 * Keyed on the turn's `CapabilityCtx`, which the chat route builds once per
 * request and hands to every tool — so the record lives exactly as long as the
 * turn (the `read_page` cap's idiom), and a WeakMap lets it go with it.
 */

interface TurnSources {
  texts: ReadText[];
  hosts: Set<string>;
}

const turns = new WeakMap<object, TurnSources>();

function sourcesOf(turn: object): TurnSources {
  let sources = turns.get(turn);
  if (!sources) {
    sources = { texts: [], hosts: new Set() };
    turns.set(turn, sources);
  }
  return sources;
}

/** Record a page's text as read this turn. */
export function recordTurnText(turn: object, url: string, text: string): void {
  if (!text) return;
  sourcesOf(turn).texts.push({ url, text });
}

/** Record a host this turn's searches returned, so `read_page` may open it in a curation turn. */
export function recordTurnHost(turn: object, url: string): void {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
    if (host) sourcesOf(turn).hosts.add(host);
  } catch {
    // Not a URL: nothing to allow.
  }
}

export function turnTexts(turn: object): readonly ReadText[] {
  return turns.get(turn)?.texts ?? [];
}

export function turnHosts(turn: object): string[] {
  return [...(turns.get(turn)?.hosts ?? [])];
}

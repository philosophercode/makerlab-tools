import { findStoredManualForTool, type StoredManualText } from "../data/manual-documents.ts";
import type { Db } from "../db/types.ts";
import { RESEARCH_MANUAL_TEXT_MAX_CHARS } from "../intake/limits.ts";
import { formatOutline, manualDigest, OUTLINE_SHARE } from "../manuals/digest.ts";
import { searchManuals, type ManualPassage } from "../manuals/search.ts";
import type { ToolManualPage } from "../research/engine.ts";

/**
 * What refresh research's read step is given of the tool's own manual (manual
 * text spec §3.7 and its amendments; refresh research spec §3.1).
 *
 * When the tool has a processed manual, the read model gets **its outline plus
 * the passages retrieved for a fixed set of queries** — the ones a listing is
 * built from — within the same 16,000-character manual budget every other
 * manual gets (`RESEARCH_MANUAL_TEXT_MAX_CHARS`). "Safety warnings" is among
 * them **as context only**: its passages are labelled so, and PPE is still
 * never proposed (research leaves `ppeRequired` empty whatever it reads).
 *
 * The passages come from the hybrid search (`manuals/search.ts`, scoped to the
 * tool, as lab staff — private manuals included: this is background research
 * for the people who may read them). A manual with text but no passages yet
 * (embedding pending, or the embedding call failing) falls back to phase 1's
 * `manualDigest` — the outline and the pages richest in specs — so the stored
 * text is used either way.
 *
 * Nothing here fails a refresh: a database or search error is "no manual", and
 * research goes on with the web.
 *
 * Plain Node: step code imports it.
 */

/** The fixed queries (§3.7), in the order their passages are given. */
export const REFRESH_MANUAL_QUERIES = [
  "specifications",
  "technical data",
  "dimensions",
  "materials",
  "getting started",
  "safety warnings",
] as const;

/** The query whose passages are context only (§3.7: "the last only as context"). */
const CONTEXT_ONLY_QUERY = "safety warnings";

/** Passages asked for per query; the budget decides how many are kept. */
const PASSAGES_PER_QUERY = 4;

/** Search as lab staff: private and hidden manuals included (spec §8 of the manual text spec). */
const STAFF_VIEWER = { role: "admin" as const };

export interface ToolManualContext extends ToolManualPage {
  /** `passages` when the text came from search, `digest` when from the stored pages. */
  mode: "passages" | "digest";
}

type Search = typeof searchManuals;

/**
 * The tool's manual as one read-step page, or null when it has no processed
 * manual. `search` is injectable for tests.
 */
export async function toolManualContext(
  db: Db,
  toolId: string,
  options: { search?: Search; maxChars?: number } = {}
): Promise<ToolManualContext | null> {
  const maxChars = options.maxChars ?? RESEARCH_MANUAL_TEXT_MAX_CHARS;
  let stored: StoredManualText | null;
  try {
    stored = await findStoredManualForTool(db, toolId);
  } catch {
    return null;
  }
  if (!stored) return null;
  const url = stored.urls?.[0];
  if (!url) return null;

  const passages = await searchPassages(db, toolId, stored.documentId, options.search ?? searchManuals);
  const text = passages.length > 0 ? passagesText(stored, passages, maxChars) : manualDigest(stored, maxChars);
  if (!text.trim()) return null;
  return {
    url,
    title: stored.title,
    text,
    urls: stored.urls ?? [url],
    mode: passages.length > 0 ? "passages" : "digest",
  };
}

interface TaggedPassage {
  passage: ManualPassage;
  contextOnly: boolean;
}

/** Every fixed query's passages from this document, each once, first query first. */
async function searchPassages(db: Db, toolId: string, documentId: string, search: Search): Promise<TaggedPassage[]> {
  const out: TaggedPassage[] = [];
  const seen = new Set<string>();
  for (const query of REFRESH_MANUAL_QUERIES) {
    let passages: ManualPassage[];
    try {
      passages = (await search(db, { query, toolIds: [toolId], limit: PASSAGES_PER_QUERY, viewer: STAFF_VIEWER })).passages;
    } catch {
      return out;
    }
    for (const passage of passages) {
      if (passage.documentId !== documentId) continue;
      const key = `${passage.pageStart}:${passage.ordinals.join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ passage, contextOnly: query === CONTEXT_ONLY_QUERY });
    }
  }
  return out;
}

/**
 * "Contents:" and the outline (at most a quarter of the budget, as the digest
 * does), then the passages — spec-like queries first, each headed with its
 * pages and section — until the budget is spent. A passage that does not fit
 * whole is left for a smaller one.
 */
export function passagesText(stored: Pick<StoredManualText, "outline">, passages: readonly TaggedPassage[], maxChars: number): string {
  const parts: string[] = [];
  let budget = maxChars;
  if (stored.outline.length > 0) {
    const outline = formatOutline(stored.outline, Math.floor(maxChars * OUTLINE_SHARE));
    if (outline) {
      const block = `Contents:\n${outline}`;
      parts.push(block);
      budget -= block.length + 2;
    }
  }
  for (const { passage, contextOnly } of passages) {
    if (budget <= 200) break;
    const pages = passage.pageEnd > passage.pageStart ? `pages ${passage.pageStart}–${passage.pageEnd}` : `page ${passage.pageStart}`;
    const section = passage.sectionPath.length > 0 ? ` — ${passage.sectionPath.join(" › ")}` : "";
    const note = contextOnly ? " (safety context only — staff set protective equipment; do not propose PPE)" : "";
    const block = `[${pages}${section}]${note}\n${passage.content.trim()}`;
    if (block.length + 2 > budget) continue;
    parts.push(block);
    budget -= block.length + 2;
  }
  return parts.join("\n\n");
}

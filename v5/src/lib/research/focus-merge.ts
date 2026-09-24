import { scoreConfidence } from "../capabilities/confidence.ts";
import type { IntakeEvidence } from "../capabilities/types.ts";
import { focusIncludes, type ResearchFocus, type ResearchFocusField } from "../intake/research-focus.ts";
import type { ResearchResult } from "./result.ts";

/**
 * How a **Research again** result lands on the result it replaces (amendment
 * "Guided redo (focus + guidance)"). Pure: `completeResearch` calls it inside
 * the transaction that writes the row, with the stored result it read `for
 * update`.
 *
 * **Everything** (`focus` null) is what research always did: the new result
 * replaces the old one whole. It only gains the bookkeeping — which sections
 * came out different, and the name it was researched as.
 *
 * **A scoped redo merges.** It starts from the *previous* result and takes from
 * the new one only the focused fields; every other field — the name, category,
 * materials, tags, training, restrictions, notes, the images unless they were
 * focused — stays exactly as it was stored:
 *
 * | Focus | Taken from the new run |
 * |---|---|
 * | `description` | `description`, `starterQuestions` |
 * | `specs` | `specs`; `evidence.specsFromSource` |
 * | `links` | `resources`, `droppedLinks`; `evidence.manualFound` |
 * | `image` | `images`, `imageError` (and the old `imageRetry` is dropped) |
 *
 * **The evidence rule.** Only specs and links are evidence-bearing: each flag
 * above is *replaced* by the new run's, because the list it vouches for was
 * replaced. For those two, the pages the new run read join `sourceUrls` (and
 * `searchTextSources`) — the new specs or links came from them — and
 * `manufacturerPageFound` is the old flag *or* the new one, since both runs'
 * pages are now among the sources. A description or an image is not evidence
 * of anything the grade rests on, so a redo of only those leaves `evidence`,
 * `sourceUrls` and `confidence` untouched. **Confidence is recomputed only when
 * the merged evidence or sources differ from the stored ones**
 * (`scoreConfidence(evidence, { sourceUrls })`, the same call research makes);
 * otherwise the stored grade is kept as it was.
 *
 * **The name the reviewer saved wins.** The item's saved name and brand are
 * recorded on every result as `researchedAs`. A scoped redo keeps the old
 * `canonicalName` unless the saved name or brand has changed since the old
 * result was written, in which case the saved name is used — the reviewer
 * corrected it, and a redo of the specs must not put the old one back.
 *
 * Either way `updated` records which of the four sections now read differently
 * from before (for the page's "Updated just now"), and `redoRequest` — the
 * marker the press left on the old result — is gone.
 */

const MAX_SOURCE_URLS = 20;

export interface MergeInput {
  /** The stored result the redo replaces; null when the item had none. */
  previous: ResearchResult | null;
  /** What this run produced, whole. */
  next: ResearchResult;
  /** The run's focus; null is everything. */
  focus: ResearchFocus;
  /** The item's name and brand as saved on the row now. */
  saved: { name: string; brand: string | null };
  /** When the result is written, ISO 8601. */
  at: string;
}

export function mergeResearch({ previous, next, focus, saved, at }: MergeInput): ResearchResult {
  const researchedAs = { name: saved.name, brand: saved.brand };
  if (!previous) return withoutRedo({ ...next, researchedAs });
  if (!focus) {
    return withoutRedo({ ...next, researchedAs, updated: { at, sections: changedSections(previous, next, null) } });
  }

  const merged: ResearchResult = { ...previous };
  const evidence: IntakeEvidence = { ...previous.evidence };
  let sourceUrls = previous.sourceUrls;
  let searchTextSources = previous.searchTextSources;

  if (focus.includes("description")) {
    merged.description = next.description;
    // The starter chips are written from the description, and redone with it
    // (amendment "Tool-specific starter questions"). A run that proposed none
    // keeps the stored ones rather than taking the chips away.
    if (next.starterQuestions && next.starterQuestions.length > 0) merged.starterQuestions = next.starterQuestions;
  }
  if (focus.includes("specs")) {
    merged.specs = next.specs;
    evidence.specsFromSource = next.evidence.specsFromSource;
  }
  if (focus.includes("links")) {
    merged.resources = next.resources;
    merged.droppedLinks = next.droppedLinks;
    evidence.manualFound = next.evidence.manualFound;
  }
  if (focus.includes("specs") || focus.includes("links")) {
    evidence.manufacturerPageFound = previous.evidence.manufacturerPageFound || next.evidence.manufacturerPageFound;
    sourceUrls = union(previous.sourceUrls, next.sourceUrls).slice(0, MAX_SOURCE_URLS);
    const fromSearch = union(previous.searchTextSources ?? [], next.searchTextSources ?? []).filter((url) =>
      sourceUrls.includes(url)
    );
    searchTextSources = fromSearch.length > 0 ? fromSearch : undefined;
  }
  if (focus.includes("image")) {
    merged.images = next.images;
    merged.imageError = next.imageError;
    delete merged.imageRetry;
  }

  merged.evidence = evidence;
  merged.sourceUrls = sourceUrls;
  if (searchTextSources) merged.searchTextSources = searchTextSources;
  else delete merged.searchTextSources;
  if (!sameJson(evidence, previous.evidence) || !sameJson(sourceUrls, previous.sourceUrls)) {
    merged.confidence = scoreConfidence(evidence, { sourceUrls });
  }

  merged.canonicalName = nameChangedSince(previous, saved) ? saved.name : previous.canonicalName;
  merged.researchedAs = researchedAs;
  merged.researchFocus = [...focus];
  if (next.reviewerNote) merged.reviewerNote = next.reviewerNote;
  else delete merged.reviewerNote;
  merged.updated = { at, sections: changedSections(previous, merged, focus) };
  return withoutRedo(merged);
}

/**
 * The sections of `next` that read differently from `previous`, among those
 * the focus touched (all four for everything).
 */
export function changedSections(
  previous: ResearchResult,
  next: ResearchResult,
  focus: ResearchFocus
): ResearchFocusField[] {
  const sections: ResearchFocusField[] = [];
  if (focusIncludes(focus, "description") && previous.description !== next.description) sections.push("description");
  if (focusIncludes(focus, "specs") && !sameJson(previous.specs, next.specs)) sections.push("specs");
  if (focusIncludes(focus, "links") && !sameJson(previous.resources, next.resources)) sections.push("links");
  if (focusIncludes(focus, "image") && !sameJson(previous.images ?? null, next.images ?? null)) sections.push("image");
  return sections;
}

/** The saved name or brand moved after `previous` was written. Unknown (an older row) is "no". */
function nameChangedSince(previous: ResearchResult, saved: { name: string; brand: string | null }): boolean {
  const was = previous.researchedAs;
  if (!was) return false;
  return was.name !== saved.name || (was.brand ?? null) !== (saved.brand ?? null);
}

function withoutRedo(result: ResearchResult): ResearchResult {
  const out = { ...result };
  delete out.redoRequest;
  return out;
}

function union(a: readonly string[], b: readonly string[]): string[] {
  return [...new Set([...a, ...b])];
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

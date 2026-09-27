import type { IntakeConfidenceLevel } from "../capabilities/types.ts";
import type { ImageHint } from "../web/read-page.ts";
import type { SearchFindings } from "./model-output.ts";
import type { SearchPageText } from "./search-text.ts";
import type { ResearchResult } from "./result.ts";

/**
 * What the research workflow's steps hand each other (gateway spec §3.5, §5.1).
 *
 * Types only, in their own module, so the workflow (`research-batch.ts`), the
 * search and read steps (`steps.ts`) and the image stage (`image-steps.ts`) all
 * agree on one declaration without importing each other's step code. Every
 * value here crosses a step boundary, so it is serialised: plain data, no class
 * instances, no bytes.
 *
 * Plain Node: step code imports this (type-only, so it costs nothing at runtime).
 */

export type { ImageHint } from "../web/read-page.ts";
export type { SearchPageText } from "./search-text.ts";

/**
 * Step 1: skipped (the row is no longer this run's), or what the search settled
 * plus Exa's images and the page texts Exa captured for the pages worth reading
 * — the read step's fallback for a page the server cannot open. `searchTexts`
 * is optional so a run started before it existed still replays.
 */
export type SearchStepResult =
  | { skip: true }
  | { skip: false; findings: SearchFindings; exaImages: ImageHint[]; searchTexts?: SearchPageText[] };

/**
 * Step 2: the drafted result — assembled and verified, **not yet written** — and
 * the images the pages it read declared; or skipped, when the row was taken
 * away mid-run.
 */
export type ReadStepResult =
  | { outcome: "skipped" }
  | { outcome: "drafted"; result: ResearchResult; imageHints: ImageHint[] };

/** Step 3 (the image stage, or its fallback): the item is written, or it was not this run's to write. */
export type ItemStepResult =
  | { outcome: "researched"; confidence: IntakeConfidenceLevel }
  | { outcome: "skipped" };

/** What the batch reports once every item has settled. No names, no people. */
export interface BatchSummary {
  researched: number;
  failed: number;
  skipped: number;
}

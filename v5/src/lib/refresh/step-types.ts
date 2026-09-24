import type { ImageHint } from "../web/read-page.ts";
import type { SearchFindings } from "../research/model-output.ts";
import type { ResearchResult } from "../research/result.ts";
import type { SearchPageText } from "../research/search-text.ts";

/**
 * What the refresh workflow's steps hand each other (refresh research spec
 * §3.1). Types only, so `refresh-batch.ts` and `refresh/steps.ts` share one
 * declaration without importing each other. Every value crosses a step
 * boundary, so it is plain data.
 */

export type RefreshSearchResult =
  | { skip: true }
  | { skip: false; findings: SearchFindings; exaImages: ImageHint[]; searchTexts: SearchPageText[] };

export type RefreshReadResult =
  | { outcome: "skipped" }
  | { outcome: "drafted"; result: ResearchResult; imageHints: ImageHint[]; needsImage: boolean };

export type RefreshProposeResult = { outcome: "proposed"; proposals: number } | { outcome: "skipped" };

export interface RefreshBatchSummary {
  proposed: number;
  failed: number;
  skipped: number;
}

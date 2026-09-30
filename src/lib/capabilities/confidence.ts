import { isVideoUrl } from "../research/source-pages.ts";
import type {
  IntakeConfidence,
  IntakeConfidenceLevel,
  IntakeEvidence,
} from "./types";

/**
 * Intake confidence scoring (confidence spec §3.1).
 *
 * **Confidence is computed here, never asked of the model.** A model's own
 * "how sure are you" number is badly calibrated in exactly the way that hurts —
 * it peaks when the model is fluently wrong, so a hallucinated model number
 * scores 0.9. Deriving the grade from structured evidence also closes a
 * prompt-injection path (spec §8): a fetched manufacturer page that says
 * "mark this as high confidence" cannot move a score it never touches.
 *
 * The model's job is to *report what it found*, which it is reliable at. The
 * judgement about what that adds up to lives in this file, where it is a pure
 * function — testable, explainable, and tunable without editing a prompt.
 *
 * This module is pure and client-safe: the identification card imports
 * {@link confidenceLines} to render localized basis / unknown lines.
 */

// ── Evidence normalization ─────────────────────────────────────────

/** Evidence with nothing found — the floor every partial report starts from. */
const NO_EVIDENCE: IntakeEvidence = {
  userStatedModel: false,
  modelPlateRead: null,
  manufacturerPageFound: false,
  manualFound: false,
  specsFromSource: false,
  categoryOnly: false,
};

/**
 * Fill in whatever the model left out. Every default is the *absent* value, so
 * an under-reported turn grades down and produces a question rather than a
 * confident-looking card.
 */
export function toEvidence(
  partial?: Partial<IntakeEvidence> | null
): IntakeEvidence {
  const plate = partial?.modelPlateRead;
  return {
    ...NO_EVIDENCE,
    ...partial,
    // Empty / whitespace plate text is "couldn't read it", not "read it".
    modelPlateRead: typeof plate === "string" && plate.trim() ? plate.trim() : null,
  };
}

/** A make/model is pinned down — the user stated it, or a plate was legible. */
function modelIdentified(e: IntakeEvidence): boolean {
  return e.userStatedModel || e.modelPlateRead !== null;
}

/** Something external was actually fetched for this exact model. */
function externalSource(e: IntakeEvidence): boolean {
  return e.manufacturerPageFound || e.manualFound;
}

// ── What was read ──────────────────────────────────────────────────

/**
 * What research actually read, when the caller knows it — background research
 * does (`ResearchResult.sourceUrls`, the pages the server read). The chat's
 * identification card does not, and passes nothing: the cap below then never
 * applies.
 */
export interface ConfidenceReads {
  /** The pages read, video or not. */
  sourceUrls: readonly string[];
}

/** Why the grade is capped: only videos were read, or nothing was. */
export type ReadCap = "videoOnly" | "nothingRead";

/**
 * The cap on a grade whose research read no page (amendment "Search text
 * fallback and confidence cap"). The Bambu Lab X2D run read one YouTube video —
 * bambulab.com refused the rest — and still graded **high**, on the name the
 * user typed plus a manual link that passed link checking. Evidence that was
 * never read against a page cannot be high, however the flags add up:
 *
 * - `videoOnly` — every page read was a video;
 * - `nothingRead` — no page was read at all;
 * - null — a page that is not a video was read (or the caller cannot say).
 */
export function readCap(reads?: ConfidenceReads | null): ReadCap | null {
  if (!reads) return null;
  if (reads.sourceUrls.length === 0) return "nothingRead";
  return reads.sourceUrls.every((url) => isVideoUrl(url)) ? "videoOnly" : null;
}

// ── Level ──────────────────────────────────────────────────────────

/**
 * The rules, straight from spec §3.1:
 *
 * | Level  | When |
 * |--------|------|
 * | high   | model identified (stated or read) **and** a manufacturer page or manual fetched |
 * | medium | model identified but nothing external corroborates it, **or** a source was found but the exact variant is ambiguous |
 * | low    | category only, no model, or nothing external fetched |
 *
 * `categoryOnly` is treated as authoritative and caps the grade at low even if
 * other flags are set: "only the category was inferable" contradicts having a
 * model, and the safe reading of a contradiction is the one that asks a
 * question instead of writing a wrong record.
 *
 * `specsFromSource` alone corroborates specs but is not a page or a manual, so
 * it never reaches high on its own — it lifts a model-less candidate to medium
 * ("we read something, but which variant?").
 *
 * With `reads`, a result that read no page other than a video is **at most
 * medium** ({@link readCap}).
 */
export function confidenceLevel(e: IntakeEvidence, reads?: ConfidenceReads | null): IntakeConfidenceLevel {
  const level = levelFromEvidence(e);
  return level === "high" && readCap(reads) ? "medium" : level;
}

function levelFromEvidence(e: IntakeEvidence): IntakeConfidenceLevel {
  if (e.categoryOnly) return "low";
  if (modelIdentified(e)) {
    return externalSource(e) ? "high" : "medium";
  }
  if (externalSource(e) || e.specsFromSource) return "medium";
  return "low";
}

// ── Lines (basis / unknowns) ───────────────────────────────────────

/** Evidence we hold, one code per line. */
export type ConfidenceBasisCode =
  | "userStatedModel"
  | "modelPlateRead"
  | "manufacturerPage"
  | "manual"
  | "specsFromSource";

/** Evidence we lack, one code per line, phrased as the question that fixes it. */
export type ConfidenceUnknownCode =
  | "videoOnly"
  | "nothingRead"
  | "model"
  | "category"
  | "source"
  | "manual"
  | "specs";

/** A single strip line: a stable code plus any interpolation values. */
export interface ConfidenceLine<C extends string> {
  code: C;
  /** ICU values for the localized message, e.g. `{ plate: "X1-Carbon" }`. */
  values?: Record<string, string>;
}

/** The strip's contents, as codes the UI localizes (confidence spec §6). */
export interface ConfidenceLines {
  basis: ConfidenceLine<ConfidenceBasisCode>[];
  unknowns: ConfidenceLine<ConfidenceUnknownCode>[];
}

/**
 * Derive the strip lines from evidence. Generated from the evidence rather than
 * written per case, so a new evidence combination cannot produce a card with an
 * empty basis and a confident heading.
 *
 * With `reads`, a result capped by {@link readCap} leads its unknowns with why.
 * "Nothing was read" says everything the `source` line would, so that line is
 * then left out.
 */
export function confidenceLines(e: IntakeEvidence, reads?: ConfidenceReads | null): ConfidenceLines {
  const basis: ConfidenceLine<ConfidenceBasisCode>[] = [];
  const unknowns: ConfidenceLine<ConfidenceUnknownCode>[] = [];
  const cap = readCap(reads);
  if (cap) unknowns.push({ code: cap });

  if (e.userStatedModel) basis.push({ code: "userStatedModel" });
  if (e.modelPlateRead !== null) {
    basis.push({ code: "modelPlateRead", values: { plate: e.modelPlateRead } });
  }
  if (e.manufacturerPageFound) basis.push({ code: "manufacturerPage" });
  if (e.manualFound) basis.push({ code: "manual" });
  if (e.specsFromSource) basis.push({ code: "specsFromSource" });

  if (!modelIdentified(e)) unknowns.push({ code: "model" });
  if (e.categoryOnly) unknowns.push({ code: "category" });
  if (!externalSource(e)) {
    // Nothing was fetched at all — that single line says everything the
    // per-source lines below would, so they are suppressed.
    if (cap !== "nothingRead") unknowns.push({ code: "source" });
  } else {
    if (!e.manualFound) unknowns.push({ code: "manual" });
    if (!e.specsFromSource) unknowns.push({ code: "specs" });
  }

  return { basis, unknowns };
}

// ── English rendering (model-facing) ───────────────────────────────

/**
 * English text for the tool result the model reads back (and for logs). The
 * card does **not** use these — it localizes from the codes above, per Article 6
 * — so this stays the one place the untranslated phrasing lives.
 */
const BASIS_TEXT: Record<
  ConfidenceBasisCode,
  (values?: Record<string, string>) => string
> = {
  userStatedModel: () => "The user gave the make and model",
  modelPlateRead: (v) => `Model plate reads "${v?.plate ?? ""}"`,
  manufacturerPage: () => "Manufacturer or retailer page read",
  manual: () => "Manual found",
  specsFromSource: () => "Specs taken from a page that was read",
};

const UNKNOWN_TEXT: Record<ConfidenceUnknownCode, string> = {
  videoOnly: "Only a video was read — no product page, manual or spec sheet, so this cannot be high confidence",
  nothingRead: "No page could be read, so nothing was checked against a source",
  model: "The model number could not be read — ask for a photo of the label",
  category: "Only the general type of equipment could be identified",
  source: "No manufacturer page or manual was found to check against",
  manual: "No manual was found",
  specs: "The specs are not confirmed against a page that was read",
};

/**
 * Grade a candidate. The whole point of this module: `(evidence) =>
 * IntakeConfidence`, pure, with no model call and no prompt involved. `reads`,
 * when the caller knows what was read, caps a grade no page supports
 * ({@link readCap}).
 */
export function scoreConfidence(
  evidence?: Partial<IntakeEvidence> | null,
  reads?: ConfidenceReads | null
): IntakeConfidence {
  const e = toEvidence(evidence);
  const lines = confidenceLines(e, reads);
  return {
    level: confidenceLevel(e, reads),
    basis: lines.basis.map((line) => BASIS_TEXT[line.code](line.values)),
    unknowns: lines.unknowns.map((line) => UNKNOWN_TEXT[line.code]),
  };
}

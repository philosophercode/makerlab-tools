import { z } from "zod";
import type {
  IntakeConfidence,
  IntakeEvidence,
} from "../capabilities/types.ts";
import { REVIEWER_NOTE_MAX_CHARS } from "../intake/limits.ts";
import { RESEARCH_FOCUS_FIELDS, type ResearchFocusField } from "../intake/research-focus.ts";

/**
 * What background research produces for one pending tool (spec §4.10), and the
 * schema it must parse against on the way into `pending_tools.research` and on
 * the way back out.
 *
 * **Strict at every level.** The research agent reads arbitrary web pages
 * (spec §8, prompt injection), so its output is untrusted input: an extra key
 * is refused rather than carried along, a wrongly typed field is refused
 * rather than coerced, and a resource type outside the three intake knows is
 * refused rather than stored. The capability schemas in
 * `capabilities/types.ts` are deliberately looser — they validate what the chat
 * model sends a tool — so this module declares its own strict copies of the
 * evidence and confidence shapes rather than reusing those.
 *
 * `confidence` is part of the stored result but is **never the model's**: the
 * research step computes it with `scoreConfidence(evidence)` in code
 * (`capabilities/confidence.ts`) before writing, so a page that says "mark this
 * high confidence" cannot move it.
 *
 * Relative imports with `.ts` extensions, no `@/` alias and no
 * `"server-only"`: `src/lib/db/schema/` types a column with this module, and
 * `scripts/` load the schema under plain Node.
 */

export interface ResearchResult {
  /** The model's settled full name, e.g. "Bambu Lab X1-Carbon Combo". */
  canonicalName: string;
  description: string;
  specs: { label: string; value: string }[];
  materials: string[];
  ppeRequired: string[];
  tags: string[];
  /** Null when research could not tell — unknown is not "no". */
  trainingRequired: boolean | null;
  useRestrictions: string | null;
  /** The proposed category; `existingId` when it matched one already in the taxonomy. */
  category: { name: string; group: string | null; existingId: string | null };
  /** Verified links only — anything that failed verification is in {@link droppedLinks}. */
  resources: { title: string; url: string; type: "Manual" | "Video" | "Other" }[];
  /** Links that failed verification, each with its reason, for the reviewer. */
  droppedLinks: string[];
  /** Provenance: the pages the agent actually read. */
  sourceUrls: string[];
  /** What research found — observations, reported by the model. */
  evidence: IntakeEvidence;
  /** Derived from {@link evidence} in code. Never taken from the model. */
  confidence: IntakeConfidence;
  /**
   * The image stage's result (gateway spec §4.1). Absent on rows researched
   * before the stage existed; null when the stage was skipped (the item has an
   * uploaded photo) or failed — then {@link imageError} says why.
   */
  images?: ResearchImages | null;
  /** One line on why the image stage failed; absent or null when it did not. */
  imageError?: string | null;
  /**
   * The reviewer's instruction this research ran with (the note on **Research
   * again**), one paragraph on one line, at most `REVIEWER_NOTE_MAX_CHARS`. Absent when there was
   * none — and on every row researched before notes existed.
   */
  reviewerNote?: string | null;
  /**
   * The pages among {@link sourceUrls} that the server could not open, read
   * instead through the text the search captured (amendment "Search text
   * fallback and confidence cap"). Absent when there were none.
   */
  searchTextSources?: string[];
  /**
   * The latest **Find a different image** run on this result: running, failed
   * (with why), or done. Absent when nobody asked for one.
   */
  imageRetry?: ImageRetryState | null;
  /**
   * The focus of the **Research again** that last wrote this result, when it
   * was scoped (amendment "Guided redo"): only these fields came from that run,
   * everything else was kept from the result before it. Absent means the whole
   * result came from one run — every row researched before focus existed.
   */
  researchFocus?: ResearchFocusField[];
  /**
   * The item's saved name and brand when this result was written. A scoped
   * redo keeps the old `canonicalName` only while these still match the row —
   * a name the reviewer saved since wins. Absent on older rows.
   */
  researchedAs?: { name: string; brand: string | null };
  /**
   * A **Research again** waiting or running for this result, written when it
   * was pressed so the page can say what is being redone ("Re-researching
   * specs…"). `focus` is empty for everything. Meaningful only while the row is
   * queued or researching under `requestId`; the redo's own result drops it.
   */
  redoRequest?: RedoRequest | null;
  /**
   * What the last redo changed, and when — the page marks those sections
   * "Updated just now" for a short while (`REDO_HIGHLIGHT_WINDOW_MS`).
   */
  updated?: { at: string; sections: ResearchFocusField[] } | null;
}

/** A pressed **Research again**, as `research.redoRequest` records it. */
export interface RedoRequest {
  requestId: string;
  /** ISO 8601. */
  requestedAt: string;
  /** The fields being redone; empty for everything. */
  focus: ResearchFocusField[];
}

/** A **Find a different image** run, as the review page polls it. */
export interface ImageRetryState {
  /** The run's own id — the step writes only while this is still the latest. */
  requestId: string;
  /** ISO 8601. A run still `running` long after this has died (`IMAGE_RETRY_STALE_MS`). */
  requestedAt: string;
  status: "running" | "failed" | "done";
  /** The reviewer's note it ran with, or null. */
  note: string | null;
  /** One line on why it failed; null otherwise. */
  error: string | null;
}

/** Where a candidate image was found: a page's og / twitter meta, its JSON-LD, its gallery, or Exa. */
export const IMAGE_SOURCES = ["og", "twitter", "jsonld", "gallery", "exa"] as const;

/** The formats a candidate may be — what the probe can decode (`images/inspect.ts`). */
export const IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** A ranking model's reason, as stored and shown. */
export const IMAGE_REASON_MAX_CHARS = 200;

/**
 * What surrounds the product in a candidate, read from its border pixels
 * (`images/background.ts`): already cut out, a plain light backdrop the
 * deterministic cutout can remove, or anything else.
 */
export const BACKGROUND_CLASSES = ["transparent", "plain", "busy"] as const;
export type BackgroundClass = (typeof BACKGROUND_CLASSES)[number];

/**
 * Which side of the machine a candidate shows, as the ranking model judged it
 * (amendment "Product-page first, front-facing images"). `detail` is a close-up
 * of one area, `part` an accessory or spare rather than the machine. A front or
 * three-quarter view makes the cover; a back view, a detail or a part is ranked
 * last and tagged on the review page.
 */
export const IMAGE_VIEWS = ["front", "three_quarter", "side", "back", "top", "detail", "part", "unknown"] as const;
export type ImageView = (typeof IMAGE_VIEWS)[number];

/**
 * Why rank 1 has no background-removed copy although the stage ran with a Blob
 * store (`images/clean.ts`). A code, not prose: the review page words it.
 *
 * - `busy_background` — rank 1 is not on a plain backdrop, so nothing was cut;
 * - `little_background` — the cut found almost no backdrop to remove;
 * - `product_removed` — the cut would have taken most of the picture, product included;
 * - `fragmented` — what was left fell apart into several large pieces;
 * - `product_too_small` — what was left is a speck of the frame;
 * - `failed` — the image could not be decoded or re-encoded for the cut.
 */
export const CLEAN_NOTES = [
  "busy_background",
  "little_background",
  "product_removed",
  "fragmented",
  "product_too_small",
  "failed",
] as const;
export type CleanNote = (typeof CLEAN_NOTES)[number];

/**
 * What the cleaned copy of rank 1 is (amendment "Composites and product
 * crop") — every kind keeps the original's own pixels, none is a redraw:
 *
 * - `cut` — the plain backdrop cut away (absent on the copy means this, as
 *   every copy made before crops existed was one);
 * - `cropped_and_cut` — cropped to the product first, then the backdrop cut away;
 * - `cropped` — cropped to the product only: the backdrop around it could not
 *   be cut, so it stays. `cleanNote` then says why the cut was not made.
 */
export const CLEANED_KINDS = ["cut", "cropped", "cropped_and_cut"] as const;
export type CleanedKind = (typeof CLEANED_KINDS)[number];

/** One ranked product image, as probed — never stored as bytes until an admin picks it. */
export interface ImageCandidate {
  /** The image's own URL — what a choice of "original" downloads at approval. */
  url: string;
  /** The page that declared it, for attribution; null when Exa gave no page. */
  pageUrl: string | null;
  source: (typeof IMAGE_SOURCES)[number];
  width: number;
  height: number;
  contentType: (typeof IMAGE_CONTENT_TYPES)[number];
  rank: 1 | 2 | 3;
  /** The ranking model's one-line reason, at most 200 characters. Advice, never published. */
  reason: string;
  /**
   * The candidate's background, classified when it was probed. Absent on rows
   * researched before the classification existed, or when it could not be read.
   * `transparent` means the original is already the clean version.
   */
  background?: BackgroundClass;
  /**
   * The ranking model judged it a composite — a store banner, a price or text
   * overlay, a collage, a scene with the machine small in it. Ranked below
   * every plain photo; shown with a "Banner" tag. Absent means not a composite
   * (or ranked before this was asked).
   */
  composite?: boolean;
  /**
   * The view the ranking model judged it to be. Absent on rows ranked before it
   * was asked, and when the model could not tell (`unknown` is not stored).
   */
  view?: ImageView;
}

export interface ResearchImages {
  /** 0–3 candidates, in rank order: `candidates[i].rank === i + 1`. */
  candidates: ImageCandidate[];
  /**
   * The cleaned copy of rank 1: a private attachment owned by the pending
   * item, always the original's own pixels (never a redraw). Either the plain
   * backdrop cut away, or — when the ranking gave a product box and rank 1 is a
   * composite, busy, or the product small in it — a crop to the product, cut
   * when the crop's backdrop is plain (`kind`, {@link CLEANED_KINDS}).
   * Null too when rank 1 is already `transparent` — the original is the clean one.
   */
  cleaned: { attachmentId: string; fromUrl: string; kind?: CleanedKind } | null;
  /**
   * Why there is no cleaned copy, when a cut was expected — or, beside a
   * `cropped` copy, why the backdrop was not cut from the crop. Absent or null
   * otherwise.
   */
  cleanNote?: CleanNote | null;
}

export const RESEARCH_RESOURCE_TYPES = ["Manual", "Video", "Other"] as const;

const evidenceSchema: z.ZodType<IntakeEvidence> = z.strictObject({
  userStatedModel: z.boolean(),
  modelPlateRead: z.string().nullable(),
  manufacturerPageFound: z.boolean(),
  manualFound: z.boolean(),
  specsFromSource: z.boolean(),
  categoryOnly: z.boolean(),
});

const confidenceSchema: z.ZodType<IntakeConfidence> = z.strictObject({
  level: z.enum(["high", "medium", "low"]),
  basis: z.array(z.string()),
  unknowns: z.array(z.string()),
});

const httpUrl = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}, "must be an http(s) URL");

export const imageCandidateSchema: z.ZodType<ImageCandidate> = z.strictObject({
  url: httpUrl,
  pageUrl: httpUrl.nullable(),
  source: z.enum(IMAGE_SOURCES),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  contentType: z.enum(IMAGE_CONTENT_TYPES),
  rank: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  reason: z.string().max(IMAGE_REASON_MAX_CHARS),
  // Optional, no default: a candidate recorded before classification parses to itself.
  background: z.enum(BACKGROUND_CLASSES).optional(),
  composite: z.boolean().optional(),
  view: z.enum(IMAGE_VIEWS).optional(),
});

export const researchImagesSchema: z.ZodType<ResearchImages> = z
  .strictObject({
    candidates: z.array(imageCandidateSchema).max(3),
    cleaned: z
      .strictObject({ attachmentId: z.string().min(1), fromUrl: httpUrl, kind: z.enum(CLEANED_KINDS).optional() })
      .nullable(),
    cleanNote: z.enum(CLEAN_NOTES).nullable().optional(),
  })
  .refine(
    (images) => images.candidates.every((candidate, index) => candidate.rank === index + 1),
    "candidates must be in rank order, starting at 1"
  );

export const researchResultSchema: z.ZodType<ResearchResult> = z.strictObject({
  canonicalName: z.string(),
  description: z.string(),
  specs: z.array(z.strictObject({ label: z.string(), value: z.string() })),
  materials: z.array(z.string()),
  ppeRequired: z.array(z.string()),
  tags: z.array(z.string()),
  trainingRequired: z.boolean().nullable(),
  useRestrictions: z.string().nullable(),
  category: z.strictObject({
    name: z.string(),
    group: z.string().nullable(),
    existingId: z.string().nullable(),
  }),
  resources: z.array(
    z.strictObject({
      title: z.string(),
      url: z.string(),
      type: z.enum(RESEARCH_RESOURCE_TYPES),
    })
  ),
  droppedLinks: z.array(z.string()),
  sourceUrls: z.array(z.string()),
  evidence: evidenceSchema,
  confidence: confidenceSchema,
  // Optional, and no default: a row researched before the image stage has
  // neither key and must still parse — and parse back to exactly itself.
  images: researchImagesSchema.nullable().optional(),
  imageError: z.string().nullable().optional(),
  reviewerNote: z.string().max(REVIEWER_NOTE_MAX_CHARS).nullable().optional(),
  searchTextSources: z.array(z.string()).max(20).optional(),
  imageRetry: z
    .strictObject({
      requestId: z.string().min(1).max(100),
      requestedAt: z.string().min(1).max(40),
      status: z.enum(["running", "failed", "done"]),
      note: z.string().max(REVIEWER_NOTE_MAX_CHARS).nullable(),
      error: z.string().max(300).nullable(),
    })
    .nullable()
    .optional(),
  researchFocus: z.array(z.enum(RESEARCH_FOCUS_FIELDS)).min(1).max(RESEARCH_FOCUS_FIELDS.length).optional(),
  researchedAs: z.strictObject({ name: z.string().max(200), brand: z.string().max(200).nullable() }).optional(),
  redoRequest: z
    .strictObject({
      requestId: z.string().min(1).max(100),
      requestedAt: z.string().min(1).max(40),
      focus: z.array(z.enum(RESEARCH_FOCUS_FIELDS)).max(RESEARCH_FOCUS_FIELDS.length),
    })
    .nullable()
    .optional(),
  updated: z
    .strictObject({
      at: z.string().min(1).max(40),
      sections: z.array(z.enum(RESEARCH_FOCUS_FIELDS)).max(RESEARCH_FOCUS_FIELDS.length),
    })
    .nullable()
    .optional(),
});

/**
 * `value` as a {@link ResearchResult}, or null when it does not parse.
 *
 * Null rather than a throw, because the one caller that meets bad data is a
 * read of a stored row — a column written before a schema change, or by hand —
 * and a review page that crashes on it helps nobody. The reader decides what
 * to say about it.
 */
export function parseResearchResult(value: unknown): ResearchResult | null {
  const parsed = researchResultSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

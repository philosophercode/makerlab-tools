import { z } from "zod";
import type {
  IntakeConfidence,
  IntakeEvidence,
} from "../capabilities/types.ts";

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

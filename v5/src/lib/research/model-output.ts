import { z } from "zod";
import type { IntakeEvidence } from "../capabilities/types.ts";
import { cleanStarterQuestions } from "../starter-questions.ts";
import { RESEARCH_RESOURCE_TYPES } from "./result.ts";

/**
 * What the two research steps accept back from the model (spec §3.7, the
 * 2026-09-22 amendment's "two steps per item").
 *
 * - **Search findings** — the first step's answer: what the item is called,
 *   a description draft, the pages worth opening and what the search alone
 *   established.
 * - **Fetch draft** — the second step's answer: every {@link ResearchResult}
 *   field except the three the code owns. `confidence` is computed from the
 *   evidence, `droppedLinks` come from link verification, and
 *   `category.existingId` from the taxonomy match.
 *
 * **Tolerant here, strict at the end.** These schemas read the model's answer,
 * so an unknown key is dropped rather than refused (a model that volunteers
 * `"confidence": "high"` has that key thrown away, never read), missing lists
 * default to empty, and a resource type is normalised rather than rejected.
 * Everything that reaches the database still passes the strict
 * `researchResultSchema` in `assemble.ts`.
 *
 * **Serializable on purpose.** A step's return value is persisted in the run's
 * event log and replayed into the workflow, so {@link SearchFindings} is plain
 * JSON: strings, booleans, arrays and objects, no `Date`, no class.
 *
 * Relative imports with `.ts` extensions and no `"server-only"`: the workflow
 * step bundle loads this under plain Node.
 */

/** The model's answer did not contain a JSON object we can use. */
export class ModelOutputError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ModelOutputError";
  }
}

type ResourceType = (typeof RESEARCH_RESOURCE_TYPES)[number];

/** "manual", "PDF manual", "video" → the three types intake knows; anything else is Other. */
function toResourceType(value: unknown): ResourceType {
  const text = typeof value === "string" ? value.toLowerCase() : "";
  if (text.includes("manual") || text.includes("guide")) return "Manual";
  if (text.includes("video")) return "Video";
  return "Other";
}

/** A string, trimmed and cut to `max` — a long answer is shortened, not refused. */
const text = (max: number) => z.string().transform((value) => value.trim().slice(0, max));

const linkSchema = z.object({
  title: z.string(),
  url: z.string(),
  type: z.unknown().transform(toResourceType),
});

export interface ModelLink {
  title: string;
  url: string;
  type: ResourceType;
}

/**
 * A list of links, keeping the entries that are links. An entry with no URL is
 * the model's formatting slip, not a page anybody could open, so it is left out
 * rather than failing the whole answer; a URL that is present but wrong is kept
 * here and dropped, with its reason, by link verification.
 */
const linksSchema = z
  .array(z.unknown())
  .default([])
  .transform((items): ModelLink[] =>
    items.flatMap((item) => {
      const parsed = linkSchema.safeParse(item);
      if (!parsed.success) return [];
      const url = parsed.data.url.trim().slice(0, 2000);
      if (!url) return [];
      const title = parsed.data.title.trim().slice(0, 300) || url;
      return [{ title, url, type: parsed.data.type }];
    })
  );

/** Spec rows with both a label and a value; a half-filled row is dropped. */
const specsSchema = z
  .array(z.unknown())
  .default([])
  .transform((items) =>
    items.flatMap((item) => {
      const parsed = z.object({ label: z.string(), value: z.string() }).safeParse(item);
      if (!parsed.success) return [];
      const label = parsed.data.label.trim().slice(0, 120);
      const value = parsed.data.value.trim().slice(0, 400);
      return label && value ? [{ label, value }] : [];
    })
  );

const urlList = z.array(z.string()).default([]);
const labelList = z.array(z.string()).default([]);

/**
 * Evidence as the model reports it, every field optional. `toEvidence()` fills
 * the gaps with the *absent* value, so an under-reported answer grades down.
 */
const evidencePartialSchema = z.object({
  userStatedModel: z.boolean().optional(),
  modelPlateRead: z.string().nullable().optional(),
  manufacturerPageFound: z.boolean().optional(),
  manualFound: z.boolean().optional(),
  specsFromSource: z.boolean().optional(),
  categoryOnly: z.boolean().optional(),
});

export type EvidencePartial = Partial<IntakeEvidence>;

const categorySchema = z.object({
  name: text(120),
  group: text(120).nullable().default(null),
});

/** The search step's answer. */
export const searchFindingsSchema = z.object({
  /** The full name the search settled on; empty when it settled on nothing. */
  canonicalName: text(200).default(""),
  description: text(4000).default(""),
  category: categorySchema.nullable().default(null),
  /** Pages worth opening in the fetch step: product pages, manuals, videos. */
  candidateLinks: linksSchema,
  /** Pages the search itself surfaced as evidence. */
  sourceUrls: urlList,
  evidence: evidencePartialSchema.default({}),
});

export type SearchFindings = z.infer<typeof searchFindingsSchema>;

/** The fetch step's answer: a result minus confidence, droppedLinks and category.existingId. */
export const fetchDraftSchema = z.object({
  canonicalName: text(200).default(""),
  description: text(4000).default(""),
  specs: specsSchema,
  materials: labelList,
  ppeRequired: labelList,
  tags: labelList,
  trainingRequired: z.boolean().nullable().default(null),
  useRestrictions: text(1000).nullable().default(null),
  category: categorySchema.nullable().default(null),
  resources: linksSchema,
  sourceUrls: urlList,
  evidence: evidencePartialSchema.default({}),
  /**
   * Up to three questions for the assistant's starter chips (amendment
   * "Tool-specific starter questions"). Lenient: anything that is not a usable
   * question is dropped, and a missing or malformed list is no questions.
   */
  starterQuestions: z.unknown().optional().transform(cleanStarterQuestions),
});

export type FetchDraft = z.infer<typeof fetchDraftSchema>;

/**
 * The last top-level JSON object in `text` that parses.
 *
 * A model that was asked for "one JSON object" still wraps it in a code fence,
 * or says "Here is what I found:" first, or — with server-side tools — narrates
 * a search before answering. The answer is the *last* object, because that is
 * the one written after the tools ran. Braces inside strings are skipped, so a
 * description containing `{` does not cut the object short.
 */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new ModelOutputError("The model returned no text.");

  try {
    const whole = JSON.parse(trimmed) as unknown;
    if (isPlainObject(whole)) return whole;
  } catch {
    // Not bare JSON — look for an object inside it.
  }

  let last: Record<string, unknown> | null = null;
  let from = trimmed.indexOf("{");
  while (from >= 0) {
    const end = balancedEnd(trimmed, from);
    let parsed: unknown = null;
    if (end >= 0) {
      try {
        parsed = JSON.parse(trimmed.slice(from, end + 1));
      } catch {
        parsed = null;
      }
    }
    if (isPlainObject(parsed)) {
      last = parsed;
      // Skip past it: an object nested inside the answer is not the answer.
      from = trimmed.indexOf("{", end + 1);
    } else {
      // A stray brace in prose — try the next one.
      from = trimmed.indexOf("{", from + 1);
    }
  }
  if (last) return last;
  throw new ModelOutputError("The model's answer contained no JSON object.");
}

/** Model text → {@link SearchFindings}, or a {@link ModelOutputError}. */
export function parseSearchFindings(text: string): SearchFindings {
  return parseWith(searchFindingsSchema, text, "search findings");
}

/** Model text → {@link FetchDraft}, or a {@link ModelOutputError}. */
export function parseFetchDraft(text: string): FetchDraft {
  return parseWith(fetchDraftSchema, text, "research draft");
}

function parseWith<T>(schema: z.ZodType<T>, text: string, what: string): T {
  const parsed = schema.safeParse(extractJsonObject(text));
  if (!parsed.success) {
    const where = parsed.error.issues
      .slice(0, 3)
      .map((issue) => issue.path.join(".") || "(root)")
      .join(", ");
    throw new ModelOutputError(`The model's ${what} did not match the expected shape (${where}).`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The index of the `}` that closes the `{` at `start`, or -1. Braces inside strings do not count. */
function balancedEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

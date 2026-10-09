import { z } from "zod";

/**
 * The shape of a tool skill (tool skills spec 2026-10-07 §4.2, §5.2): what
 * the model is asked to return (a **draft**), what is stored once code has
 * checked it (**sections**, in `tool_skills.sections`) and the sources a skill
 * cites (`tool_skills.sources`). Pure and client-safe: the writer, the
 * renderer, the admin page and the chat all read these.
 *
 * Every item carries `cites`, the ids of the sources it rests on: `T1` the
 * lab's catalogue record, `N…` the tool's lab notes, `L…` lab-wide notes,
 * `M…` manual passages, `R1` the research summary, `K…` linked documents.
 */

/** The bulleted sections, in the order the guide shows them (troubleshooting is its own shape). */
export const SKILL_BULLET_SECTIONS = [
  "quickFacts",
  "beforeYouStart",
  "operatingProcedure",
  "settingsAndLimits",
  "materials",
  "safety",
  "whenToGetStaff",
] as const;
export type SkillBulletSection = (typeof SKILL_BULLET_SECTIONS)[number];

/** Every section the guide has, in reading order. */
export const SKILL_SECTION_ORDER = [
  "quickFacts",
  "beforeYouStart",
  "operatingProcedure",
  "settingsAndLimits",
  "materials",
  "troubleshooting",
  "safety",
  "whenToGetStaff",
] as const;
export type SkillSection = (typeof SKILL_SECTION_ORDER)[number];

/** The heading each section renders under. */
export const SKILL_SECTION_TITLES: Readonly<Record<SkillSection, string>> = {
  quickFacts: "Quick facts",
  beforeYouStart: "Before you start",
  operatingProcedure: "Operating procedure",
  settingsAndLimits: "Settings and limits",
  materials: "Materials",
  troubleshooting: "Troubleshooting",
  safety: "Safety and emergency stop",
  whenToGetStaff: "When to get staff",
};

/** How many items the model may write per section (the prompt says the same). */
export const SKILL_SECTION_MAX: Readonly<Record<SkillSection | "notInSources", number>> = {
  quickFacts: 8,
  beforeYouStart: 10,
  operatingProcedure: 20,
  settingsAndLimits: 12,
  materials: 12,
  troubleshooting: 10,
  safety: 10,
  whenToGetStaff: 6,
  notInSources: 8,
};

/** A source id as the prompt hands them out: one capital letter and a number. */
export const SOURCE_ID_PATTERN = /^[TNLMRK][1-9][0-9]{0,2}$/;

const ITEM_TEXT_MAX = 500;
const CITES_MAX = 8;

const citesSchema = z
  .array(z.string())
  .max(CITES_MAX * 2)
  .transform((ids) => [...new Set(ids.map((id) => id.trim().toUpperCase()).filter((id) => SOURCE_ID_PATTERN.test(id)))].slice(0, CITES_MAX));

const textSchema = (max: number) =>
  z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(z.string().min(1).max(max));

/** One item the model wrote: a line of text and the sources it rests on. */
export const draftBulletSchema = z.object({
  text: textSchema(ITEM_TEXT_MAX),
  cites: citesSchema.default([]),
});
export type DraftBullet = z.infer<typeof draftBulletSchema>;

/** One troubleshooting row: what you see, what to check, what fixes it. */
export const draftTroubleSchema = z.object({
  symptom: textSchema(200),
  check: textSchema(300),
  fix: textSchema(300),
  cites: citesSchema.default([]),
});
export type DraftTrouble = z.infer<typeof draftTroubleSchema>;

/** What the model is asked for, once each item has been read (`parse.ts`). */
export interface SkillDraft {
  quickFacts: DraftBullet[];
  beforeYouStart: DraftBullet[];
  operatingProcedure: DraftBullet[];
  settingsAndLimits: DraftBullet[];
  materials: DraftBullet[];
  troubleshooting: DraftTrouble[];
  safety: DraftBullet[];
  whenToGetStaff: DraftBullet[];
  /** Topics a student would need that the sources do not cover. */
  notInSources: string[];
}

/** Where a stored item came from: the lab's record, inserted by code, or the model. */
export type SkillOrigin = "lab" | "model";

export const skillBulletSchema = z.object({
  text: z.string(),
  cites: z.array(z.string()),
  origin: z.enum(["lab", "model"]),
});
export type SkillBullet = z.infer<typeof skillBulletSchema>;

export const skillTroubleSchema = z.object({
  symptom: z.string(),
  check: z.string(),
  fix: z.string(),
  cites: z.array(z.string()),
});
export type SkillTrouble = z.infer<typeof skillTroubleSchema>;

/** Why the checks took an item out (`numbers-guard.ts`). */
export const REMOVED_REASONS = ["uncited_number", "uncited_claim", "weakens_safety"] as const;
export type RemovedReason = (typeof REMOVED_REASONS)[number];

export const removedItemSchema = z.object({
  section: z.string(),
  text: z.string(),
  reason: z.enum(REMOVED_REASONS),
});
export type RemovedItem = z.infer<typeof removedItemSchema>;

/** `tool_skills.sections`: the checked skill, the lab's facts included. */
export const skillSectionsSchema = z.object({
  format: z.literal(1),
  quickFacts: z.array(skillBulletSchema),
  beforeYouStart: z.array(skillBulletSchema),
  operatingProcedure: z.array(skillBulletSchema),
  settingsAndLimits: z.array(skillBulletSchema),
  materials: z.array(skillBulletSchema),
  troubleshooting: z.array(skillTroubleSchema),
  safety: z.array(skillBulletSchema),
  whenToGetStaff: z.array(skillBulletSchema),
  notInSources: z.array(z.string()),
  removed: z.array(removedItemSchema),
  unknownCites: z.array(z.string()),
});
export type SkillSections = z.infer<typeof skillSectionsSchema>;

/** One source a skill may cite (§4.2). Manuals by document id and pages, never a file URL. */
export const skillSourceSchema = z.discriminatedUnion("kind", [
  z.object({ id: z.string(), kind: z.literal("catalog"), toolName: z.string() }),
  z.object({ id: z.string(), kind: z.literal("lab_note"), scope: z.enum(["tool", "lab"]), text: z.string() }),
  z.object({
    id: z.string(),
    kind: z.literal("manual"),
    documentId: z.string(),
    title: z.string(),
    pageStart: z.number().int(),
    pageEnd: z.number().int(),
    section: z.array(z.string()),
  }),
  z.object({ id: z.string(), kind: z.literal("research"), urls: z.array(z.string()), researchedAt: z.string().nullable() }),
  z.object({ id: z.string(), kind: z.literal("link"), title: z.string(), type: z.string().nullable(), url: z.string().nullable() }),
]);
export type SkillSource = z.infer<typeof skillSourceSchema>;

export const skillSourcesSchema = z.array(skillSourceSchema);

/** The pages of a manual source as a reader writes them: "12" or "12–13". */
export function sourcePages(source: Extract<SkillSource, { kind: "manual" }>): string {
  return source.pageEnd > source.pageStart ? `${source.pageStart}–${source.pageEnd}` : String(source.pageStart);
}

/** An empty draft: every list empty. */
export function emptyDraft(): SkillDraft {
  return {
    quickFacts: [],
    beforeYouStart: [],
    operatingProcedure: [],
    settingsAndLimits: [],
    materials: [],
    troubleshooting: [],
    safety: [],
    whenToGetStaff: [],
    notInSources: [],
  };
}

/** How many items the model's draft holds, all sections together. */
export function draftSize(draft: SkillDraft): number {
  return SKILL_SECTION_ORDER.reduce((sum, key) => sum + draft[key].length, 0);
}

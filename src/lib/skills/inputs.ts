import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { MakerLabTool } from "../../components/catalog-types.ts";
import { findToolByIdOrSlug } from "../data/catalog.ts";
import { getLabSetting, LAB_NOTES_SETTING } from "../data/lab-settings.ts";
import { isUuid } from "../data/uuid.ts";
import { pendingTools, toolRefreshes, tools } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";
import { labNoteLines } from "../lab-notes/lines.ts";
import { readLabNotesSetting } from "../lab-notes/setting.ts";
import { searchManuals, type ManualPassage } from "../manuals/search.ts";
import { parseResearchResult, type ResearchResult } from "../research/result.ts";
import type { SkillSource } from "./format.ts";
import {
  SKILL_MANUAL_MAX_CHARS,
  SKILL_MAX_LINKS,
  SKILL_PASSAGES_PER_TOPIC,
  SKILL_RESEARCH_MAX_CHARS,
  SKILL_RESEARCH_MAX_SPECS,
  SKILL_RESEARCH_MAX_URLS,
} from "./limits.ts";

/**
 * Everything a tool skill is written from (tool skills spec 2026-10-07 §5.1),
 * each source given an id the writer cites:
 *
 * - `T1` — the lab's catalogue record: names, category, location, training,
 *   PPE, materials, restrictions, emergency stop, description.
 * - `N1…` — the tool's lab notes; `L1…` — the lab-wide notes.
 * - `R1` — the newest research about it (the intake research that made it, or
 *   its latest refresh), as a short summary with the pages it read.
 * - `K1…` — its published linked documents: title, type and the
 *   manufacturer's URL (a stored file keeps only its title, so a skill names
 *   no blob and travels to another deployment unchanged).
 * - `M1…` — manual passages for fixed topics, by full-text search (no
 *   embedding call: no network, and the same passages for the same text), from
 *   **public files on published resources only** (`publicFilesOnly`) — a skill
 *   is served to everyone, so a staff-only SOP never reaches one.
 *
 * Nothing here calls a model, and nothing fails a write: a search that throws
 * is no passages. Null for a tool that does not exist or is archived. Plain
 * Node: the workflow step and the backfill script load it.
 */

/** The manual topics searched, in the order their passages are given. */
export const SKILL_MANUAL_TOPICS = [
  { topic: "operating", query: "how to operate start a job procedure" },
  { topic: "setup", query: "setup preparation before use calibration" },
  { topic: "settings", query: "settings parameters speed power temperature limits" },
  { topic: "materials", query: "materials compatible supported thickness" },
  { topic: "troubleshooting", query: "troubleshooting error problem solution" },
  { topic: "maintenance", query: "maintenance cleaning replacement" },
  { topic: "safety", query: "safety warning caution hazard emergency stop" },
  { topic: "specifications", query: "specifications technical data dimensions" },
] as const;

/** One passage's text, at most, before the budget is counted. */
const PASSAGE_MAX_CHARS = 3_000;

export interface SkillToolRecord {
  id: string;
  slug: string;
  name: string;
  officialName: string | null;
  category: string;
  location: string;
  itemKind: string | null;
  trainingRequired: boolean;
  ppe: string[];
  materials: string[];
  useRestrictions: string | null;
  emergencyStop: string | null;
  description: string;
  published: boolean;
}

export interface SkillNote {
  id: string;
  text: string;
}

export interface SkillResearch {
  id: "R1";
  /** The summary as the writer reads it, within the research budget. */
  text: string;
  urls: string[];
  researchedAt: string | null;
}

export interface SkillLink {
  id: string;
  title: string;
  type: string | null;
  url: string | null;
}

export interface SkillPassage {
  id: string;
  topic: string;
  documentId: string;
  title: string;
  pageStart: number;
  pageEnd: number;
  section: string[];
  content: string;
}

export interface SkillInputs {
  tool: SkillToolRecord;
  toolNotes: SkillNote[];
  labNotes: SkillNote[];
  research: SkillResearch | null;
  links: SkillLink[];
  passages: SkillPassage[];
  /** Every source offered, with its id — what a cite may name. */
  sources: SkillSource[];
}

type Search = typeof searchManuals;

export async function assembleSkillInputs(db: Db, toolId: string, options: { search?: Search } = {}): Promise<SkillInputs | null> {
  if (!isUuid(toolId)) return null;
  const [catalog, [raw]] = await Promise.all([
    findToolByIdOrSlug(toolId, { db, includeDrafts: true }),
    db
      .select({ trainingRequired: tools.trainingRequired, published: tools.published, itemKind: tools.itemKind })
      .from(tools)
      .where(eq(tools.id, toolId))
      .limit(1),
  ]);
  if (!catalog || !raw) return null;

  const [labNotesText, research, passages] = await Promise.all([
    getLabSetting(LAB_NOTES_SETTING, { db }).then((setting) => readLabNotesSetting(setting?.value)),
    loadResearch(db, toolId),
    loadPassages(db, toolId, options.search ?? searchManuals),
  ]);

  const tool: SkillToolRecord = {
    id: catalog.id,
    slug: catalog.slug,
    name: catalog.name,
    officialName: catalog.officialName ?? null,
    category: [catalog.category, catalog.categorySub].filter(Boolean).join(" / "),
    location: [catalog.location, catalog.zone].filter(Boolean).join(" / "),
    itemKind: raw.itemKind ?? null,
    trainingRequired: raw.trainingRequired,
    ppe: catalog.ppe,
    materials: catalog.materials,
    useRestrictions: catalog.useRestrictions?.trim() || null,
    emergencyStop: catalog.emergencyStop?.trim() || null,
    description: catalog.description?.trim() ?? "",
    published: raw.published,
  };
  const toolNotes = labNoteLines(catalog.notes).map((text, i) => ({ id: `N${i + 1}`, text }));
  const labNotes = labNoteLines(labNotesText).map((text, i) => ({ id: `L${i + 1}`, text }));
  const links = linkSources(catalog);

  const sources: SkillSource[] = [
    { id: "T1", kind: "catalog", toolName: tool.name },
    ...toolNotes.map((note) => ({ id: note.id, kind: "lab_note" as const, scope: "tool" as const, text: note.text })),
    ...labNotes.map((note) => ({ id: note.id, kind: "lab_note" as const, scope: "lab" as const, text: note.text })),
    ...(research ? [{ id: "R1", kind: "research" as const, urls: research.urls, researchedAt: research.researchedAt }] : []),
    ...links.map((link) => ({ id: link.id, kind: "link" as const, title: link.title, type: link.type, url: link.url })),
    ...passages.map((passage) => ({
      id: passage.id,
      kind: "manual" as const,
      documentId: passage.documentId,
      title: passage.title,
      pageStart: passage.pageStart,
      pageEnd: passage.pageEnd,
      section: passage.section,
    })),
  ];

  return { tool, toolNotes, labNotes, research, links, passages, sources };
}

/** Whether there is anything beyond the catalogue record to write a guide from (§5.1). */
export function hasSkillMaterial(inputs: SkillInputs): boolean {
  return inputs.passages.length > 0 || inputs.research !== null || inputs.toolNotes.length > 0;
}

// ── Research ────────────────────────────────────────────────────────

/** The newest research about the tool: the intake research that created it, or its latest refresh. */
async function loadResearch(db: Db, toolId: string): Promise<SkillResearch | null> {
  const [[intake], [refresh]] = await Promise.all([
    db
      .select({ research: pendingTools.research, at: pendingTools.approvedAt })
      .from(pendingTools)
      .where(and(eq(pendingTools.createdToolId, toolId), isNotNull(pendingTools.research)))
      .orderBy(desc(pendingTools.approvedAt))
      .limit(1),
    db
      .select({ research: toolRefreshes.research, at: toolRefreshes.updatedAt })
      .from(toolRefreshes)
      .where(and(eq(toolRefreshes.toolId, toolId), isNotNull(toolRefreshes.research)))
      .orderBy(desc(toolRefreshes.updatedAt))
      .limit(1),
  ]);
  const candidates = [intake, refresh]
    .filter((row): row is { research: ResearchResult | null; at: Date | null } => Boolean(row))
    .map((row) => ({ result: parseResearchResult(row.research), at: row.at ? new Date(row.at) : null }))
    .filter((row): row is { result: ResearchResult; at: Date | null } => row.result !== null)
    .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
  const newest = candidates[0];
  if (!newest) return null;
  const urls = [...new Set(newest.result.sourceUrls)].filter((url) => /^https?:\/\//i.test(url)).slice(0, SKILL_RESEARCH_MAX_URLS);
  return {
    id: "R1",
    text: researchText(newest.result, urls).slice(0, SKILL_RESEARCH_MAX_CHARS),
    urls,
    researchedAt: newest.at ? newest.at.toISOString() : null,
  };
}

/** The research summary the writer reads: what research found, and the pages it read. */
export function researchText(result: ResearchResult, urls: readonly string[]): string {
  const lines: string[] = [];
  if (result.canonicalName) lines.push(`Official name: ${result.canonicalName}`);
  if (result.description) lines.push(`Description: ${result.description}`);
  const specs = result.specs.slice(0, SKILL_RESEARCH_MAX_SPECS);
  if (specs.length > 0) {
    lines.push("Specs:");
    for (const spec of specs) lines.push(`- ${spec.label}: ${spec.value}`);
  }
  if (result.materials.length > 0) lines.push(`Materials: ${result.materials.join(", ")}`);
  if (result.useRestrictions) lines.push(`Use restrictions: ${result.useRestrictions}`);
  if (result.emergencyStop) lines.push(`Emergency stop: ${result.emergencyStop}`);
  if (result.trainingRequired !== null) lines.push(`Training required (as research read it): ${result.trainingRequired ? "yes" : "no"}`);
  if (urls.length > 0) {
    lines.push("Pages read:");
    for (const url of urls) lines.push(`- ${url}`);
  }
  return lines.join("\n");
}

// ── Linked documents ────────────────────────────────────────────────

/** A link a skill may print: the manufacturer's address, never a stored file's. */
export function portableUrl(link: { href: string; sourceHref?: string }): string | null {
  const url = (link.sourceHref ?? link.href ?? "").trim();
  if (!/^https?:\/\//i.test(url)) return null;
  if (/\/api\/dev-blob\//i.test(url) || /\.blob\.vercel-storage\.com\//i.test(url)) return null;
  return url;
}

function linkSources(tool: MakerLabTool): SkillLink[] {
  const seen = new Set<string>();
  const out: SkillLink[] = [];
  for (const link of tool.links) {
    const url = portableUrl(link);
    const title = link.label.trim();
    const key = `${title.toLowerCase()}|${url ?? ""}`;
    if (!title || seen.has(key)) continue;
    seen.add(key);
    out.push({ id: `K${out.length + 1}`, title, type: link.labDocument ? "Lab document" : (link.kind ?? null), url });
    if (out.length >= SKILL_MAX_LINKS) break;
  }
  return out;
}

// ── Manual passages ─────────────────────────────────────────────────

async function loadPassages(db: Db, toolId: string, search: Search): Promise<SkillPassage[]> {
  const out: SkillPassage[] = [];
  const used = new Map<string, Set<number>>();
  let budget = SKILL_MANUAL_MAX_CHARS;
  for (const { topic, query } of SKILL_MANUAL_TOPICS) {
    let passages: ManualPassage[];
    try {
      passages = (
        await search(db, { query, toolIds: [toolId], limit: SKILL_PASSAGES_PER_TOPIC, mode: "fts", publicFilesOnly: true })
      ).passages;
    } catch {
      console.warn(`[skills] manual search failed for tool=${toolId} topic=${topic}; going on without it`);
      continue;
    }
    for (const passage of passages) {
      if (passage.toolId && passage.toolId !== toolId) continue;
      const seen = used.get(passage.documentId) ?? new Set<number>();
      if (passage.ordinals.some((ordinal) => seen.has(ordinal))) continue;
      const content = passage.content.trim().slice(0, PASSAGE_MAX_CHARS);
      if (!content || content.length + 200 > budget) continue;
      for (const ordinal of passage.ordinals) seen.add(ordinal);
      used.set(passage.documentId, seen);
      budget -= content.length + 200;
      out.push({
        id: `M${out.length + 1}`,
        topic,
        documentId: passage.documentId,
        title: passage.documentTitle,
        pageStart: passage.pageStart,
        pageEnd: passage.pageEnd,
        section: passage.sectionPath,
        content,
      });
    }
  }
  return out;
}

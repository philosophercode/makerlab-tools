import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { listToolManualsForChat } from "../data/manual-chunks.ts";
import { categories } from "../db/schema/taxonomy.ts";
import { manualChunks, manualDocuments } from "../db/schema/manuals.ts";
import { resources } from "../db/schema/resources.ts";
import { tools } from "../db/schema/tools.ts";
import type { Db } from "../db/types.ts";

/**
 * What the starter-answer grader and question writer are told about a tool
 * (starter answers): its record as a visitor sees it, and what its
 * **searchable** manuals — the ones a cached answer can cite — actually
 * cover: each manual's contents (levels 1–2) and a spread of passage
 * snippets with their section paths and pages. Only public manuals on
 * published resources, as for an anonymous visitor.
 */

export interface ManualCoverage {
  title: string;
  pageCount: number | null;
  sections: { title: string; page: number }[];
  snippets: { section: string; page: number; text: string }[];
}

export interface StarterToolContext {
  id: string;
  slug: string;
  name: string;
  /** The record in plain lines, for the prompts. */
  record: string;
  manuals: ManualCoverage[];
}

const MAX_SECTIONS = 40;
const SNIPPETS_PER_MANUAL = 10;
const SNIPPET_CHARS = 220;

export async function loadStarterToolContext(db: Db, toolId: string): Promise<StarterToolContext | null> {
  const [tool] = await db
    .select({
      id: tools.id,
      slug: tools.slug,
      name: tools.name,
      officialName: tools.officialName,
      description: tools.description,
      materials: tools.materials,
      tags: tools.tags,
      trainingRequired: tools.trainingRequired,
      useRestrictions: tools.useRestrictions,
      category: categories.name,
    })
    .from(tools)
    .leftJoin(categories, eq(categories.id, tools.categoryId))
    .where(eq(tools.id, toolId))
    .limit(1);
  if (!tool) return null;

  const [resourceRows, manuals] = await Promise.all([
    db
      .select({ title: resources.title, type: resources.type })
      .from(resources)
      .where(and(eq(resources.toolId, toolId), eq(resources.published, true)))
      .orderBy(asc(resources.title)),
    listToolManualsForChat(db, toolId, { includePrivate: false }),
  ]);
  const searchable = manuals.filter((m) => m.searchable && m.documentId);
  const documentIds = searchable.map((m) => m.documentId as string);
  const chunks = documentIds.length
    ? await db
        .select({
          documentId: manualChunks.documentId,
          ordinal: manualChunks.ordinal,
          sectionPath: manualChunks.sectionPath,
          pageStart: manualChunks.pageStart,
          content: manualChunks.content,
        })
        .from(manualChunks)
        .where(inArray(manualChunks.documentId, documentIds))
        .orderBy(asc(manualChunks.documentId), asc(manualChunks.ordinal))
    : [];

  const record = [
    `Name: ${tool.name}`,
    tool.officialName && tool.officialName !== tool.name ? `Official name: ${tool.officialName}` : null,
    tool.category ? `Category: ${tool.category}` : null,
    `Description: ${(tool.description ?? "").trim() || "(none recorded)"}`,
    tool.materials.length ? `Materials: ${tool.materials.join(", ")}` : null,
    tool.tags.length ? `Tags: ${tool.tags.join(", ")}` : null,
    `Training required: ${tool.trainingRequired ? "yes" : "no"}`,
    tool.useRestrictions ? `Use restrictions: ${tool.useRestrictions}` : null,
    resourceRows.length ? `Resources: ${resourceRows.map((r) => `${r.title}${r.type ? ` (${r.type})` : ""}`).join("; ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    id: tool.id,
    slug: tool.slug,
    name: tool.name,
    record,
    manuals: searchable.map((manual) => {
      const own = chunks.filter((c) => c.documentId === manual.documentId);
      return {
        title: manual.title,
        pageCount: manual.pageCount,
        sections: manual.outline
          .filter((entry) => entry.level <= 2)
          .slice(0, MAX_SECTIONS)
          .map((entry) => ({ title: entry.title, page: entry.page })),
        snippets: spread(own, SNIPPETS_PER_MANUAL).map((chunk) => ({
          section: chunk.sectionPath.join(" › "),
          page: chunk.pageStart,
          text: oneLine(chunk.content).slice(0, SNIPPET_CHARS),
        })),
      };
    }),
  };
}

/** `n` items spread evenly over `items`, first and last included. Pure. */
export function spread<T>(items: readonly T[], n: number): T[] {
  if (items.length <= n) return [...items];
  if (n <= 1) return items.slice(0, n);
  const out: T[] = [];
  for (let i = 0; i < n; i += 1) out.push(items[Math.round((i * (items.length - 1)) / (n - 1))]);
  return out;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The coverage as prompt text. Pure. */
export function describeCoverage(manuals: readonly ManualCoverage[]): string {
  if (manuals.length === 0) return "(no searchable manual — only the record above can be cited)";
  return manuals
    .map((manual) =>
      [
        `## ${manual.title}${manual.pageCount ? ` (${manual.pageCount} pages)` : ""}`,
        manual.sections.length ? `Contents: ${manual.sections.map((s) => `${s.title} (p. ${s.page})`).join("; ")}` : "Contents: (no outline)",
        ...manual.snippets.map((s) => `- p. ${s.page}${s.section ? ` · ${s.section}` : ""}: ${s.text}`),
      ].join("\n")
    )
    .join("\n\n");
}

/** The general chips' coverage: which published tools have a searchable manual, and its title. */
export async function loadGeneralCoverage(db: Db): Promise<string> {
  const rows = await db
    .selectDistinct({ tool: tools.name, manual: manualDocuments.title })
    .from(manualDocuments)
    .innerJoin(tools, eq(tools.id, manualDocuments.toolId))
    .where(
      and(
        eq(tools.published, true),
        sql`${tools.archivedAt} is null`,
        eq(manualDocuments.status, "ready"),
        sql`${manualDocuments.chunkerVersion} is not null`
      )
    )
    .orderBy(asc(tools.name));
  if (rows.length === 0) return "(no searchable manual in the lab)";
  return `Tools with a searchable manual:\n${rows.map((row) => `- ${row.tool}: ${row.manual}`).join("\n")}`;
}

/** A short line about the lab for the general chips' prompts: its categories and a count. */
export async function loadLabSummary(db: Db): Promise<string> {
  const rows = await db
    .select({ category: categories.name, n: sql<number>`count(*)::int` })
    .from(tools)
    .leftJoin(categories, eq(categories.id, tools.categoryId))
    .where(and(eq(tools.published, true), sql`${tools.archivedAt} is null`))
    .groupBy(categories.name)
    .orderBy(sql`count(*) desc`);
  const total = rows.reduce((sum, row) => sum + Number(row.n), 0);
  return `${total} published tools. By category: ${rows.map((row) => `${row.category ?? "Uncategorised"} (${row.n})`).join(", ")}.`;
}

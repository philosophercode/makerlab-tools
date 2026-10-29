import { z } from "zod";
import { countMaintenanceLogsForUnit, listUnitsForTool } from "../data/units";
import { countImportItemsByStatus, getBulkImport, listBulkImports, type BulkImportRecord, type BulkImportSummary } from "../data/bulk-imports";
import { listCategoryProposals } from "../data/category-admin";
import { listCategories } from "../data/taxonomy";
import { listPendingTools } from "../data/pending-tools";
import { listResourcesForEditor } from "../data/resources";
import { findToolForEditor } from "../data/tools";
import { latestPhotoSearch } from "../data/photo-searches";
import { photoOptionHost } from "../photo-options/types";
import { getDb } from "../db/client";
import { canActOnImport } from "../import/access";
import { fenceUntrusted, OTHERS_TEXT_NOTE } from "../web/fence";
import type { Capability, CapabilityTool } from "./types";

/**
 * The reads the catalogue and import actions need (assistant–GUI parity spec
 * §3.4 table): `get_tool_units` resolves "the second Prusa" or "the SOP link"
 * to ids, `list_imports` resolves "row 4 of the tool list". Gated like the
 * page each mirrors — the editor panel (`tools.edit`), the import review
 * (`tools.add`, and only the caller's own imports unless they review) — and
 * enforced once, by `capabilitiesForIdentity`.
 *
 * **An imported list is somebody else's text** (§8.4): its rows are fenced
 * as untrusted data, and reading them taints the turn
 * (`lib/chat/taint.ts`). Unit and resource fields are staff's own entries.
 *
 * **Over MCP too** (phase 7): the unit, resource and import proposals an MCP
 * client may make need these ids, and the gates are the same `can()`.
 */

// ── get_tool_units ──────────────────────────────────────────────────

interface ToolUnitsResult {
  found: boolean;
  tool?: { id: string; slug: string; name: string; state: "published" | "draft" | "archived" };
  units?: {
    id: string;
    label: string;
    serial_number: string | null;
    asset_tag: string | null;
    status: string;
    condition: string | null;
    date_acquired: string | null;
    maintenance_records: number;
  }[];
  resources?: { id: string; title: string; type: string | null; url: string | null; published: boolean; has_file: boolean; manual: string | null }[];
}

const getToolUnitsTool: CapabilityTool<{ tool: string }, ToolUnitsResult> = {
  name: "get_tool_units",
  description:
    "Get one tool's units (each machine: id, label, serial, asset tag, status, condition, how many maintenance records it has) and its resources (manuals, SOPs, links: id, title, kind, link, published, manual processing state), drafts and archived tools included — what the editor panel shows. Staff who edit the catalogue only. Use the ids with the unit and resource tools.",
  inputSchema: z.strictObject({ tool: z.string().min(1).max(200).describe("The tool's id or slug, from search_tools") }),
  kind: "read",
  requiredPermission: "tools.edit",
  run: async (input) => {
    const tool = await findToolForEditor(input.tool.trim());
    if (!tool) return { found: false };
    const db = await getDb();
    const [units, resources] = await Promise.all([listUnitsForTool(db, tool.id), listResourcesForEditor(db, tool.id)]);
    const history = await Promise.all(units.map((unit) => countMaintenanceLogsForUnit(db, unit.id)));
    return {
      found: true,
      tool: { id: tool.id, slug: tool.slug, name: tool.name, state: tool.archivedAt ? "archived" : tool.published ? "published" : "draft" },
      units: units.map((unit, i) => ({
        id: unit.id,
        label: unit.unitLabel,
        serial_number: unit.serialNumber,
        asset_tag: unit.assetTag,
        status: unit.status,
        condition: unit.condition,
        date_acquired: unit.dateAcquired,
        maintenance_records: history[i],
      })),
      resources: resources.map((resource) => ({
        id: resource.id,
        title: resource.title,
        type: resource.type,
        url: resource.url,
        published: resource.published,
        has_file: resource.fileUrls.length > 0,
        manual: resource.manual?.state ?? null,
      })),
    };
  },
};

// ── get_photo_options ───────────────────────────────────────────────

interface PhotoOptionsResult {
  found: boolean;
  tool?: { id: string; slug: string; name: string; editor: string };
  search?: { status: "searching" | "ready" | "failed" | "stalled"; requested_at: string; error: string | null };
  options?: string;
}

/**
 * The tool's latest photo options (photo options spec 2026-10-29 §6), numbered
 * as the editor numbers them, for `use_photo_option`. The pictures, their
 * hosts and the ranking's reasons come from the web, so the list is fenced as
 * untrusted and reading it taints the turn (`lib/chat/taint.ts`).
 */
const getPhotoOptionsTool: CapabilityTool<{ tool: string }, PhotoOptionsResult> = {
  name: "get_photo_options",
  description:
    "Get a tool's latest photo options — candidate cover photos find_photo_options found: each numbered, with where it is from, whether it is the manufacturer's own, its background and view, and the ranking's one-line reason — and whether the search is still running. Staff who edit the catalogue only. Use the number with use_photo_option; the person can also pick in the tool editor's Photos section.",
  inputSchema: z.strictObject({ tool: z.string().min(1).max(200).describe("The tool's id or slug, from search_tools") }),
  kind: "read",
  requiredPermission: "tools.edit",
  run: async (input) => {
    const tool = await findToolForEditor(input.tool.trim());
    if (!tool) return { found: false };
    const summary = { id: tool.id, slug: tool.slug, name: tool.name, editor: `/tools/${tool.slug}` };
    const search = await latestPhotoSearch(tool.id);
    if (!search) return { found: true, tool: summary };
    const status = search.status === "searching" && !search.running ? "stalled" : search.status;
    const lines = search.options.map((option, index) =>
      [
        `${index + 1}. from ${photoOptionHost(option) || "(unknown host)"}${option.manufacturer ? " — the manufacturer's own" : ""}`,
        `   ${option.width}×${option.height}, background ${option.background ?? "unknown"}, view ${option.view ?? "unknown"}${option.composite ? ", a banner or composite" : ""}`,
        option.reason ? `   reason: ${option.reason.replace(/\s+/g, " ").slice(0, 200)}` : "",
        search.chosenUrl === option.url ? "   (this is the current cover)" : "",
      ]
        .filter(Boolean)
        .join("\n")
    );
    return {
      found: true,
      tool: summary,
      search: { status, requested_at: search.requestedAt, error: search.error },
      options: fenceUntrusted("photo options (pictures found on the web, ranked by a model)", lines.join("\n") || "(none)"),
    };
  },
};

// ── list_imports ────────────────────────────────────────────────────

const ROWS_SHOWN = 100;

/**
 * How far an import has got (import progress spec §3.3): rows still to write,
 * and its items by where research has them — what "how's the import going?"
 * is answered from.
 */
interface ImportProgressCounts {
  rows_waiting: number;
  rows_skipped: number;
  to_research: number;
  queued: number;
  researching: number;
  ready_for_approval: number;
  research_failed: number;
  approved: number;
}

async function progressCounts(found: BulkImportRecord | BulkImportSummary): Promise<ImportProgressCounts> {
  const by = await countImportItemsByStatus(found.id);
  const written = Object.values(by).reduce((sum, n) => sum + (n ?? 0), 0);
  return {
    rows_waiting: found.status === "identifying" ? Math.max(0, (found.progress.total ?? written) - written) : 0,
    rows_skipped: found.progress.skipped?.length ?? 0,
    to_research: by.identified ?? 0,
    queued: by.queued ?? 0,
    researching: by.researching ?? 0,
    ready_for_approval: by.researched ?? 0,
    research_failed: by.failed ?? 0,
    approved: by.approved ?? 0,
  };
}

interface ListImportsResult {
  imports?: {
    id: string;
    file: string;
    status: string;
    rows: number;
    items: number;
    progress: ImportProgressCounts;
    added_by: string | null;
    added_at: string;
    review_page: string;
  }[];
  import?: { id: string; file: string; status: string; progress: ImportProgressCounts; review_page: string };
  rows?: string;
  found?: boolean;
}

const listImportsTool: CapabilityTool<{ import_id?: string }, ListImportsResult> = {
  name: "list_imports",
  description:
    "List bulk imports (the person's own; every one for a reviewer) with how far each has got — rows still being written, rows to research, queued, researching, ready for approval, failed — or, with an import_id, that import's progress and its rows: each row's id, row number, name, brand, hints, quantity, status, duplicate decision and any suggested name, fenced as untrusted text from the imported file. Staff who add equipment only.",
  inputSchema: z.strictObject({
    import_id: z.string().min(1).max(64).optional().describe("One import's id, to list its rows"),
  }),
  kind: "read",
  requiredPermission: "tools.add",
  run: async (input, ctx) => {
    if (!input.import_id) {
      const all = await listBulkImports({ limit: 20 });
      const mine = all.filter((row) => canActOnImport(ctx.identity, row));
      return {
        imports: await Promise.all(mine.map(async (row) => ({
          id: row.id,
          file: row.sourceName ?? "pasted list",
          status: row.status,
          rows: row.rowCount,
          items: row.itemCount,
          progress: await progressCounts(row),
          added_by: row.createdByName ?? null,
          added_at: row.createdAt.toISOString(),
          review_page: `/admin/intake/imports/${row.id}`,
        }))),
      };
    }
    const found = await getBulkImport(input.import_id);
    if (!found || !canActOnImport(ctx.identity, found)) return { found: false };
    const rows = (await listPendingTools({ importId: found.id, limit: null }))
      .sort((a, b) => (a.sourceRow ?? 0) - (b.sourceRow ?? 0))
      .slice(0, ROWS_SHOWN);
    const lines = rows.map((row) =>
      [
        `- id: ${row.id} · row ${row.sourceRow ?? "?"} · ${oneLine(row.name, 120)}${row.brand ? ` (${oneLine(row.brand, 60)})` : ""} · status: ${row.status}`,
        `  category hint: ${row.categoryHint ? oneLine(row.categoryHint, 60) : "(none)"} · location hint: ${row.locationHint ? oneLine(row.locationHint, 60) : "(none)"} · units: ${row.quantity}`,
        row.duplicateOf ? `  possible duplicate of: ${oneLine(row.duplicateOf.name, 80)} · decision: ${row.duplicateResolution ?? "undecided"}` : "",
        row.nameSuggestion ? `  suggested name: ${oneLine(row.nameSuggestion.canonicalName, 120)}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    );
    return {
      found: true,
      import: {
        id: found.id,
        file: found.sourceName ?? "pasted list",
        status: found.status,
        progress: await progressCounts(found),
        review_page: `/admin/intake/imports/${found.id}`,
      },
      rows: fenceUntrusted("an imported equipment list (rows from somebody's file)", lines.join("\n") || "(no rows yet)", OTHERS_TEXT_NOTE),
    };
  },
};

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

// ── list_categories / list_category_proposals (taxonomy v2) ─────────

interface ListCategoriesResult {
  categories: { slug: string; path: string; description: string | null; hidden_from_gallery: boolean }[];
}

/**
 * The lab's categories with their slugs and descriptions (taxonomy v2 spec
 * §4.6), so `recategorize_tool`, `propose_category` and `merge_categories`
 * can name one. Staff's own entries, not outside text.
 */
const listCategoriesTool: CapabilityTool<Record<string, never>, ListCategoriesResult> = {
  name: "list_categories",
  description:
    "List the lab's categories: each one's slug, its path (Parent › Name) and what belongs in it, and whether the public gallery hides it. Staff who edit the catalogue only. Use the slugs with recategorize_tool, propose_category and merge_categories.",
  inputSchema: z.strictObject({}),
  kind: "read",
  requiredPermission: "tools.edit",
  run: async () => {
    const categories = await listCategories();
    return {
      categories: categories.map((category) => ({
        slug: category.slug ?? "",
        path: category.group ? `${category.group} › ${category.name}` : category.name,
        description: category.description ?? null,
        hidden_from_gallery: Boolean(category.galleryHidden),
      })),
    };
  },
};

interface ListCategoryProposalsResult {
  proposals: string;
}

/**
 * The waiting category proposals (taxonomy v2 spec §4.6). A proposal's name,
 * description and reason were written by research, an MCP client or somebody
 * else — fenced as untrusted text, and reading them taints the turn.
 */
const listCategoryProposalsTool: CapabilityTool<Record<string, never>, ListCategoryProposalsResult> = {
  name: "list_category_proposals",
  description:
    "List the category proposals waiting on /admin/taxonomy: each one's id, kind (a new category, or the consolidation audit's flag on an existing one), proposed name and parent, source, the tool that prompted it and research's nearest existing category — fenced as untrusted text. Staff with taxonomy rights only. Use the ids with decide_category_proposal.",
  inputSchema: z.strictObject({}),
  kind: "read",
  requiredPermission: "taxonomy.manage",
  run: async () => {
    const [proposals, categories] = await Promise.all([listCategoryProposals({ decidedLimit: 0 }), listCategories({ includeRetired: true })]);
    const slugOf = new Map(categories.map((category) => [category.id, category.slug ?? category.name]));
    const lines = proposals
      .filter((proposal) => proposal.status === "pending")
      .map((proposal) =>
        [
          `- id: ${proposal.id} · ${proposal.kind === "review_category" ? `review (${proposal.flag ?? "flag"})` : "new category"} · ${oneLine(proposal.name, 80)}`,
          `  parent: ${proposal.parentId ? (slugOf.get(proposal.parentId) ?? "?") : "(top level)"} · source: ${proposal.source}` +
            ` · nearest existing: ${proposal.nearestExistingId ? (slugOf.get(proposal.nearestExistingId) ?? "?") : "(none)"}` +
            (proposal.subjectName ? ` · subject: ${oneLine(proposal.subjectName, 80)}` : ""),
          proposal.description ? `  description: ${oneLine(proposal.description, 300)}` : "",
          proposal.reason ? `  reason: ${oneLine(proposal.reason, 300)}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      );
    return { proposals: fenceUntrusted("category proposals (written by research, assistants or other people)", lines.join("\n") || "(none waiting)", OTHERS_TEXT_NOTE) };
  },
};

export const catalogReads: Capability = {
  id: "catalog-reads",
  // The actions capability's prompt names these; nothing of their own to add.
  promptFragment: () => "",
  tools: [
    getToolUnitsTool as unknown as CapabilityTool<unknown, unknown>,
    getPhotoOptionsTool as unknown as CapabilityTool<unknown, unknown>,
    listImportsTool as unknown as CapabilityTool<unknown, unknown>,
    listCategoriesTool as unknown as CapabilityTool<unknown, unknown>,
    listCategoryProposalsTool as unknown as CapabilityTool<unknown, unknown>,
  ],
};

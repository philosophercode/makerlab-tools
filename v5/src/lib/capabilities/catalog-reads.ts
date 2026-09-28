import { z } from "zod";
import { countMaintenanceLogsForUnit, listUnitsForTool } from "../data/units";
import { getBulkImport, listBulkImports } from "../data/bulk-imports";
import { listPendingTools } from "../data/pending-tools";
import { listResourcesForEditor } from "../data/resources";
import { findToolForEditor } from "../data/tools";
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

// ── list_imports ────────────────────────────────────────────────────

const ROWS_SHOWN = 100;

interface ListImportsResult {
  imports?: { id: string; file: string; status: string; rows: number; items: number; added_by: string | null; added_at: string; review_page: string }[];
  import?: { id: string; file: string; status: string; review_page: string };
  rows?: string;
  found?: boolean;
}

const listImportsTool: CapabilityTool<{ import_id?: string }, ListImportsResult> = {
  name: "list_imports",
  description:
    "List bulk imports (the person's own; every one for a reviewer), or — with an import_id — that import's rows: each row's id, row number, name, brand, hints, quantity, status, duplicate decision and any suggested name, fenced as untrusted text from the imported file. Staff who add equipment only.",
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
        imports: mine.map((row) => ({
          id: row.id,
          file: row.sourceName ?? "pasted list",
          status: row.status,
          rows: row.rowCount,
          items: row.itemCount,
          added_by: row.createdByName ?? null,
          added_at: row.createdAt.toISOString(),
          review_page: `/admin/intake/imports/${row.id}`,
        })),
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
      import: { id: found.id, file: found.sourceName ?? "pasted list", status: found.status, review_page: `/admin/intake/imports/${found.id}` },
      rows: fenceUntrusted("an imported equipment list (rows from somebody's file)", lines.join("\n") || "(no rows yet)", OTHERS_TEXT_NOTE),
    };
  },
};

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export const catalogReads: Capability = {
  id: "catalog-reads",
  // The actions capability's prompt names these; nothing of their own to add.
  promptFragment: () => "",
  tools: [getToolUnitsTool as unknown as CapabilityTool<unknown, unknown>, listImportsTool as unknown as CapabilityTool<unknown, unknown>],
};

import "server-only";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { MANUALS_PATH } from "../../app/admin/research/action-result";
import { markResourceManualsStale } from "../data/manual-chunks";
import { isUuid } from "../data/uuid";
import { getDb } from "../db/client";
import { resources, tools } from "../db/schema";
import { requestManualArchive } from "../manuals/trigger";
import { toolPage, type ToolRevisionInput } from "./catalog-write";
import { defineAction, toolShape, type ActionPreview } from "./define";

/**
 * **Re-process** a manual (manual text spec §5; assistant–GUI parity spec
 * §4.4 #34): extract its PDF again and rebuild its search passages, in the
 * archive workflow. Nothing is deleted — the stored text keeps serving until
 * the run replaces it — and nothing about the tool changes, so no revision
 * moves.
 *
 * **Spend** (§11 answer 3): the run reads the PDF again, so for the
 * assistant it is a card with the person's click, never over MCP.
 *
 * Two doors, two definitions, one write (`reprocess`): the editor's
 * Resources section (a resource of the tool it names, answering the panel's
 * revision back unchanged) and the Manuals library table (any resource,
 * answering nothing). The assistant has one tool, the editor's.
 */

/** The resource, if it exists — and, when a tool is named, only if it is that tool's. */
async function findResource(resourceId: string, toolId?: string) {
  if (!isUuid(resourceId) || (toolId !== undefined && !isUuid(toolId))) return null;
  const db = await getDb();
  const [row] = await db
    .select({ id: resources.id, title: resources.title, toolName: tools.name, slug: tools.slug })
    .from(resources)
    .leftJoin(tools, eq(tools.id, resources.toolId))
    .where(toolId === undefined ? eq(resources.id, resourceId) : and(eq(resources.id, resourceId), eq(resources.toolId, toolId)));
  return row ?? null;
}

/** Mark the current PDFs stale, then ask the archive to run. The start never throws. */
async function reprocess(resourceId: string): Promise<void> {
  await markResourceManualsStale(await getDb(), resourceId);
  await requestManualArchive([resourceId]);
}

async function reprocessPreview(resourceId: string, toolId?: string): Promise<ActionPreview | null> {
  const found = await findResource(resourceId, toolId);
  if (!found) return null;
  return {
    summary: { key: "manuals_reprocess", values: { title: found.title, tool: found.toolName ?? "—" } },
    rows: [],
    subjectName: found.title,
    ...(found.slug ? { link: toolPage(found.slug) } : {}),
  };
}

/** From the tool editor: the panel keeps the token it holds. */
export const MANUALS_REPROCESS = defineAction<ToolRevisionInput & { resourceId: string }, { revision: string }, "not_found">({
  id: "manuals.reprocess",
  toolName: "reprocess_manual",
  description:
    "Re-process one manual's PDF: extract its text again and rebuild its search passages (uses processing budget). Proposes the run; nothing starts until the person confirms it on the card.",
  permission: "tools.edit",
  risk: "spend",
  input: z.object({ toolId: z.string(), expectedRevision: z.string(), resourceId: z.string() }),
  invalidInput: "not_found",
  subject: (input) => ({ type: "resource", id: input.resourceId }),
  check: async (input) => ((await findResource(input.resourceId, input.toolId)) ? null : "not_found"),
  tool: toolShape(
    z.strictObject({
      tool_id: z.string().min(1).max(64).describe("The tool's id, from search_tools"),
      resource_id: z.string().min(1).max(64).describe("The manual's resource id, from get_tool_units"),
    }),
    // Nothing about the tool changes, so there is no revision to hold.
    (args) => ({ ok: true, inputs: [{ toolId: args.tool_id, expectedRevision: "", resourceId: args.resource_id }] })
  ),
  preview: (input) => reprocessPreview(input.resourceId, input.toolId),
  run: async (input) => {
    await reprocess(input.resourceId);
    return { ok: true, value: { revision: input.expectedRevision }, committed: true };
  },
  // No page refresh, as before: the panel polls the manual's state itself.
});

/** From the Manuals library table: any resource, by id. */
export const MANUALS_REPROCESS_LIBRARY = defineAction<{ resourceId: string }, object, "not_found">({
  id: "manuals.reprocess_library",
  toolName: "reprocess_library_manual",
  description: "Re-process one manual's PDF from the Manuals library table.",
  permission: "tools.edit",
  risk: "spend",
  assistant: "never",
  neverReason: "The same run as reprocess_manual, offered from the library table; the assistant has the one tool",
  input: z.object({ resourceId: z.string() }),
  invalidInput: "not_found",
  subject: (input) => ({ type: "resource", id: input.resourceId }),
  check: async (input) => ((await findResource(input.resourceId)) ? null : "not_found"),
  run: async (input) => {
    await reprocess(input.resourceId);
    return { ok: true, value: {}, committed: true };
  },
  revalidate: [MANUALS_PATH],
});

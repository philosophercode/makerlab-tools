import "server-only";

import { z } from "zod";
import { INVENTORY_PATH } from "../../app/admin/inventory/action-result";
import { findToolForEditor } from "../data/tools";
import type { Revision } from "../data/revision";
import type { InventoryWriteError, InventoryWriteResult, InventoryWriteWarning } from "../inventory/result";
import type { ToolWriteContext } from "../inventory/tool-transaction";
import { requestMirrorPushAfterResponse } from "../mirror/after-response";
import type { ActionContext, ActionOutcome } from "./define";

/**
 * What every tool-editor action shares (assistant–GUI parity spec §4.4, §9
 * phase 4): the panel's revision token on the input, the write context built
 * from the gate's identity, and — only once something landed — the Notion
 * mirror told. The same moves `app/admin/inventory/tool-write-context.ts`
 * made for the panel; the panel's refresh of `/admin/inventory` is each
 * definition's `revalidate`.
 */

/** The panel's half of every editor write: which tool, at which revision. */
export interface ToolRevisionInput {
  toolId: string;
  /** The token the panel (or, for a card, the proposal) read. A save since answers `conflict`. */
  expectedRevision: Revision;
}

/**
 * As lenient as the server actions it replaced (phase 1 deviation 5): they
 * handed whatever arrived to the data layer, which answers `not_found` for an
 * id that is not one.
 */
export const toolRevisionInput = z.object({ toolId: z.string(), expectedRevision: z.string() });

/** What a successful editor write answers besides `ok`: the next token, any warning, its payload. */
export type InventoryValue<T> = { revision: Revision; warning?: InventoryWriteWarning } & T;

/** An editor write's own refusals, minus the gate's (which `ActionOutcome` adds back). */
export type InventoryRefusal = Exclude<InventoryWriteError, "failed">;

/** The write context for the gate's identity: the actor is never the input's. */
export function writeContext(input: ToolRevisionInput, ctx: ActionContext): ToolWriteContext {
  return { toolId: input.toolId, expectedRevision: input.expectedRevision, actorUserId: ctx.identity.userId };
}

/** An inventory write's answer as an action outcome. The warning stays on the value, as the panel reads it. */
export function inventoryOutcome<T extends object>(
  result: InventoryWriteResult<T>
): ActionOutcome<InventoryValue<T>, InventoryRefusal, true> {
  if (!result.ok) return { ok: false, error: result.error };
  const value: Record<string, unknown> = { ...result };
  delete value.ok;
  return { ok: true, value: value as InventoryValue<T>, committed: true };
}

/**
 * Every editor write tells the mirror once it landed (§3.8 trigger 1), after
 * the response is sent (`mirror/after-response.ts`). Never throws.
 */
export async function tellMirror(): Promise<undefined> {
  requestMirrorPushAfterResponse();
  return undefined;
}

export const INVENTORY_REVALIDATE = [INVENTORY_PATH];

/** The tool behind a model-written id or slug, drafts and archived tools included. */
export interface ToolRef {
  id: string;
  slug: string;
  name: string;
  revision: Revision;
  published: boolean;
  archived: boolean;
  lastReviewedAt: Date | null;
}

/**
 * Resolve a tool reference for a proposal: the id and the revision **as of
 * now**, which the proposal stores, so a save in the editor between the card
 * and the click answers `conflict` exactly as it would for a second panel.
 * An unknown reference keeps the text as the id; its preview answers
 * `not_found` for that row.
 */
export async function toolRef(ref: string): Promise<ToolRef | null> {
  const tool = await findToolForEditor(ref.trim());
  if (!tool) return null;
  return {
    id: tool.id,
    slug: tool.slug,
    name: tool.name,
    revision: tool.revision,
    published: tool.published,
    archived: tool.archivedAt !== null,
    lastReviewedAt: tool.lastReviewedAt,
  };
}

/** A tool id the model gave, as the proposal will store it. */
export async function revisionInputFor(ref: string): Promise<ToolRevisionInput> {
  const tool = await toolRef(ref);
  return tool ? { toolId: tool.id, expectedRevision: tool.revision } : { toolId: ref, expectedRevision: "" };
}

/** A tool id or slug, as the model writes one. */
export const TOOL_REF = z.string().min(1).max(200).describe("The tool's id (or slug), from search_tools or get_tool_details");

/** The tool's own page, where the editor panel opens. */
export function toolPage(slug: string): string {
  return `/tools/${slug}`;
}

import { resolveIdentityFromHeaders } from "../../../lib/auth/identity";
import { can } from "../../../lib/auth/permissions";
import { loadToolEditor, type ToolEditorData } from "../../../lib/data/tool-editor";

/**
 * A landed editor write's answer, with the tool as it now stands (performance
 * plan, "Make a tool-editor save a single round trip"). The panel used to
 * follow every save with a second server action, `loadToolForEditor` — its own
 * gate, rate limit and reads, queued behind the first — before it could say
 * "Saved". Reading here costs the same queries and no round trip.
 *
 * Only for a caller who may open the editor (`tools.edit`): the read shows
 * drafts, unpublished resources and retired units. A read that fails leaves
 * the result as it was; the panel falls back to reading for itself.
 *
 * Not a `"use server"` module: nothing here is an endpoint.
 */
export async function withFreshEditor<R extends { ok: boolean }>(
  toolId: string,
  result: R
): Promise<R & { editor?: ToolEditorData }> {
  if (!result.ok) return result;
  try {
    if (!can(await resolveIdentityFromHeaders(), "tools.edit")) return result;
    const editor = await loadToolEditor(toolId);
    return editor ? { ...result, editor } : result;
  } catch (err) {
    console.warn("[admin/inventory] could not re-read the tool after a write", err);
    return result;
  }
}

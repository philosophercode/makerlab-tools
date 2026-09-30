import "server-only";

import { z } from "zod";
import { MIRROR_PATH, type MirrorActionError } from "../../app/admin/mirror/action-result";
import type { AdminGateError } from "../admin/action-result";
import { record, warn } from "../admin/audit-warning";
import { disconnectMirror, getMirrorForOwner, setMirrorPaused } from "../data/mirrors";
import { scrubSecrets } from "../mirror/notion-client";
import { syncMirrorNow } from "../mirror/start";
import { auditTrail, defineAction, toolShape, type ActionContext, type ActionOutcome, type ActionPreview } from "./define";

/**
 * The Notion mirror's running controls (spec §3.8, §5.8; assistant–GUI parity
 * spec §4.8 #51, §9 phase 6): **Sync now**, **Pause** / **Resume** and
 * **Disconnect**. Moved from `app/admin/mirror/actions.ts`; the setup calls
 * that take a Notion secret or a mapping stay there, never the assistant's
 * (§2).
 *
 * **A mirror is its owner's, and nothing here takes its id**: every action
 * finds the caller's own (`getMirrorForOwner`), so there is no argument
 * through which one admin could run, pause or disconnect another's. **Never
 * over MCP** (§4.9 row 51). **A thrown error is logged scrubbed** of anything
 * token- or email-shaped (§8), never raw.
 */

type MirrorRefusal = Exclude<MirrorActionError, AdminGateError>;

/** No input at all, as the page sends; an empty object, as a stored proposal holds. Anything else is refused. */
const noInput = z.union([z.undefined(), z.strictObject({})]);

function scrubbed(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const secrets = [process.env.AUTH_SECRET].filter((value): value is string => Boolean(value));
  return scrubSecrets(text, secrets).slice(0, 500);
}

/** Run `act` for the signed-in owner; a throw becomes `failed` with a scrubbed log line. */
async function asOwner<R, C>(
  ctx: ActionContext,
  act: (userId: string) => Promise<ActionOutcome<R, MirrorRefusal, C>>
): Promise<ActionOutcome<R, MirrorRefusal, C>> {
  const userId = ctx.identity.userId;
  if (!userId) return { ok: false, error: "not_signed_in" };
  try {
    return await act(userId);
  } catch (error) {
    console.error(`[admin/mirror] the action failed: ${scrubbed(error)}`);
    return { ok: false, error: "failed" };
  }
}

async function mirrorPreview(ctx: ActionContext, key: string, rows: ActionPreview["rows"] = []): Promise<ActionPreview | null> {
  const mirror = ctx.identity.userId ? await getMirrorForOwner(ctx.identity.userId) : null;
  if (!mirror?.hasToken) return null;
  const page = mirror.parentPageTitle ?? "Notion";
  return { summary: { key, values: { page } }, rows, subjectName: page, link: MIRROR_PATH };
}

// ── mirror.sync_now ─────────────────────────────────────────────────

/** **Sync now**: one push per mirror per 15 minutes (§8); the refusal carries how long is left. */
export const MIRROR_SYNC_NOW = defineAction<z.infer<typeof noInput>, object, MirrorRefusal>({
  id: "mirror.sync_now",
  toolName: "sync_mirror",
  description:
    "Push the catalogue to the person's own Notion mirror now (at most once per 15 minutes). Proposes the sync; nothing starts until the person confirms it on the card.",
  permission: "mirror.manage",
  risk: "operational",
  mcp: "never",
  input: noInput,
  invalidInput: "invalid_field",
  // The subject is the caller's own mirror; the input names none.
  subject: () => ({ type: "mirror", id: "mine" }),
  tool: toolShape(z.strictObject({}), () => ({ ok: true, inputs: [{}] })),
  preview: (_input, ctx) => mirrorPreview(ctx, "mirror_sync_now"),
  run: (_input, ctx) =>
    asOwner(ctx, async (userId) => {
      const mirror = await getMirrorForOwner(userId);
      if (!mirror?.hasToken) return { ok: false, error: "not_connected" };
      const synced = await syncMirrorNow(userId);
      if (synced.ok) return { ok: true, value: {}, committed: true };
      return synced.retryAfterSeconds !== undefined
        ? { ok: false, error: synced.code, retryAfterSeconds: synced.retryAfterSeconds }
        : { ok: false, error: synced.code };
    }),
  revalidate: [MIRROR_PATH],
});

// ── mirror.set_paused ───────────────────────────────────────────────

export const MIRROR_SET_PAUSED = defineAction<{ paused: boolean }, object, MirrorRefusal>({
  id: "mirror.set_paused",
  toolName: "pause_mirror",
  description:
    "Pause the person's own Notion mirror (no pushes until resumed), or resume it. Proposes the change; nothing changes until the person confirms it on the card.",
  permission: "mirror.manage",
  risk: "operational",
  mcp: "never",
  input: z.strictObject({ paused: z.boolean() }),
  invalidInput: "invalid_field",
  subject: () => ({ type: "mirror", id: "mine" }),
  tool: toolShape(z.strictObject({ paused: z.boolean().describe("true to pause, false to resume") }), (args) => ({
    ok: true,
    inputs: [{ paused: args.paused }],
  })),
  preview: async (input, ctx) => {
    const mirror = ctx.identity.userId ? await getMirrorForOwner(ctx.identity.userId) : null;
    return mirrorPreview(ctx, input.paused ? "mirror_pause" : "mirror_resume", [
      { field: "mirrorPaused", before: mirror?.pausedAt ? "paused" : "running", after: input.paused ? "paused" : "running" },
    ]);
  },
  run: (input, ctx) =>
    asOwner(ctx, async (userId) =>
      (await setMirrorPaused(userId, input.paused)) ? { ok: true, value: {}, committed: true } : { ok: false, error: "not_connected" }
    ),
  revalidate: [MIRROR_PATH],
});

// ── mirror.disconnect ───────────────────────────────────────────────

/**
 * **Disconnect**: the stored token goes; the mapping and the pages stay for a
 * reconnect. Audited as `mirror.disconnected`. Never the assistant's (owner
 * decision 2026-09-27): only the mirror page's button.
 */
export const MIRROR_DISCONNECT = defineAction<z.infer<typeof noInput>, object, MirrorRefusal>({
  id: "mirror.disconnect",
  toolName: "disconnect_mirror",
  description:
    "Disconnect the person's own Notion mirror (the stored Notion token is deleted; reconnecting needs it pasted again).",
  permission: "mirror.manage",
  risk: "destructive",
  assistant: "never",
  neverReason: "Disconnecting the mirror deletes a stored secret; it is the mirror page's alone (owner decision 2026-09-27)",
  input: noInput,
  invalidInput: "invalid_field",
  subject: () => ({ type: "mirror", id: "mine" }),
  run: (_input, ctx) =>
    asOwner(ctx, async (userId) => {
      const mirror = await getMirrorForOwner(userId);
      if (!mirror?.hasToken) return { ok: false, error: "not_connected" };
      if (!(await disconnectMirror(userId))) return { ok: false, error: "not_connected" };
      const recorded = await record(
        { ...auditTrail(ctx), actorUserId: userId, action: "mirror.disconnected", subjectType: "mirror", subjectId: mirror.id },
        "admin/mirror"
      );
      return { ok: true, value: {}, committed: true, ...warn(undefined, recorded) };
    }),
  revalidate: [MIRROR_PATH],
});

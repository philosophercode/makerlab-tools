"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeAdminAction } from "../../../lib/admin/action-gate";
import { record, warn } from "../../../lib/admin/audit-warning";
import type { Identity } from "../../../lib/auth/identity";
import { disconnectMirror, getMirrorForOwner, setMirrorPaused, type MirrorRecord } from "../../../lib/data/mirrors";
import { MIRROR_ENTITY, type MirrorEntity } from "../../../lib/db/schema/vocabulary";
import { connectMirror, mirrorTokenSchema, testMirrorConnection } from "../../../lib/mirror/connect";
import { applyPastedMapping, ensureMirrorDatabases } from "../../../lib/mirror/databases";
import { scrubSecrets } from "../../../lib/mirror/notion-client";
import { parseNotionId } from "../../../lib/mirror/notion-id";
import { syncMirrorNow } from "../../../lib/mirror/start";
import { MIRROR_SETUP_TIER, rateLimitAsync } from "../../../lib/rate-limit";
import {
  MIRROR_PATH,
  type MirrorActionFailure,
  type MirrorActionResult,
  type MirrorConnectActionResult,
  type MirrorCreateResult,
  type MirrorTestResult,
} from "./action-result";

/**
 * The mirror page's endpoints (spec §3.8, §5.8, §8).
 *
 * **A mirror is its owner's, and nothing here takes its id.** Every action
 * finds the mirror from the session's `userId` (`getMirrorForOwner`), so there
 * is no parameter through which one admin could read, run, pause or disconnect
 * another's (§8 "A mirror can be read, run, paused and disconnected only by its
 * owner"). A body carrying a `mirrorId` is refused as `invalid_field` by the
 * strict schemas below rather than ignored.
 *
 * **Each action checks itself**, in the order every admin action does:
 * `authorizeAdminAction("mirror.manage")` (identity, `ADMIN_ACTION_TIER`, the
 * permission), then — for the four setup calls that spend the admin's Notion
 * token (test, connect, create databases, save mapping) — `MIRROR_SETUP_TIER`,
 * then the input. A server action is a POST endpoint with a generated name; the
 * page having checked `mirror.manage` is evidence of nothing.
 *
 * **The token comes in and never goes back out.** No result carries it, no
 * refusal is built from it, and a thrown error is logged only after
 * `scrubSecrets` has taken the token (and anything token- or email-shaped) out
 * of its text (§8, §10).
 *
 * **Refusals are values** rendered from `admin.errors.<code>` or
 * `admin.mirror.errors.<code>` (`mirrorErrorMessageKey`). A change that landed
 * minus its audit event is `{ ok: true, warning: "audit_unavailable" }`, never
 * a failure (§4.11). Only async exports: the shapes and the path live in
 * `./action-result.ts`.
 */

/** Names this surface in the console line a failed write leaves behind. */
const SURFACE = "admin/mirror";

// ── Input shapes ────────────────────────────────────────────────────

const connectInput = z.strictObject({
  token: z.string().max(4096),
  pageUrl: z.string().max(4096),
});

const pausedInput = z.strictObject({ paused: z.boolean() });

const mappingInput = z.strictObject(
  Object.fromEntries(MIRROR_ENTITY.map((entity) => [entity, z.string().max(2048).optional()])) as Record<
    MirrorEntity,
    z.ZodOptional<z.ZodString>
  >
);

const noInput = z.undefined();

// ── Actions ─────────────────────────────────────────────────────────

/** **Test connection**: read the page with the pasted token and show its title. Stores nothing. */
export async function testConnection(input: unknown): Promise<MirrorTestResult> {
  const options = { setup: true, refresh: false, schema: connectInput, input, secret: tokenOf(input) };
  return run(options, async (_identity, parsed) => {
    const tested = await testMirrorConnection(parsed.token, parsed.pageUrl);
    return tested.ok ? { ok: true, pageId: tested.pageId, title: tested.title } : { ok: false, error: tested.code };
  });
}

/**
 * **Connect**: the same read, then store the token encrypted (§8: validated by
 * one read, never stored unverified). Reconnecting keeps the mapping and the
 * pages. Audited as `mirror.connected`, with the page id and nothing else.
 */
export async function connect(input: unknown): Promise<MirrorConnectActionResult> {
  return run({ setup: true, schema: connectInput, input, secret: tokenOf(input) }, async (identity, parsed) => {
    const connected = await connectMirror(identity.userId, parsed.token, parsed.pageUrl);
    if (!connected.ok) return { ok: false, error: connected.code };

    const recorded = await record(
      {
        actorUserId: identity.userId,
        action: "mirror.connected",
        subjectType: "mirror",
        subjectId: connected.mirror.id,
        detail: { parentPageId: connected.pageId },
      },
      SURFACE
    );
    return { ok: true, title: connected.title, ...warn(undefined, recorded) };
  });
}

/**
 * **Create databases**: make every mapped-but-missing database under the
 * connected page (§3.8, §5.8). A failure part-way still made some — they are
 * in the mapping, and the answer names them.
 */
export async function createDatabases(input?: unknown): Promise<MirrorCreateResult> {
  return run({ setup: true, schema: noInput, input }, async (identity) => {
    const mirror = await ownMirror(identity);
    if (!mirror?.hasToken) return { ok: false, error: "not_connected" };

    const ensured = await ensureMirrorDatabases(mirror.id);
    if (ensured.ok) return { ok: true, created: ensured.created, kept: ensured.kept };
    return { ok: false, error: ensured.code, created: ensured.created, entity: ensured.entity };
  });
}

/**
 * **Save** pasted database ids: each is checked against the schema it must
 * have, and nothing is saved unless every one passes. The problems come back
 * per entity, naming the missing and wrong-typed properties.
 */
export async function saveMapping(input: unknown): Promise<MirrorActionResult> {
  return run({ setup: true, schema: mappingInput, input }, async (identity, parsed) => {
    const pasted: Partial<Record<MirrorEntity, string>> = {};
    const unparsable: MirrorEntity[] = [];
    for (const entity of MIRROR_ENTITY) {
      const raw = parsed[entity]?.trim();
      if (!raw) continue;
      const id = parseNotionId(raw);
      if (id) pasted[entity] = id;
      else unparsable.push(entity);
    }
    if (unparsable.length > 0) {
      return {
        ok: false,
        error: "invalid_database_id",
        problems: unparsable.map((entity) => ({ entity, code: "invalid_database_id" as const })),
      };
    }
    if (Object.keys(pasted).length === 0) return { ok: false, error: "invalid_database_id", problems: [] };

    const mirror = await ownMirror(identity);
    if (!mirror?.hasToken) return { ok: false, error: "not_connected" };

    const applied = await applyPastedMapping(mirror.id, pasted);
    return applied.ok ? { ok: true } : { ok: false, error: applied.code, problems: applied.problems };
  });
}

/**
 * **Sync now**: one push per mirror per 15 minutes (§8). The refusal carries
 * how long is left, which the page shows beside the disabled button.
 */
export async function syncNow(input?: unknown): Promise<MirrorActionResult> {
  return run({ setup: false, schema: noInput, input }, async (identity) => {
    const mirror = await ownMirror(identity);
    if (!mirror?.hasToken) return { ok: false, error: "not_connected" };

    const synced = await syncMirrorNow(identity.userId);
    if (synced.ok) return { ok: true };
    return synced.retryAfterSeconds !== undefined
      ? { ok: false, error: synced.code, retryAfterSeconds: synced.retryAfterSeconds }
      : { ok: false, error: synced.code };
  });
}

/** **Pause** / **Resume**. A paused mirror is skipped by every trigger. Not audited (§4.11). */
export async function setPaused(input: unknown): Promise<MirrorActionResult> {
  return run({ setup: false, schema: pausedInput, input }, async (identity, parsed) => {
    const updated = await setMirrorPaused(identity.userId, parsed.paused);
    return updated ? { ok: true } : { ok: false, error: "not_connected" };
  });
}

/**
 * **Disconnect** forgets the token (§3.8). The mapping and the pages stay, so
 * connecting again updates the same Notion pages instead of duplicating them.
 * Audited as `mirror.disconnected`.
 */
export async function disconnect(input?: unknown): Promise<MirrorActionResult> {
  return run({ setup: false, schema: noInput, input }, async (identity) => {
    const mirror = await ownMirror(identity);
    if (!mirror?.hasToken) return { ok: false, error: "not_connected" };
    if (!(await disconnectMirror(identity.userId))) return { ok: false, error: "not_connected" };

    const recorded = await record(
      {
        actorUserId: identity.userId,
        action: "mirror.disconnected",
        subjectType: "mirror",
        subjectId: mirror.id,
      },
      SURFACE
    );
    return { ok: true, ...warn(undefined, recorded) };
  });
}

// ── Internals ───────────────────────────────────────────────────────

/** An identity the gate let through, with the user id it is certain to have. */
type OwnerIdentity = Identity & { userId: string };

/** The caller's own mirror — the only one any action here can reach. */
function ownMirror(identity: OwnerIdentity): Promise<MirrorRecord | null> {
  return getMirrorForOwner(identity.userId);
}

/** The token in a raw body, if there is one — only so it can be scrubbed from a log line. */
function tokenOf(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const token = (input as { token?: unknown }).token;
  if (typeof token !== "string") return undefined;
  const parsed = mirrorTokenSchema.safeParse(token);
  return parsed.success ? parsed.data : token;
}

/** A thrown error as one line that holds no token, secret or email. */
function describe(error: unknown, secret: string | undefined): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const secrets = [secret, secret?.trim(), process.env.AUTH_SECRET].filter((value): value is string => Boolean(value));
  return scrubSecrets(text, secrets).slice(0, 500);
}

interface RunOptions<P> {
  /** Spends the admin's Notion token, so it also passes `MIRROR_SETUP_TIER`. */
  setup: boolean;
  schema: z.ZodType<P>;
  input: unknown;
  /** Scrubbed from the console line if the action throws. */
  secret?: string;
  /** Re-render the page after a success. Off only for Test connection, which changes nothing. */
  refresh?: boolean;
}

/**
 * Gate, limit, parse, act, refresh — each only as far as the last one earned.
 *
 * The gate runs before the parse, as on every admin action: an anonymous
 * prodder learns nothing about the input shape for free. A refusal refreshes
 * nothing, unless it changed something anyway — `createDatabases` stopping
 * part-way has still made databases and written them into the mapping, and
 * the page must show them.
 */
async function run<P, T extends { ok: boolean }>(
  options: RunOptions<P>,
  act: (identity: OwnerIdentity, parsed: P) => Promise<T | MirrorActionFailure>
): Promise<T | MirrorActionFailure> {
  const gate = await authorizeAdminAction("mirror.manage");
  if (!gate.ok) return gate;
  const { identity } = gate;
  const userId = identity.userId;
  if (!userId) return { ok: false, error: "not_signed_in" };

  if (options.setup) {
    const { allowed } = await rateLimitAsync(`mirror-setup:${identity.rateLimitKey}`, MIRROR_SETUP_TIER);
    if (!allowed) return { ok: false, error: "rate_limited" };
  }

  const parsed = options.schema.safeParse(options.input);
  if (!parsed.success) return { ok: false, error: "invalid_field" };

  let result: T | MirrorActionFailure;
  try {
    result = await act({ ...identity, userId }, parsed.data);
  } catch (error) {
    console.error(`[${SURFACE}] the action failed: ${describe(error, options.secret)}`);
    return { ok: false, error: "failed" };
  }

  const changedAnyway = !result.ok && ((result as MirrorActionFailure).created?.length ?? 0) > 0;
  if ((result.ok && options.refresh !== false) || changedAnyway) revalidatePath(MIRROR_PATH);
  return result;
}

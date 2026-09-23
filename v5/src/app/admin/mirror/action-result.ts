import type { AdminActionWarning, AdminGateError } from "../../../lib/admin/action-result";
import type { MirrorEntity } from "../../../lib/db/schema/vocabulary";
import { MIRROR_SETUP_ERRORS, type MappingProblem, type MirrorSetupError } from "../../../lib/mirror/types";

/**
 * What `/admin/mirror`'s server actions answer, and where they live.
 *
 * Directive-free for the reason every admin surface's result module is: a
 * `"use server"` module may export only async functions, and the mirror's
 * islands render these codes without importing the endpoints to get at their
 * shape. Its only runtime import is the client-safe `lib/mirror/types.ts`.
 */

/** The page every action refreshes. */
export const MIRROR_PATH = "/admin/mirror";

/**
 * Why a mirror action did nothing, or not all of it.
 *
 * Two families, rendered from two message namespaces: the gate's codes (and
 * `invalid_field`, a body that did not parse) from `admin.errors.<code>` like
 * every other admin surface, and the mirror's own from
 * `admin.mirror.errors.<code>`. The names do not overlap, so one union is
 * enough; {@link mirrorErrorMessageKey} says which namespace a code is in.
 */
export type MirrorActionError = AdminGateError | "invalid_field" | MirrorSetupError;

/** A refusal, with whatever the island needs to explain it. */
export interface MirrorActionFailure {
  ok: false;
  error: MirrorActionError;
  /** `sync_too_soon`: seconds until Sync now is allowed again. */
  retryAfterSeconds?: number;
  /** `saveMapping`: which pasted ids did not validate, and why. */
  problems?: MappingProblem[];
  /**
   * `createDatabases`: the databases made before it stopped. They exist in
   * Notion and are in the mapping — a failure that still changed something,
   * which the page must say rather than hide (Article 4).
   */
  created?: MirrorEntity[];
  /** `createDatabases`: the entity it stopped on, when there was one. */
  entity?: MirrorEntity | null;
}

/** A change that landed. A lost audit event rides here as `warning` (§4.11). */
export type MirrorActionResult = { ok: true; warning?: AdminActionWarning } | MirrorActionFailure;

/** **Test connection**: the page's title, and nothing stored. */
export type MirrorTestResult = { ok: true; pageId: string; title: string | null } | MirrorActionFailure;

/** **Connect**: the page it connected to. */
export type MirrorConnectActionResult =
  | { ok: true; title: string | null; warning?: AdminActionWarning }
  | MirrorActionFailure;

/** **Create databases**: which were made and which already existed. */
export type MirrorCreateResult =
  | { ok: true; created: MirrorEntity[]; kept: MirrorEntity[] }
  | MirrorActionFailure;

/** What Connect and Test connection send. The token travels in, never back out. */
export interface MirrorConnectInput {
  token: string;
  pageUrl: string;
}

/** Pasted database ids, by entity. An entity left out is not changed. */
export type MirrorMappingInput = Partial<Record<MirrorEntity, string>>;

/**
 * The bundle the page hands its islands. Built by the page rather than
 * exported from `actions.ts`, because a `"use server"` module may export only
 * async functions. None of them takes a mirror id: the server finds the
 * mirror from the session, so nobody can address somebody else's (§8).
 */
export interface MirrorActions {
  testConnection: (input: MirrorConnectInput) => Promise<MirrorTestResult>;
  connect: (input: MirrorConnectInput) => Promise<MirrorConnectActionResult>;
  createDatabases: () => Promise<MirrorCreateResult>;
  saveMapping: (input: MirrorMappingInput) => Promise<MirrorActionResult>;
  syncNow: () => Promise<MirrorActionResult>;
  setPaused: (input: { paused: boolean }) => Promise<MirrorActionResult>;
  disconnect: () => Promise<MirrorActionResult>;
}

const SETUP_ERRORS: ReadonlySet<string> = new Set(MIRROR_SETUP_ERRORS);

/**
 * The message key, under `admin`, that explains `code`: `mirror.errors.<code>`
 * for the mirror's own codes, `errors.<code>` for the ones every admin surface
 * shares.
 */
export function mirrorErrorMessageKey(code: MirrorActionError): string {
  return SETUP_ERRORS.has(code) ? `mirror.errors.${code}` : `errors.${code}`;
}

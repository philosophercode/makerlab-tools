import { z } from "zod";
import { saveMirrorConnection, type MirrorRecord } from "../data/mirrors.ts";
import type { Db } from "../db/types.ts";
import { createNotionClient, NotionMirrorError, pageTitle, type NotionClientOptions } from "./notion-client.ts";
import { parseNotionId } from "./notion-id.ts";
import { MirrorKeyUnavailableError, encryptMirrorToken, mirrorKeyAvailable } from "./token-crypto.ts";
import type { MirrorSetupError } from "./types.ts";

/**
 * Connecting a mirror (spec §3.8 "Connect", §4.14, §8).
 *
 * **A token is validated by one read before it is stored, never after** (§8
 * "Untrusted input"). `testMirrorConnection` reads the shared page with the
 * pasted token; `connectMirror` runs that same read and stores nothing unless
 * it succeeded. So a mistyped token, or a page nobody shared with the
 * integration, is a sentence on the page and not a row that fails every push
 * from now on.
 *
 * **The token goes three places and no fourth**: the `Authorization` header of
 * that one read, `encryptMirrorToken`, and nowhere else. Every refusal is a
 * code, never a message built from what was typed, and nothing here logs —
 * `NotionMirrorError`'s own text is scrubbed of the token, but the safest line
 * is the one that is not written.
 *
 * Not step code, but relative imports with `.ts` extensions like the rest of
 * `src/lib/mirror/`.
 */

/** How long Test connection may take. A settings page that hangs is a broken settings page. */
export const MIRROR_TEST_TIMEOUT_MS = 10_000;

/**
 * An internal-integration token as Notion issues them (`ntn_…`, and the older
 * `secret_…`): one unbroken run of characters. The bounds are generous; what
 * they reject is an empty box, a paragraph, and a paste that caught a space.
 */
export const mirrorTokenSchema = z
  .string()
  .trim()
  .min(20)
  .max(200)
  .regex(/^\S+$/);

/** A page URL or id, as a browser's address bar shows it. Bounded before it is parsed. */
const pageRefSchema = z.string().trim().min(1).max(2048);

export interface MirrorConnectOptions {
  db?: Db;
  /** Test seams for the one Notion read (base URL, clock). Never the token. */
  client?: Partial<Omit<NotionClientOptions, "token">>;
}

export type MirrorTestConnectionResult =
  | { ok: true; pageId: string; title: string | null }
  | { ok: false; code: MirrorSetupError };

export type MirrorConnectResult =
  | { ok: true; mirror: MirrorRecord; created: boolean; pageId: string; title: string | null }
  | { ok: false; code: MirrorSetupError };

/**
 * **Test connection**: read the page with the pasted token and say its title.
 * Stores nothing.
 *
 * - a token that is not token-shaped → `invalid_token`, and no request is made;
 * - a page reference with no Notion id in it → `invalid_page`;
 * - 401 → `unauthorized` (the token is wrong or was revoked);
 * - 404, or 403 (the page exists but was not shared with the integration), or
 *   a page in the trash → `page_not_found`: the remedy is the same, share the
 *   page with the integration;
 * - anything else — 5xx, a timeout, a rate limit → `notion_unavailable`.
 */
export async function testMirrorConnection(
  token: unknown,
  pageRef: unknown,
  options: MirrorConnectOptions = {}
): Promise<MirrorTestConnectionResult> {
  const parsedToken = mirrorTokenSchema.safeParse(token);
  if (!parsedToken.success) return { ok: false, code: "invalid_token" };

  const parsedRef = pageRefSchema.safeParse(pageRef);
  const pageId = parsedRef.success ? parseNotionId(parsedRef.data) : null;
  if (!pageId) return { ok: false, code: "invalid_page" };

  const now = options.client?.now ?? Date.now;
  const client = createNotionClient({
    ...options.client,
    token: parsedToken.data,
    deadline: now() + MIRROR_TEST_TIMEOUT_MS,
  });

  try {
    const page = await client.getPage(pageId);
    if (page.archived || page.in_trash) return { ok: false, code: "page_not_found" };
    return { ok: true, pageId, title: pageTitle(page) };
  } catch (error) {
    return { ok: false, code: setupCodeFor(error) };
  }
}

/**
 * **Connect**: the same read, then — only if it succeeded — encrypt the token
 * and upsert the owner's mirror with the page's id and title.
 *
 * Reconnecting keeps the mapping and every `mirror_pages` row
 * (`saveMirrorConnection`), so the same Notion pages are updated rather than
 * duplicated, and clears a pause or an error the old token caused (§5.8).
 *
 * `key_unavailable` when `AUTH_SECRET` is unset: the token checked out, and
 * there is no key to keep it under, so it is not kept.
 */
export async function connectMirror(
  ownerUserId: string,
  token: unknown,
  pageRef: unknown,
  options: MirrorConnectOptions = {}
): Promise<MirrorConnectResult> {
  const tested = await testMirrorConnection(token, pageRef, options);
  if (!tested.ok) return tested;

  if (!mirrorKeyAvailable()) return { ok: false, code: "key_unavailable" };

  let tokenCiphertext: Uint8Array;
  try {
    // Parsed again rather than threaded through: the test result deliberately
    // does not carry the token, so no caller can hand it onward by accident.
    tokenCiphertext = encryptMirrorToken(mirrorTokenSchema.parse(token));
  } catch (error) {
    if (error instanceof MirrorKeyUnavailableError) return { ok: false, code: "key_unavailable" };
    throw new Error("The mirror token could not be encrypted.");
  }

  const { mirror, created } = await saveMirrorConnection(
    { ownerUserId, tokenCiphertext, parentPageId: tested.pageId, parentPageTitle: tested.title },
    { db: options.db }
  );
  return { ok: true, mirror, created, pageId: tested.pageId, title: tested.title };
}

/** What a failed page read means to the person holding the token. */
function setupCodeFor(error: unknown): MirrorSetupError {
  if (!(error instanceof NotionMirrorError)) return "notion_unavailable";
  switch (error.code) {
    case "unauthorized":
      return "unauthorized";
    case "page_not_found":
    case "not_found":
    case "restricted":
      return "page_not_found";
    default:
      return "notion_unavailable";
  }
}

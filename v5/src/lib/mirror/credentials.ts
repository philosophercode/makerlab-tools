import { createNotionClient, type NotionClient, type NotionClientOptions } from "./notion-client.ts";
import {
  MirrorKeyUnavailableError,
  MirrorTokenUnreadableError,
  decryptMirrorToken,
} from "./token-crypto.ts";

/**
 * A Notion client for a stored mirror, or the reason there cannot be one
 * (spec §8 "Secrets at rest", §5.8).
 *
 * The one place a stored token is decrypted. The plaintext goes straight into
 * the client and is returned nowhere else, so no caller can log it by
 * accident. The three refusals are values, not exceptions, because each is a
 * state the mirror page explains rather than a crash:
 *
 * - `not_connected` — no token is stored (never connected, or disconnected);
 * - `key_unavailable` — `AUTH_SECRET` is not set, so no key can be derived;
 * - `token_unreadable` — the stored value does not decrypt under the current
 *   key, which is what rotating `AUTH_SECRET` does. Connect again.
 */
export type MirrorClientResult =
  | { ok: true; client: NotionClient }
  | { ok: false; code: "not_connected" | "key_unavailable" | "token_unreadable" };

export function mirrorClientFor(
  tokenCiphertext: Uint8Array | null,
  options: Omit<NotionClientOptions, "token"> = {}
): MirrorClientResult {
  if (!tokenCiphertext || tokenCiphertext.length === 0) return { ok: false, code: "not_connected" };
  let token: string;
  try {
    token = decryptMirrorToken(tokenCiphertext);
  } catch (error) {
    if (error instanceof MirrorKeyUnavailableError) return { ok: false, code: "key_unavailable" };
    if (error instanceof MirrorTokenUnreadableError) return { ok: false, code: "token_unreadable" };
    // decryptMirrorToken throws nothing else; treat anything that slips
    // through as unreadable rather than letting it carry a message upward.
    return { ok: false, code: "token_unreadable" };
  }
  return { ok: true, client: createNotionClient({ ...options, token }) };
}

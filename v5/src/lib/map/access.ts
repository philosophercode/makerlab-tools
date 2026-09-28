import type { Identity } from "../auth/identity";

/**
 * Who may see the floor map (owner decision on PR #98, 2026-09-28): signed-in
 * people only. `/map`, the tool page's "Where it is" section and the
 * assistant's `map` field all ask this one question, so the three cannot
 * disagree. Anonymous visitors, anonymous chat, the public MCP and scheduled
 * callers (no identity) get nothing — not a hidden element, no data at all.
 */
export function canSeeMap(identity: Identity | null | undefined): boolean {
  return Boolean(identity && identity.role !== "anonymous" && identity.userId);
}

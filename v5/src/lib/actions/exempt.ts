/**
 * The GUI writes that do not yet run through the action layer, each with the
 * reason (assistant–GUI parity spec §10, "an explicit exemption list for
 * everything not yet moved").
 *
 * **This list only shrinks.** A new server action or mutation route that is
 * neither a wrapper over a registered action nor named here fails
 * `parity.test.ts`; an entry whose endpoint is gone, or that has become a
 * wrapper, fails it too, so the list cannot keep a stale excuse. The phases
 * are the spec's §9; "never" entries are §2's non-goals and §4.9's "never"
 * rows, and stay.
 *
 * Keys are `<repo-relative file>#<export>`, as `parity.ts` reports them.
 */
export const EXEMPT: Readonly<Record<string, string>> = {
  // ── The catalogue (§4.4) ─────────────────────────────────────────────
  "src/app/admin/inventory/actions.ts#saveTool": "Never: field edits stay on curation's propose_change, which carries citations and quote checks (§4.9 #27, §2 non-goals)",
  "src/app/admin/inventory/photo-actions.ts#attachPhotos": "Never this iteration: photos are §2's non-goal (§11 Q10, later)",
  "src/app/admin/inventory/photo-actions.ts#reorderPhotos": "Never this iteration: photos are §2's non-goal (§11 Q10, later)",
  "src/app/admin/inventory/photo-actions.ts#removePhoto": "Never this iteration: photos are §2's non-goal (§11 Q10, later)",
  "src/app/api/admin/revalidate/route.ts#POST": "Later: catalog.refresh_cache (§4.9 #10); the route also serves x-admin-secret callers with no session, which performAction cannot gate",

  // ── Intake (§4.2) ────────────────────────────────────────────────────
  "src/app/api/pending-tools/[id]/route.ts#PATCH":
    "Route-backed (ROUTE_BACKED): the intake table's HTTP shape (status codes, the item view) over updatePendingTool / discardPendingTool, the same writes pending.edit and pending.discard run",
  "src/app/api/pending-tools/research/route.ts#POST":
    "Route-backed (ROUTE_BACKED): the route keeps its limiter tier and 401/403 and runs lib/intake/research-start.ts, the one start pending.research runs too",
  "src/app/api/imports/route.ts#POST": "Already shared: startImport is the one path for this route and the chat's start_import (bulk intake spec)",

  // ── Refresh research (§4.5 #37–39) ───────────────────────────────────
  "src/app/admin/refresh/actions.ts#refreshAgain": "Later: Refresh again closes a refresh on its review page before queueing; the assistant queues with queue_refresh (refresh.queue)",
  "src/app/admin/refresh/actions.ts#decideRefreshProposals": "Never: /admin/refresh is the review surface for research proposals (§4.9 #38)",
  "src/app/api/chat-proposals/route.ts#POST": "Never: deciding a field proposal is the person's click, by design (§2, refresh research spec §12)",
  "src/app/api/action-proposals/route.ts#POST": "The confirm route itself (§3.5): it runs stored proposals through performAction, so its writes are registered actions; not a GUI write of its own",

  // ── The Notion mirror's setup (§4.9 #50–51) ──────────────────────────
  "src/app/admin/mirror/actions.ts#testConnection": "Never: takes a Notion secret, which must never enter a model's context (§2)",
  "src/app/admin/mirror/actions.ts#connect": "Never: takes a Notion secret, which must never enter a model's context (§2)",
  "src/app/admin/mirror/actions.ts#createDatabases": "Never: a mapping is a form of column choices, not a sentence (§4.9 #51)",
  "src/app/admin/mirror/actions.ts#saveMapping": "Never: a mapping is a form of column choices, not a sentence (§4.9 #51)",

  // ── Public and account (§4.1) ────────────────────────────────────────
  "src/app/api/projects/route.ts#POST": "Later phase: projects.submit (§4.9 #3), with its photo upload",
  "src/app/api/flags/route.ts#POST": "Already shared: the `flags` capability behind report_correction (§1)",
  "src/app/api/uploads/route.ts#POST": "Never: uploading a file is not a sentence; photos reach the chat as attachments (§2)",
  "src/app/account/tokens/actions.ts#createTokenAction": "Never: creates a secret (§2)",
  "src/app/account/tokens/actions.ts#revokeTokenAction":
    "Later: account.revoke_token (§4.9 #7) — the account gate is signed-in, not a permission, and performAction's gate is a permission; needs its own gate kind",
  "src/app/account/tokens/actions.ts#revokeAppAction": "Later: account.revoke_token, for OAuth grants (as revokeTokenAction)",
  "src/app/account/actions.ts#updateOwnNameAction": "Account gate, not an admin permission: people rename themselves on /account; the admin rename is people.set_name",
  "src/app/oauth/consent/actions.ts#decideConsentAction": "Never: consent must be the person's own act (§2)",
  "src/i18n/actions.ts#changeLocale": "Never: a client preference (§4.1 #4)",
  "src/i18n/locale.ts#resolveLocale": "Not a write: reads the locale cookie",
  "src/i18n/locale.ts#setLocaleCookie": "Never: a client preference (§4.1 #4)",
  "src/app/mcp/actions.ts#runMcpTryIt": "Not a write: anonymous public MCP reads only (§4.1 #9)",

  // ── Reads that happen to be server actions ───────────────────────────
  "src/app/admin/inventory/actions.ts#loadToolForEditor": "Not a write: the editor panel's read",
  "src/app/admin/intake/imports/actions.ts#loadImport": "Not a write: the import review's read (its polling)",

  // ── Not user actions (§4.8 "out of scope") ───────────────────────────
  "src/app/api/auth/[...all]/route.ts#POST": "Not a user action: sign-in and sign-out (§2)",
  "src/app/api/chat/route.ts#POST": "Not a user action: the chat stream itself",
  "src/app/api/mcp/route.ts#POST": "Not a user action: the MCP stream itself",
  "src/app/api/mcp/route.ts#DELETE": "Not a user action: the MCP stream itself",
  "src/app/api/mcp/signed-in/route.ts#POST": "Not a user action: the MCP stream itself",
  "src/app/api/mcp/signed-in/route.ts#DELETE": "Not a user action: the MCP stream itself",
  "src/app/api/upload-notion/route.ts#POST": "Retired, awaiting deletion approval (data platform spec)",
};

/**
 * Registered actions whose GUI door is an API route rather than a server
 * action. A route answers HTTP — status codes, its own limiter tier, a body
 * shape a client island reads — so it cannot be a one-line `performAction`
 * wrapper; instead it and the definition call **the same write** (named in
 * the route's `EXEMPT` reason). The parity guard accepts these as the
 * action's GUI endpoint, and checks each route is in `EXEMPT`.
 */
export const ROUTE_BACKED: Readonly<Record<string, string>> = {
  "pending.edit": "src/app/api/pending-tools/[id]/route.ts#PATCH",
  "pending.research": "src/app/api/pending-tools/research/route.ts#POST",
};

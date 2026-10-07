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
 * **Every entry is a decision, not a deferral** (phase 8): each reason starts
 * with one of {@link EXEMPT_KINDS}, and `parity.test.ts` refuses a "Later".
 *
 * Keys are `<repo-relative file>#<export>`, as `parity.ts` reports them.
 */

/** What an exemption may be: the only openings a reason may start with. */
export const EXEMPT_KINDS = [
  "Never",
  "Not a write",
  "Not a user action",
  "Route-backed",
  "Already shared",
  "Account gate, not an admin permission",
  "The confirm route itself",
  "Retired",
] as const;

export const EXEMPT: Readonly<Record<string, string>> = {
  // ── The catalogue (§4.4) ─────────────────────────────────────────────
  "src/app/admin/inventory/actions.ts#saveTool": "Never: field edits stay on curation's propose_change, which carries citations and quote checks (§4.9 #27, §2 non-goals)",
  "src/app/admin/inventory/photo-actions.ts#attachPhotos": "Never this iteration: photos are §2's non-goal (§11 Q10, later)",
  "src/app/admin/inventory/photo-actions.ts#reorderPhotos": "Never this iteration: photos are §2's non-goal (§11 Q10, later)",
  "src/app/admin/inventory/photo-actions.ts#removePhoto": "Never this iteration: photos are §2's non-goal (§11 Q10, later)",
  "src/app/api/admin/tools/export/route.ts#POST":
    "Not a write: the tools CSV download (catalog.export), a POST only because a selection of ids does not fit a URL; kept out of the assistant and MCP on purpose (owner's decision 2026-09-29)",
  "src/app/api/admin/revalidate/route.ts#POST":
    "Never: a cache flush, not a change anybody asked for — every action already refreshes the pages it changes (`revalidate`), and the route also serves x-admin-secret callers with no session, which performAction cannot gate (§4.9 #10, stage 4)",

  // ── Intake (§4.2) ────────────────────────────────────────────────────
  "src/app/api/pending-tools/[id]/route.ts#PATCH":
    "Route-backed (ROUTE_BACKED): the intake table's HTTP shape (status codes, the item view) over updatePendingTool / discardPendingTool, the same writes pending.edit and pending.discard run",
  "src/app/api/pending-tools/research/route.ts#POST":
    "Route-backed (ROUTE_BACKED): the route keeps its limiter tier and 401/403 and runs lib/intake/research-start.ts, the one start pending.research runs too",
  "src/app/api/imports/route.ts#POST": "Already shared: startImport is the one path for this route and the chat's start_import (bulk intake spec)",

  // ── Refresh research (§4.5 #37–39) ───────────────────────────────────
  "src/app/admin/refresh/actions.ts#refreshAgain":
    "Never as its own action: Refresh again closes an open refresh on its review page, which is the review surface (as decideRefreshProposals); the assistant starts research with queue_refresh (refresh.queue) (stage 4)",
  "src/app/admin/refresh/actions.ts#decideRefreshProposals": "Never: /admin/refresh is the review surface for research proposals (§4.9 #38)",
  "src/app/api/chat-proposals/route.ts#POST": "Never: deciding a field proposal is the person's click, by design (§2, refresh research spec §12)",
  "src/app/api/action-proposals/route.ts#POST": "The confirm route itself (§3.5): it runs stored proposals through performAction, so its writes are registered actions; not a GUI write of its own",

  // ── The Notion mirror's setup (§4.9 #50–51) ──────────────────────────
  "src/app/admin/mirror/actions.ts#testConnection": "Never: takes a Notion secret, which must never enter a model's context (§2)",
  "src/app/admin/mirror/actions.ts#connect": "Never: takes a Notion secret, which must never enter a model's context (§2)",
  "src/app/admin/mirror/actions.ts#createDatabases": "Never: a mapping is a form of column choices, not a sentence (§4.9 #51)",
  "src/app/admin/mirror/actions.ts#saveMapping": "Never: a mapping is a form of column choices, not a sentence (§4.9 #51)",

  // ── Public and account (§4.1) ────────────────────────────────────────
  "src/app/api/projects/route.ts#POST":
    "Never through the assistant: a project is a student's own write-up with its photo uploads, and files through a generated action are §2's non-goal; students are offered no action tools (§4.9 #3, stage 4)",
  "src/app/api/flags/route.ts#POST": "Already shared: the `flags` capability behind report_correction (§1)",
  "src/app/api/report/route.ts#POST":
    "Already shared: the quick report form files through fileProblemTicket (lib/maintenance/file-ticket.ts), the one write behind report_issue (amendment 2026-10-07, quick report spec §3.2)",
  "src/app/api/uploads/route.ts#POST": "Never: uploading a file is not a sentence; photos reach the chat as attachments (§2)",
  "src/app/account/tokens/actions.ts#createTokenAction": "Never: creates a secret (§2)",
  "src/app/account/tokens/actions.ts#revokeTokenAction":
    "Account gate, not an admin permission: a person manages their own credentials on /account/tokens beside the list, and performAction gates on a permission; revoking a credential from a model that may have read outside text is not offered (§4.9 #7, stage 4)",
  "src/app/account/tokens/actions.ts#revokeAppAction": "Account gate, not an admin permission: as revokeTokenAction, for OAuth grants (§4.9 #7, stage 4)",
  "src/app/account/actions.ts#updateOwnNameAction": "Account gate, not an admin permission: people rename themselves on /account; the admin rename is people.set_name",
  "src/app/api/notifications/unsubscribe/route.ts#POST":
    "Account gate, not an admin permission: one-click unsubscribe from an email, authorised by a signed token that names the person and can only turn their own email off; it works signed out (RFC 8058), so performAction, which gates on a session's permission, cannot run it; the assistant never changes who is emailed (deny list: messaging; email notifications spec §3.7, amendment 2026-10-07)",
  "src/app/oauth/consent/actions.ts#decideConsentAction": "Never: consent must be the person's own act (§2)",
  "src/i18n/actions.ts#changeLocale": "Never: a client preference (§4.1 #4)",
  "src/i18n/locale.ts#resolveLocale": "Not a write: reads the locale cookie",
  "src/i18n/locale.ts#setLocaleCookie": "Never: a client preference (§4.1 #4)",
  "src/app/mcp/actions.ts#runMcpTryIt": "Not a write: anonymous public MCP reads only (§4.1 #9)",

  // ── Reads that happen to be server actions ───────────────────────────
  "src/app/admin/inventory/actions.ts#loadToolForEditor": "Not a write: the editor panel's read",
  "src/app/admin/refresh/actions.ts#loadRefreshPickerTools": "Not a write: the Refresh research picker's tool list, read when it opens",
  "src/app/admin/intake/imports/actions.ts#loadImport": "Not a write: the import review's read (its polling)",

  // ── Not user actions (§4.8 "out of scope") ───────────────────────────
  "src/app/api/auth/[...all]/route.ts#POST": "Not a user action: sign-in and sign-out (§2)",
  "src/app/api/chat/route.ts#POST": "Not a user action: the chat stream itself",
  "src/app/api/chat/starters/route.ts#POST":
    "Not a user action: the chat saying a starter chip was answered from the cache — an anonymous usage count, as the chat stream records for a live turn",
  "src/app/api/mcp/route.ts#POST": "Not a user action: the MCP stream itself",
  "src/app/api/mcp/route.ts#DELETE": "Not a user action: the MCP stream itself",
  "src/app/api/mcp/signed-in/route.ts#POST": "Not a user action: the MCP stream itself",
  "src/app/api/mcp/signed-in/route.ts#DELETE": "Not a user action: the MCP stream itself",
  "src/app/api/usage/route.ts#POST":
    "Not a user action: the page-view beacon a browser sends by itself — an anonymous count, not a change anybody asked for, with no permission to gate on (usage insight spec §5.3)",
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

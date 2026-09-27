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
  // ── Phase 4: catalogue actions (§4.9 #28–35) ─────────────────────────
  "src/app/admin/inventory/actions.ts#saveTool": "Field edits stay on curation's propose_change (§4.9 #27); the editor's save is wrapped in phase 4 with its revision token",
  "src/app/admin/inventory/actions.ts#markToolReviewed": "Phase 4: tools.mark_reviewed",
  "src/app/admin/inventory/actions.ts#publish": "Phase 4: tools.publish",
  "src/app/admin/inventory/actions.ts#unpublish": "Phase 4: tools.unpublish",
  "src/app/admin/inventory/actions.ts#archive": "Phase 4 (destructive in phase 6): tools.archive",
  "src/app/admin/inventory/actions.ts#restore": "Phase 4: tools.restore",
  "src/app/admin/inventory/unit-actions.ts#addUnit": "Phase 4: units.add",
  "src/app/admin/inventory/unit-actions.ts#editUnit": "Phase 4: units.edit",
  "src/app/admin/inventory/unit-actions.ts#retireUnit": "Phase 4: units.retire",
  "src/app/admin/inventory/unit-actions.ts#deleteUnit": "Phase 4 (destructive in phase 6): units.delete",
  "src/app/admin/inventory/resource-actions.ts#addResource": "Phase 4: resources.add",
  "src/app/admin/inventory/resource-actions.ts#editResource": "Phase 4: resources.edit",
  "src/app/admin/inventory/resource-actions.ts#removeResource": "Phase 4 (destructive in phase 6): resources.remove",
  "src/app/admin/inventory/resource-actions.ts#reprocessManual": "Phase 5 (spend): manuals.reprocess",
  "src/app/admin/research/actions.ts#reprocessLibraryManual": "Phase 5 (spend): manuals.reprocess, from the library table",
  "src/app/admin/inventory/photo-actions.ts#attachPhotos": "Never this iteration: photos are §2's non-goal (§11 Q10, later)",
  "src/app/admin/inventory/photo-actions.ts#reorderPhotos": "Never this iteration: photos are §2's non-goal (§11 Q10, later)",
  "src/app/admin/inventory/photo-actions.ts#removePhoto": "Never this iteration: photos are §2's non-goal (§11 Q10, later)",
  "src/app/api/admin/revalidate/route.ts#POST": "Phase 4: catalog.refresh_cache; also serves x-admin-secret callers with no session",

  // ── Phase 5: intake and import actions (§4.9 #12–19, #23–26) ─────────
  "src/app/admin/intake/actions.ts#approvePending": "Phase 5: pending.approve",
  "src/app/admin/intake/actions.ts#approvePendingAsDraft": "Phase 5: pending.approve_draft",
  "src/app/admin/intake/actions.ts#addPendingUnit": "Phase 5: pending.add_unit",
  "src/app/admin/intake/actions.ts#discardPending": "Phase 5 (destructive in phase 6): pending.discard",
  "src/app/admin/intake/actions.ts#savePendingIdentity": "Phase 5: pending.save_identity",
  "src/app/admin/intake/actions.ts#requestDifferentImage": "Phase 5 (spend): pending.different_image",
  "src/app/api/pending-tools/[id]/route.ts#PATCH": "Phase 5: pending.edit and pending.discard, from the chat's intake table",
  "src/app/api/pending-tools/research/route.ts#POST": "Phase 5 (spend): pending.research",
  "src/app/admin/intake/imports/actions.ts#confirmImportColumns": "Phase 5: imports.confirm_columns",
  "src/app/admin/intake/imports/actions.ts#updateImportRow": "Phase 5: imports.edit_rows",
  "src/app/admin/intake/imports/actions.ts#setImportRowHints": "Phase 5: imports.edit_rows",
  "src/app/admin/intake/imports/actions.ts#removeImportRows": "Phase 5: imports.remove_rows",
  "src/app/admin/intake/imports/actions.ts#mergeImportRow": "Phase 5: imports.merge_row",
  "src/app/admin/intake/imports/actions.ts#acceptImportSuggestions": "Phase 5: imports.decide_suggestions",
  "src/app/admin/intake/imports/actions.ts#ignoreImportSuggestions": "Phase 5: imports.decide_suggestions",
  "src/app/admin/intake/imports/actions.ts#requestImportSuggestions": "Phase 5 (spend): imports.request_suggestions",
  "src/app/api/imports/route.ts#POST": "Already shared: startImport is the one path for this route and the chat's start_import (bulk intake spec)",

  // ── Refresh research (§4.9 #37–39) ───────────────────────────────────
  "src/app/admin/refresh/actions.ts#queueToolRefresh": "Phase 5 (spend): refresh.queue",
  "src/app/admin/refresh/actions.ts#refreshAgain": "Phase 5 (spend): refresh.queue",
  "src/app/admin/refresh/actions.ts#decideRefreshProposals": "Never: /admin/refresh is the review surface for research proposals (§4.9 #38)",
  "src/app/api/chat-proposals/route.ts#POST": "Never: deciding a field proposal is the person's click, by design (§2, refresh research spec §12)",
  "src/app/api/action-proposals/route.ts#POST": "The confirm route itself (§3.5): it runs stored proposals through performAction, so its writes are registered actions; not a GUI write of its own",

  // ── Phase 7 / mirror (§4.9 #50–51) ───────────────────────────────────
  "src/app/admin/mirror/actions.ts#syncNow": "Mirror phase: mirror.sync_now",
  "src/app/admin/mirror/actions.ts#setPaused": "Mirror phase: mirror.set_paused",
  "src/app/admin/mirror/actions.ts#disconnect": "Phase 6 (destructive): mirror.disconnect",
  "src/app/admin/mirror/actions.ts#testConnection": "Never: takes a Notion secret, which must never enter a model's context (§2)",
  "src/app/admin/mirror/actions.ts#connect": "Never: takes a Notion secret, which must never enter a model's context (§2)",
  "src/app/admin/mirror/actions.ts#createDatabases": "Never: a mapping is a form of column choices, not a sentence (§4.9 #51)",
  "src/app/admin/mirror/actions.ts#saveMapping": "Never: a mapping is a form of column choices, not a sentence (§4.9 #51)",

  // ── Public and account (§4.1) ────────────────────────────────────────
  "src/app/api/projects/route.ts#POST": "Later phase: projects.submit (§4.9 #3), with its photo upload",
  "src/app/api/flags/route.ts#POST": "Already shared: the `flags` capability behind report_correction (§1)",
  "src/app/api/uploads/route.ts#POST": "Never: uploading a file is not a sentence; photos reach the chat as attachments (§2)",
  "src/app/account/tokens/actions.ts#createTokenAction": "Never: creates a secret (§2)",
  "src/app/account/tokens/actions.ts#revokeTokenAction": "Phase 6 (destructive): account.revoke_token",
  "src/app/account/tokens/actions.ts#revokeAppAction": "Phase 6 (destructive): account.revoke_token, for OAuth grants",
  "src/app/account/actions.ts#updateOwnNameAction": "Account gate, not an admin permission: people rename themselves on /account; the admin rename is people.set_name",
  "src/app/oauth/consent/actions.ts#decideConsentAction": "Never: consent must be the person's own act (§2)",
  "src/i18n/actions.ts#changeLocale": "Never: a client preference (§4.1 #4)",
  "src/i18n/locale.ts#resolveLocale": "Not a write: reads the locale cookie",
  "src/i18n/locale.ts#setLocaleCookie": "Never: a client preference (§4.1 #4)",
  "src/app/mcp/actions.ts#runMcpTryIt": "Not a write: anonymous public MCP reads only (§4.1 #9)",

  // ── Reads that happen to be server actions ───────────────────────────
  "src/app/admin/inventory/actions.ts#loadToolForEditor": "Not a write: the editor panel's read",
  "src/app/admin/intake/imports/actions.ts#loadImport": "Not a write: the import review's read",

  // ── Not user actions (§4.8 "out of scope") ───────────────────────────
  "src/app/api/auth/[...all]/route.ts#POST": "Not a user action: sign-in and sign-out (§2)",
  "src/app/api/chat/route.ts#POST": "Not a user action: the chat stream itself",
  "src/app/api/mcp/route.ts#POST": "Not a user action: the MCP stream itself",
  "src/app/api/mcp/route.ts#DELETE": "Not a user action: the MCP stream itself",
  "src/app/api/mcp/signed-in/route.ts#POST": "Not a user action: the MCP stream itself",
  "src/app/api/mcp/signed-in/route.ts#DELETE": "Not a user action: the MCP stream itself",
  "src/app/api/upload-notion/route.ts#POST": "Retired, awaiting deletion approval (data platform spec)",
};

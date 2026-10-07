# The action layer

> Moved verbatim from `AGENTS.md` on 2026-09-29, when `AGENTS.md` became an
> index. Paths are relative to the repository root.

## The action layer (`src/lib/actions/`; assistant–GUI parity spec, phases 1–8)

Every GUI write is defined once, as data plus a `run()`, and every surface runs
it through **`performAction(def, input, identity, { surface })`**
(`docs/specs/2026-09-27-assistant-gui-parity-design.md`). Phase 1 moved the
People page and the three queues onto it with no behaviour change; phase 2 gave
the assistant a proposing tool per action and the confirmation card that
commits it; phase 3 told the chat where the person is; phases 4–6 moved the
catalogue editor, intake, imports, refresh, manuals and the mirror's running
controls onto it, with typed confirmation for destructive cards and taint;
phase 7 gave MCP clients proposals that wait in an inbox; phase 8 made every
exemption a decision and the spec–registry drift check a test. What it means
for people is in `docs/assistant.md`.

- **One path.** `performAction`: `authorizeAdminAction` (limiter → signed in →
  permission) → `afterGate` → parse (`input`, a parse failure answers the
  definition's `invalidInput` code) → `check` → `run` (a throw is `failed`) →
  `afterCommit` + `revalidate` only when `run` answered `committed`. Refusals are
  values; a lost audit event (or any `afterCommit` throw) is a warning on a
  success, never a failure.
- **Server actions are one-line wrappers**: `performAction(PEOPLE_SET_TITLE,
  input, await resolveIdentityFromHeaders(), { surface: "gui" })`. Their
  exported names and result types are unchanged, so no island changed. Put a
  write's rules in its definition (`check`/`run`), never in the wrapper — that
  is what makes them hold on every surface.
- **Definitions**: `people.ts` (role, title, name), `people-roster.ts` (add,
  remove, unblock), `people-allowance.ts`, `people-gate.ts` (the floor
  reconciliation as `afterGate`), `tickets.ts`, `corrections.ts`,
  `projects.ts`, `maintenance-log.ts` (phases 1–2); `catalog.ts` (publish,
  mark reviewed, archive, restore), `units.ts`, `resources.ts` over the
  shared `catalog-write.ts` (the editor's revision token rides on every input
  — the panel's, or the one a proposal read — so a save between card and click
  answers `conflict`) (phase 4); `intake.ts` (+ `intake-input.ts`),
  `imports.ts`, `manuals.ts`, `refresh.ts` (phase 5); `mirror.ts` (phase 6).
  `registry.ts`'s `ACTIONS` lists them. `defineAction` refuses
  at load a destructive batch, a `people`/`spend`/`destructive` action over MCP,
  `mcp: "direct"` on anything but `tickets.update` (`DIRECT_OVER_MCP`; MCP gets
  proposals only, §11 answer 4), `assistant: "never"` without `neverReason`,
  a `"never"` that still carries a `tool`/`preview`, and an action on the
  **assistant's deny list** that is not `"never"` (below).
  A capability tool that records a surface reads `ctx.surface`, which the chat
  and MCP adapters stamp — never `chatId`. `writeTicket` (MCP's and the
  chat's `update_ticket`) is a wrapper over `tickets.update`.
- **The parity guard** (`parity.test.ts`, scanner `parity.ts`, list
  `exempt.ts`): every export of a `"use server"` module, every inline
  `"use server"` function and every `POST`/`PUT`/`PATCH`/`DELETE` of a
  `src/app/**/route.ts` must be a thin `return performAction(<registered
  definition>, …)` wrapper (nothing else in the body; only
  `resolveIdentityFromHeaders()` may be called in its arguments) or an `EXEMPT`
  entry with a reason. **Adding a server action or a
  mutation route means adding a definition (and registering it, and importing
  its module in the guard) or an exemption** — and exemptions only shrink: a
  stale one fails the test too. The guard also fails a proposable action with
  no `tool` + `preview` that is not in `DEFERRED_TOOLS` (`capabilities/actions.ts`,
  which only shrinks too — empty since phase 6). An action whose GUI door is an
  API route (HTTP statuses, its own limiter tier) is `ROUTE_BACKED` in
  `exempt.ts`: the route stays `EXEMPT` and calls **the same write** the
  definition's `run()` does (`pending.research` → `lib/intake/research-start.ts`,
  moved verbatim out of the route; `pending.edit` → `updatePendingTool`).
- **The assistant only proposes** (phase 2). `capabilities/actions.ts` generates
  one chat tool per definition that has a `tool` (`toolShape(schema,
  toInputs)`: the model's strict, described arguments → one definition input
  per subject; a batch is a list of ids with one change) and a `preview` (the
  card's summary key, before → after rows and subject name, **read from the
  database**, never model text). Its `run()` is `proposeAction`
  (`proposals.ts`): the `assistantPropose` limiter, the permission, the
  arguments, the definition's own `input`, `check`, `preview` → one
  `action_proposals` row per subject (`data/action-proposals.ts`, migration
  `0020`; 60 minutes in the chat, 7 days for MCP; ≤ 50 open per person per surface) and a
  `data-action-proposal` part drawn by `components/chat/ActionProposalCard.tsx`.
  **Nothing commits until the person clicks Confirm**: `POST
  /api/action-proposals` (cookie only — `resolveIdentity` never reads a
  bearer, so a token cannot confirm; `actionConfirm` tier; body = ids +
  decision, nothing else) claims the creator's open rows **one at a time**
  (a 20 s budget; unreached rows stay open) and runs each **stored** input
  through `performAction` with `{ surface: "assistant", proposalId,
  beforeRun }`, so every rule and the permission are checked again at the
  click. `beforeRun` re-runs the definition's `preview` and answers
  `conflict` if a field the card shows has changed since (`staleness.ts`):
  a card's "before" can be an hour old, so a stored proposal is never
  last-write-wins the way a fresh GUI screen is. The card re-reads its rows
  on mount (`GET ?ids=`). A typed "yes" commits nothing (the prompt says so;
  §11 answer 1). Text from records that goes into a prompt block as a line
  goes through `inlineText` (`web/fence.ts`): one line, capped, quoted.
  Each card sentence is `actions.summary.<area>_<verb>`; each row's vocabulary
  goes through `actions.values.<format>.*` (`preview-messages.test.ts` checks
  every key a definition names exists).
- **Audit names the surface.** `audit_events.surface` (`gui` default) and
  `proposal_id`; every event an action writes spreads `auditTrail(ctx)`, the
  in-transaction writers (`addPersonAccount`, `removeUserAccount`,
  `unblockEmail`, `renamePerson`) take a `trail`. A change from the People page
  and the same change from a card differ in those two columns only
  (`proposals.test.ts` runs both and compares).
- **What the next turn knows** is read, not told: the chat route appends
  "Proposals in this conversation" (`lib/chat/proposal-outcomes.ts`, the
  caller's rows in this chat) — the model says something was done only when
  that block says confirmed.
- **Page context** (phase 3): `ChatPanel` sends `page: { path, selection? }`
  (the ticked ids, from `usePublishSelection` in `components/chat/page-selection.tsx`,
  read at send time). `lib/actions/page-context.ts` matches the path against
  `PAGE_CONTEXTS`, checks the page's own permission, keeps only uuids of the
  page's selection kind (≤ 50), reads their names from the database and
  appends a fenced "Where the person is" block — only for somebody who can
  reach an admin surface. A forged or foreign id is dropped before any read;
  an unknown path is never echoed. `QueueList`'s opt-in `selectable` gives the
  maintenance, corrections and projects queues checkboxes on open cards (only
  ticked rows the current filters show are sent) and an **Ask the
  assistant about these** bar; `InventoryBoard` publishes its selection.
- **Read tools for the actions** (chat only): `capabilities/admin-reads.ts` —
  `find_people` (`users.manage`, masked emails `l***@cornell.edu`),
  `list_corrections`, `list_project_queue` (other people's words fenced with
  `OTHERS_TEXT_NOTE`); `capabilities/catalog-reads.ts` — `get_tool_units`
  (`tools.edit`: units with ids and maintenance counts, resources) and
  `list_imports` (`tools.add`: the caller's imports, or a reviewer's; rows
  fenced). `list_open_tickets` fences each description.
- **Assistant limits — the deny list** (owner decision 2026-09-27; spec
  amendment "Assistant limits"). The assistant (chat and MCP) acts only as the
  signed-in person and never past their role, and **never, on any surface,
  whatever the role**: sets anyone's role to `super_admin` or changes a super
  admin's role (`people.set_role`/`people.add` refuse `only_on_people_page`
  off the GUI — `superAdminPageOnly` in `people.ts`); grants allowances,
  removes people, blocks/unblocks addresses, disconnects the mirror
  (`people.grant_allowance`, `people.remove`, `people.unblock_email`,
  `mirror.disconnect` are `assistant: "never"`, no tool); nor touches secrets,
  env vars, tokens, hosting/deploys, SQL/the database, backups/`data:push`, the
  audit trail, bulk email export or messaging. `define.ts` holds
  `ASSISTANT_FORBIDDEN_ACTIONS` (ids) and `ASSISTANT_FORBIDDEN_CATEGORIES`
  (words matched against an action id or any tool name). Enforced four times:
  `defineAction` at load; `proposableDefinitions` / `capabilitiesForIdentity`
  / `mcpToolAllowed` where tools are offered (`assistantMayPropose`,
  `assistantToolForbidden`); `proposeAction` (`not_offered`); and the confirm
  route, which refuses a stored proposal for a forbidden action before
  `performAction` runs. **Adding an action or a capability tool whose name
  says secret/token/deploy/sql/backup/audit/export/email/send…** fails
  `assistant-limits.test.ts` unless it is `assistant: "never"`: that is the
  point — rename it only if it truly is none of those. The GUI keeps all of
  these for people with the permission.
- **Destructive cards** (`risk: "destructive"`: `tools.archive`, `units.delete`,
  `resources.remove`, `pending.discard`; `people.remove` and
  `mirror.disconnect` are destructive too but never the assistant's):
  never batched, and Confirm stays off until the subject's stored name is typed
  (`typed-confirm.ts`, the same fold the route checks again). Enter never
  confirms.
- **Taint** (`lib/chat/taint.ts`, §8.4): a chat turn that called
  `read_page`, `exa_search`, `search_manual`, `list_open_tickets`,
  `get_unit_details`, `get_maintenance_history`, `list_corrections`,
  `list_project_queue`, `list_imports` or `get_record` is tainted —
  `CapabilityCtx.turn`, built by the route, marked by `toAiTools` when such a
  tool starts and by the route's `onStepFinish` for Exa. A turn starts tainted
  when the route attached manual PDFs or a curation record. Its proposals are
  stored `tainted` and the card says so; `people` and `destructive` proposals,
  and definitions marked `refuseWhenTainted` (`imports.remove_rows`), are
  refused (`tainted_turn`) and the assistant asks for a new message. A new
  read tool that returns anybody else's text must be added to
  `OUTSIDE_CONTENT_TOOLS` and fence that text.
- **A proposal's `version`** (`ActionPreview.version`): an opaque token for
  what the change was built from but the rows do not show; a different one at
  the click is `conflict`. `pending.approve` uses it so a rename or new
  research between card and click approves nothing stale.
- **`edit_pending_items` never discards**: the `discard` duplicate decision is
  `discard_pending_item`'s alone (destructive, typed name).
- **Spend actions** (`pending.research`, `pending.different_image`,
  `imports.request_suggestions`, `manuals.reprocess`, `refresh.queue`): cards
  in the chat only, never over MCP (§11 answer 3); the card's sentence shows the
  allowance left (`allowance.ts`, a summary value, never a compared row), and
  the allowance is checked at the click by the same code the button runs.
- **`proposeCheck`** on a definition: refusals only a proposal needs (an intake
  item not researched or graded low, a unit with history), so no card is drawn
  that the click can only refuse; never run on the GUI path.
- **"Approve these"** builds, per item, the approval the review page sends
  untouched (`lib/intake/approval-draft.ts`, shared with
  `PreliminaryToolPage`); a low-confidence item needs the reviewer's own note
  and is refused on its row. `IntakeList` and `ImportReview` publish their
  selection (`pending_tool`).
- **MCP proposals** (phase 7): `capabilities/actions.ts` also generates an
  `mcpOnly` tool of the same name for every definition with `mcp: "propose"`
  (queue and catalogue work). Its `run()` is `proposeAction` with `surface:
  "mcp"` and no chat: the row waits **7 days** in the creator's **Assistant
  proposals** inbox, `/admin/proposals` (`lib/actions/inbox.ts` →
  the chat's `ActionProposalCard`; `data/action-proposals.ts`'s
  `listInboxProposals`), and only its creator, signed in with a cookie, can
  confirm it — through the same `POST /api/action-proposals`, so the commit is
  `performAction` with `surface: "mcp"`. A token can never confirm (the route
  never reads a bearer). **Never over MCP**: `people`, `spend`, `destructive`,
  anything `assistant: "never"` (`defineAction` makes it `mcp: "never"`), and
  `refuseWhenTainted` or mirror controls (declared `never`). No `act` scope:
  the only direct MCP write is `staff.ts`'s `update_ticket`
  (`DIRECT_OVER_MCP`). `list_corrections`, `list_project_queue`,
  `get_tool_units` and `list_imports` are on MCP too, so a client can find ids;
  `find_people` is chat only. The MCP tool lists per credential are asserted
  exactly (`test/mcp/expected-tools.ts`): add a proposable action and those
  lists change on purpose.
- **The inbox is an admin surface** (`surfaces.ts` key `proposals`, group
  Queues, a half tile counting the viewer's open MCP proposals). A surface's
  `permission` may be a list (any of, `mayOpen`): the inbox is open to every
  `ADMIN_SURFACE_PERMISSIONS` holder, and shows only the viewer's own rows.
  Field changes proposed over MCP (`propose_change`) stay on `/admin/refresh`;
  each page links to the other.
- **The inbox's Manuals view** (parity spec amendment 2026-10-07 "manual
  triage"): `/admin/proposals?view=manuals`, a tab beside **All proposals**
  when a resource proposal is open. `lib/actions/manual-triage.ts`
  (`buildManualTriage`) groups the open `resources.add` / `resources.edit`
  rows by tool and describes each from its stored input and preview (a label
  such as Add manual, Replace link, Retype, Retitle, Hide, Re-archive; the
  document before and after; the link's host); `data/manual-triage-tools.ts`
  reads the tools' names, thumbnails and documents now. The view
  (`components/admin/ManualTriage.tsx`, `ManualTriageTool.tsx`,
  `ManualTriageRow.tsx`, `manual-triage-state.ts`) confirms through the same
  route, sends a tool's rows in **one** request, and has keys (j/k, y, n, o,
  ?) that work only while focus is inside it. No PDF is fetched for it.
- **A tool's proposals confirm in one step** (`revision-chain.ts`, same
  amendment). Each tool-editor proposal stores the tool's revision. Inside one
  confirm request, after a `resources.add` / `resources.edit` row for tool T
  confirms (its write checked revision A and answered B in one statement), a
  later row of that request for T that stored A runs with B. Its write checks B,
  so someone else's save in between is still `conflict`. Any row of T that does
  not confirm stops the chain for T; nothing carries between requests; the drift
  check still runs per row. Such a row's stored result has `chained: true`.
- **Exemptions are decisions** (phase 8): each `EXEMPT` reason starts with one
  of `EXEMPT_KINDS` ("Never", "Not a write", "Account gate…", "Route-backed"…);
  a "Later" fails `parity.test.ts`. **`spec-drift.test.ts`** reads the spec's
  §4.9 table: every registered id and tool name must be written in the spec,
  every §4.9 id registered or in its `NOT_REGISTERED` with a reason, and each
  row's MCP column must match the definition or be in `MCP_DEVIATIONS`. A new
  action therefore needs a line in the spec's as-built registry table.
- **Log completed maintenance** (`tickets.log_completed`, `maintenance-log.ts`):
  the form on `/admin/maintenance` (`LogCompletedForm`, tools and units from
  `data/tool-options.ts`) and `log_completed_maintenance` — a ticket that
  starts resolved, the person as reporter and assignee, a unit only of that
  tool, no archived tools.

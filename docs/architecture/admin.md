# The admin surface

> Moved verbatim from `AGENTS.md` on 2026-09-29, when `AGENTS.md` became an
> index. Paths are relative to the repository root.

## The admin surface (`/admin`)

`/admin/users` is the first admin page and the first server action in the app;
Phase 5 extends both. The shape it sets:

- **Two gates, coarse then exact.** `src/app/admin/layout.tsx` resolves the
  identity from headers and answers "may this person see an admin surface at
  all" (`canReachAdmin`, any admin-surface permission). Each page then checks
  the permission it actually needs — `/admin/users` on `users.manage`, which
  only `super_admin` holds. A SuperMaker gets past the layout and is refused on
  the page, **and is told so**: `AdminNotice` renders "not signed in" or "not
  permitted", never a 404 and never an error boundary (Article 4).
- **Every admin folder with a page below it has a `loading.tsx`**
  (`AdminPageLoading`; DESIGN.md §8.12, `app/admin/loading-boundaries.test.ts`).
  Admin pages read the request at their root, so a page's prefetched segment is
  a shell with an unfilled hole (`$L…`, `isPartial`). Without a Suspense
  boundary inside the new segment a client navigation suspended on that hole
  behind the layout's visible boundary and, in the production build, was
  sometimes never retried — URL unchanged, RSC 200, page never mounted until
  an unrelated re-render. `e2e/admin-client-navigation.spec.ts` walks every
  section by clicking. Not a CSS problem: the admin stylesheet chunks were
  ruled out (one global stylesheet still hung).
- **Six sections, one list of surfaces** (UI system phase 4; admin sections
  spec 2026-10-07). The bar is `OVERVIEW · MAINTENANCE · INVENTORY · PEOPLE ·
  INSIGHTS · SETTINGS` and **Ask MakerLAB AI**. `src/lib/admin/surfaces.ts`
  holds every admin page's key, href, **section**, permission, icon and
  (optional) count loader; `surfacesFor(identity)` — the same `can()` each page
  checks — feeds the section bar the layout puts on every admin page
  (`AdminNav`, through `sectionsFor`/`currentSection`), the tabs under each
  page's header (`SectionTabs`, which reads the layout's
  `AdminSurfacesProvider`, so no page resolves the identity for it), the
  overview's counts and the ⌘K palette (`CommandPalette`). A page added there
  appears in all of them; one left out is reachable from none, and
  `surfaces.test.ts` pins what each role is shown. A section links to the
  first of its surfaces the viewer may open (a SuperMaker's People is Student
  projects, a director's the roster), and a section with nothing open is not
  shown. Every admin page's header is `AdminPageHeader` (crumb from the
  section, a facts line from the page's own rows, then the section's tabs; an
  item's page gets a crumb link back and no tabs).

  | Section | Tabs (route) |
  |---|---|
  | Overview | `/admin` |
  | Maintenance | Tickets (`/admin/maintenance`) · Shift checklist (`/admin/maintenance/checklist`) · Recurring tasks (`/admin/maintenance/schedules`) |
  | Inventory | All tools (`/admin/inventory`) · Add equipment (`/admin/intake`) · QR labels (`/admin/inventory/qr`) · Lab notes (`/admin/inventory/lab-notes`) · Manuals (`/admin/research`) · Check for updates (`/admin/refresh`) · Categories (`/admin/taxonomy`) · Page corrections (`/admin/corrections`) |
  | People | Roster (`/admin/users`, directors) · Student projects (`/admin/projects`) |
  | Insights | `/admin/insights` (its own Usage · Value report tabs) |
  | Settings | General (`/admin/settings`) · Notion mirror (`/admin/mirror`) · MCP (`/admin/proposals`) · AI agents (`/admin/settings/ai-agents`) |

  **No route moved**, so every old link opens its page. New names redirect
  in `next.config.ts` (`/admin/today`, `/admin/overview`, `/admin/mcp`,
  `/admin/settings/mcp`, `/admin/settings/notion`, `/admin/inventory/add`,
  `/admin/checklist`); `/admin/people` is a page that redirects to the first
  People page the viewer may open. Add equipment is the
  `src/app/admin/intake/(tabs)/` route group — Queue and Imports as its own
  `LinkTabs`, **Import a list** as its header action, not a surface (amendment
  2026-09-25 "Admin polish") — and the four queues share `QueueList`.
- **The overview** (`/admin`, admin sections spec §5.5) replaced the tiles
  home: **Need to know** (urgent tickets with **Take it**, overdue recurring
  tasks, tickets naming no machine), the **Shift checklist**, and beside them
  **Quick actions** (`AdminActions`: Print QR labels first, Log finished work,
  Add equipment, All tools), **Waiting for a decision** and **Inventory
  health** (`components/admin/overview/`, rows built by the pure
  `overview-model.ts`). Its numbers are `loadAdminOverview(loaders)`
  (`src/lib/data/admin-overview.ts`) over the viewer's surfaces only, each
  failing to `null` on its own, plus `listMaintenanceQueue`, the due tasks and
  `listUnitsDown` (`lib/data/units-down.ts`), each read settled on its own: a
  read that failed says "Could not be read", never 0 or "nothing waiting".
  Waiting counts live here, never in the bar. `admin-tiles.ts` and
  `system/Tile` have no callers since and await deletion approval.
- **Settings holds what is not a job of its own.** **General**
  (`/admin/settings`, every admin-surface permission): the lab screen link
  (`/kiosk`), **Refresh catalog** (`tools.edit`; it left the old home's header)
  and the viewer's access tokens. **MCP** is the Assistant proposals inbox at
  its old address, `/admin/proposals`, retitled, with links to `/mcp` and
  `/account/tokens` in its header. **AI agents** (`/admin/settings/ai-agents`,
  `tools.edit`) says what the research and intake agents do and their limits,
  and holds the **research budget**: `AllowanceGrant` for `users.manage`
  holders (moved from the roster; `people.grant_allowance` now refreshes this
  page), one line saying directors grant it for everyone else.
- **Server actions check themselves.** A server action is a POST endpoint with
  a generated name, reachable without the page that offers it, so
  `src/app/admin/users/actions.ts` resolves the identity and `performAction`
  rate-limits (`ADMIN_ACTION_TIER`, 120/min per person) and re-checks
  `users.manage` — it
  trusts nothing from the page that rendered the control (spec §8). Refusals are
  **values** (`{ ok: false, error }`), not exceptions, so the island can render
  the reason; every code has an `admin.errors.<code>` string.
- **The server actions are the only way in.** The admin plugin also mounts its
  own HTTP endpoints under `/api/auth/admin/*`, which would be a second,
  unreviewed door onto the same writes. `src/app/api/auth/[...all]/route.ts`
  refuses every path under that prefix with 403 `admin_api_not_exposed`, before
  the auth instance is even constructed — percent-decoding and lower-casing the
  path first, so `%61dmin` and `/ADMIN/` are the same refusal.
- **A change that landed minus a guarantee is a warning, not an error.** The
  audit write happens *after* `auth.api.setRole` has committed, so
  throwing there would make the page show the old value over a database holding
  the new one. `record()` reports instead, and the action answers
  `{ ok: true, …, warning: "audit_unavailable" }`. Both islands keep the new
  value and show `admin.warnings.<code>` in `RowStatus`'s warn tone.
  **Never answer `{ ok: false }` for a write that landed** — both islands
  respond to a refusal by restoring the previous value, which would then assert
  a state the database does not hold. Phase 5 reuses this rather than repeating
  it: `record` and `warn` now live in `src/lib/admin/audit-warning.ts`, and the
  codes every admin surface shares in `src/lib/admin/action-result.ts`.
- **`/admin/inventory` is the review table, and it is not the catalogue.** It
  lists every tool including drafts and archived ones, with the flags a review
  runs on — no photo, no manual, open tickets, never reviewed — computed in SQL
  by `src/lib/data/inventory.ts` in six statements whatever the size of the
  inventory. An *archived* tool carries no flags: archiving is one of the three
  outcomes of a review, so settled equipment stays out of the queue. Units that
  belong to no tool come back as their own list rather than being attached to a
  guessed tool.
- **Lab notes are an Inventory tab** (`/admin/inventory/lab-notes`, `tools.edit`;
  identity spec amendment "Lab notes"; a header button on All tools until the
  admin sections spec): the lab-wide notes the assistant knows in every
  conversation (`lab_settings.lab_notes`, saved whole by `lab.set_notes`, GUI only),
  then every unarchived tool with lab notes (`tools.notes`, edited in the tool
  editor) linking to its page. Uncached; a read that fails says so instead of
  showing an empty box somebody could save over the real notes.
- **The filters are client-side and in the URL, both on purpose.** The server
  renders every row and `InventoryBoard` (on the shared `DataTable` +
  `FilterBar`, UI system phase 2) narrows them in the browser (the
  `GalleryShell` idiom), so a facet costs no round trip; it then writes the
  filters back with `history.replaceState`, so "every tool with no manual" is a
  link somebody can send and the Back button still points where the reviewer
  came from. `inventory-filters.ts` is the directive-free sibling both the page
  and the island import — it owns which values a URL may carry, and drops any
  it does not offer. An empty table names the filter that emptied it; "no
  results" on its own tells a reviewer nothing (§6).
- **Export CSV is super admins' (`catalog.export`), and tools only.** The inventory's
  `FilterBar` offers **Export CSV** (every tool, published/draft/archived, with a Status
  column) or **Export CSV (n shown)** when a filter is set, and the selection bar
  **Export CSV (n)** (`ExportToolsCsvButton`). It posts `{ ids? }` to
  `POST /api/admin/tools/export`, which re-checks the permission (401 anonymous, 403
  anyone else), rate-limits (10/min) and answers `text/csv` as an attachment
  (`makerlab-tools-YYYY-MM-DD.csv`, `no-store`). One flat row per tool — the stored
  fields (`lib/data/tool-export.ts`, never the catalogue's display fallbacks), lists
  `; `-joined, **public photo and published-resource links only**, the tool page URL,
  timestamps — written by `lib/export/csv.ts` (RFC 4180, UTF-8 BOM for Excel, CRLF, a
  cell starting `=` `+` `-` `@` tab or CR prefixed with `'`). No tickets, unit history,
  corrections or usage. Not an assistant or MCP action, by the owner's decision
  (`exempt.ts` "Not a write").
- **Editing inventory is optimistic, and its token is a string.** The tool
  editor reads a revision when it opens and hands it back with the save; the
  write happens only if `tools.updated_at` has not moved. The token is
  `extract(epoch from updated_at)::text`, computed and compared by Postgres,
  **never a JavaScript `Date`** — `now()` has microsecond resolution and a
  `Date` has milliseconds, so a `Date` comparison matches nothing on Neon while
  matching forever on PGlite. See `src/lib/data/revision.ts`. A unit, resource
  or photo edit touches the tool row in the same transaction, so the tool is the
  token for the whole panel; a *refused* child write rolls that touch back.
- **The tool editor is one panel offered from two places.**
  `ToolEditorPanel` opens as a side panel from a row of the review table and as
  a **full-screen sheet over a tool's own page** (§5.3(b)) — the phone-first
  case, because a SuperMaker marking a printer out of service is standing next
  to the machine. `EditToolControl` is what offers it there: it asks
  `/api/identity` *after mount*, like `AdminLink`, so the cached tool page stays
  cached for everyone who is not staff.
- **A conflict never costs anybody their typing.** The panel keeps the unsaved
  edits, says so inline (never a modal — §6), and **Reload** fetches the newer
  version and shows the other person's value beside every field they disagree
  on, with a control that takes it. The fields form is *rebased*, never
  synchronised: nothing copies fresh server values over a box somebody is
  typing in, so the panel remounts it with a new `key` after a save it knows
  landed. It also sends **only the fields that changed**, because a patch
  carrying every field would overwrite an edit the revision check cannot see.
  **A unit row follows both rules for itself**, and has to: the rows are keyed
  by unit id and never remount, so one opened ten minutes ago still holds what
  it opened with. Each field the person has not touched rebases onto the newer
  server value; each field they have is theirs; Save posts the second kind only.
- **A write that changed the tool's *state* re-reads it.** Publish, Unpublish,
  Archive, Restore and "Looks good" all commit through `run(…, { refresh: true
  })`, and that refresh takes the tool's state as well as its children — a panel
  still offering **Unpublish** under a "Saved" it just earned is the page
  asserting what the database no longer holds, and a second click writes a
  second audit event. The tool's *text* is left alone, because somebody may be
  halfway through typing it.
- **Hiding a resource hides it from visitors, not just from the assistant.**
  The editor's **Hide** flips `resources.published`, and `loadTools` filters on
  it exactly like `listResourcesForTool` does, so an internal SOP staff
  restricted leaves the public tool page. What it does not do is unpublish the
  file: a resource's PDF is a public blob at a random pathname and stays
  fetchable by anyone who already has the URL.
- **Every editor action is gated by `authorizeAdminAction`**
  (`src/lib/admin/action-gate.ts`): identity, then the limiter, then the one
  permission it needs — the sequence `/admin/users` established, now shared and
  parameterised. Editing is `tools.edit`; publish, unpublish, archive and
  restore are `tools.publish`. Both are `admin` today, so the split costs
  nothing and makes "SuperMakers may add tools but not publish them" a one-line
  change. `canPublish` hides those four controls; hiding is presentation.
- **Drafts are reachable at their slug only with `catalog.view_drafts`, and the
  refusal is a 404.** `getCatalogTool` is `"use cache"` and published-only and
  cannot see the caller, so a miss renders `DraftToolView` inside its own
  Suspense boundary — an async child that reads headers, checks the permission
  and calls `notFound()` for everyone else. Keeping that read inside the
  boundary is what leaves every *published* tool page prerenderable under
  `cacheComponents` (`npm run build` is the check); a different-looking refusal
  would confirm the draft exists.
- **With no Blob store (see "Blob locally") the panel says photos cannot be added and
  stays usable for everything else.** `POST /api/uploads` answers 503, the
  Photos and Resources sections show that sentence, and reordering, removal and
  every text field keep working — a deployment with no Blob store is still one
  where a wrong description is worth fixing (Article 4).
- **Two things cannot be undone, so they cannot be done.** An address in
  `AUTH_SUPER_ADMIN_EMAILS` cannot be demoted or removed (nor blocked), and the
  last `super_admin` cannot be demoted or removed; nobody removes themselves.
  The table disables those rows with the reason showing; the action derives
  them again before it writes.
- **Reads go straight to Postgres; a role change goes through the plugin,
  removal does not.** `src/lib/data/users.ts` selects the roster;
  `auth.api.setRole` changes a role. **Remove** (auth spec amendment
  2026-09-25, which retired Ban) is `removeUser` → `removeUserAccount`
  (`src/lib/data/user-removal.ts`): **one transaction** — name snapshots
  (`created_by_name` on `pending_tools`, `bulk_imports`, `chat_proposals`),
  sessions, personal tokens and OAuth grants deleted, `account` and `user`
  deleted, the optional block, and `user.removed` / `email.blocked` written
  *inside* it (so a lost event rolls the removal back — the opposite of a role
  change). History stays: `pending_tools.created_by` and `bulk_imports.created_by`
  stopped cascading in migration `0016`; tickets, corrections and projects keep
  their name/email snapshots and old id, and the queues say "<name> (removed)"
  (`accountRemoved()` in `data/account-removed.ts`, `components/admin/person-label.ts`).
  A removed owner's own Notion mirror cascades.
- **Blocked emails** (`blocked_emails`, `data/blocked-emails.ts`): written only
  by a removal with "Also block this email…", listed and **Unblock**ed on the
  People page (`email.unblocked`). `databaseHooks.user.create.before` refuses a
  blocked address before any row exists (`lib/auth/blocked-sign-in.ts`); the
  auth route rewrites Better Auth's `?error=email_blocked` redirect to
  `/auth/blocked`. The floor is never refused. The `banned` columns stay
  (the admin plugin selects them) and nothing writes them; migration `0016`
  turned every banned account into a block plus a removal.
- **Titles** (`user.title`, migration `0017`): null unless a super admin set a
  custom one on the People page (`TitleEditor` → `setUserTitle`, audited as
  `user.title_changed`). What is shown is `displayTitle()` in
  `src/lib/people/title.ts` — the custom title, else the role's
  `admin.titles.<role>` label — on the roster and in the profile menu. Better
  Auth knows the field as `input: false`, so none of its endpoints write it.
  The message keys are `admin.personTitle.*` (`admin.title` is the admin
  area's own h1 — two `title` keys in one object silently collide).
- **Role and title are never the same words.** A role is authorization only
  and is labelled **User / Admin / Super admin** everywhere (`admin.roles.*`:
  the select, the Role facet, the Add person form). Titles (Director, Assistant
  Director, Tech Lead, Supermaker, Student…) are only ever shown as titles, in
  their own column. Do not put a title word into `admin.roles`.
- **The roster is one row per person** (`UsersRoster`): Person (name + pencil
  "Edit the name for <name>" → `NameEditor`, YOU, address under it in small
  mono — said once when the name *is* the address), Title (text + pencil
  "Edit the title for <name>" → `TitleEditor`), Role, First signed in, Account.
  Both pencils are one component, `components/system/InlineTextEditor.tsx`
  (read / field + Save + Cancel, Escape cancels, focus back to the pencil, shows
  what the server stored, one `role="status"`); reuse it for any other short
  inline text rather than copying `TitleEditor`. A locked
  control shows a short `LockNote` badge — "Protected", "Last super admin",
  "Your account" — with the full `admin.errors.<code>` sentence in its tooltip
  and as the disabled control's `aria-describedby`; a refusal the server just
  gave is still said in full.
- **Finding people**: search (name, address, title) plus three `FacetFilter`s —
  Role, Signed in (`yes` / `no`), Title (every title *as shown*: custom, else
  the role's default label) — all in the URL (`q`, `role`, `signed_in`,
  `title`; `users-filters.ts`), counted per option like the inventory's.
  Person, Title (as shown), Role (most privileged first) and First signed in
  ("Not signed in yet" first) sort from their headers with `aria-sort`; text
  sorts set `sortingFn: "text"` explicitly (TanStack's `auto` samples rows
  after the tenth, so a short roster would sort case-sensitively). Sort is not
  in the URL, as on the inventory.
- **Names** (`lib/people/name.ts`): trimmed, whitespace collapsed, 1–80
  characters (`PERSON_NAME_MAX_LENGTH`, Add person included). A super admin
  renames anybody on the roster (`setUserName`, `users.manage`); anybody signed
  in renames themselves on **`/account`** ("Account" in the profile menu;
  `updateOwnName` in `lib/account/name-actions.ts`, account gate, always the
  caller's own row). Both go through `renamePerson` (`lib/people/rename.ts`) and
  record `user.name_changed` `{ from, to }`; a lost event is a warning, not a
  failure. Better Auth's own `/update-user` is in `disabledPaths` — it took a
  name from any browser with no rule and no audit.
- **Google never overwrites a chosen name.** An already-linked account is not
  updated at sign-in (`overrideUserInfoOnSignIn` stays off). The one late write
  is the account link for somebody added ahead of time: the Google provider's
  `mapProfileToUser` → `keepChosenName` (`lib/auth/provider-name.ts`) hands back
  the row's own name unless it is the address placeholder, so a name typed at
  Add person (or edited on the roster before they sign in) is kept and a blank
  one becomes their Google name. No column records "edited": the placeholder
  *is* the marker. `config.test.ts` covers all three cases.
- **Add person** (`AddPersonForm` → `addPerson`, audited as `user.added`, in
  one transaction with the row — `lib/data/user-add.ts`): a super admin puts
  somebody on the roster before their first sign-in, with email (trimmed,
  lower-cased), optional name (the address stands in until Google's; a typed
  one is kept), role and optional title. The **Add person** button opens the
  form inline and disappears while it is open; the form's buttons are **Add**
  (the one filled button) and **Cancel** — Cancel or Escape closes and empties
  it and returns focus to Add person; after a landed add it stays open,
  emptied, for the next person. Refused, as values: not an address, too long, a role outside the
  vocabulary, `isAllowedEmail` false (`email_not_allowed` — the same rule the
  create hook runs), blocked (`email_blocked`, floor exempt), or already a row
  (`duplicate_email`). A floor address is stored `super_admin` whatever was
  chosen. The row has `email_verified` false and **`first_signed_in_at` null**
  (migration `0018`; the column defaults to `now()`, so every row Better Auth
  or a seed creates is "signed in" at creation, and the backfill set existing
  rows to `created_at`). The roster shows null as "Not signed in yet"; the
  `session.create.after` hook in `auth/config.ts` stamps it. Removing such a
  person is an ordinary Remove.
- **Their first Google sign-in links to that row** — `account.accountLinking`
  in `auth/config.ts`: `requireLocalEmailVerified: false` (a pre-added row
  cannot be verified; there is no password or email sign-up to make one any
  other way), `trustedProviders` deliberately **not** set (so Google must say
  `email_verified`, and an unverified Google account claiming the address
  cannot take the row), `updateUserInfoOnLink: true` (Google's photo, and
  Google's name only over the address placeholder — see "Google never
  overwrites a chosen name"; role and title are not provider fields and stay).
  Linking skips `user.create.before`, so the role/title/floor chosen at Add
  person are what they arrive with; the after-hook's domain check still runs.
  `config.test.ts` drives the real OAuth callback (MSW token endpoint, forged
  id_token) to prove same id, one account, role and title kept, and no link
  without `email_verified`.
- **Every security-relevant change is recorded.** `src/lib/data/audit.ts` is
  insert-and-select only — there is deliberately no update or delete export,
  and a test asserts the module's shape. Each event snapshots `actor_name` at
  insert (a subselect), so an actor removed later is still named. `AUDIT_ACTIONS`
  has no `user.unbanned`; old lifts are `user.banned` with `detail.banned: false`.
- **Server actions pass down as props.** `RoleSelect`, `RemoveUserControl` and
  `BlockedEmailsList` take the action rather than importing it, which keeps
  `next/headers`, the limiter and `server-only` out of a client component's
  graph and makes them testable with a `vi.fn`.
- **Submitting a project needs an account** (spec §5.5) — the one place in the
  app where sign-in is required. `POST /api/projects` answers 401
  `sign_in_required` to an anonymous caller, the byline comes from the session
  and the typed-name field is gone. Browsing, chatting and reporting a problem
  are all still anonymous.
- **The three queues are what the lab actually runs on** (§5.6).
  `/admin/maintenance` (`maintenance.manage`), `/admin/corrections`
  (`feedback.manage`) and `/admin/projects` (`projects.moderate`) are the
  surfaces that replace working tickets in Notion. Each is a card list rather
  than a table, because every row carries prose somebody typed; each puts the
  open work on the page and folds the settled work behind a disclosure, because
  the person using these has twenty tickets and ten minutes; and each one's
  control **saves on the click**, with `useRowAction` giving all of them the
  same contract (optimistic, a refusal restores, a warning keeps). Their
  writes are action definitions run by `performAction` (see "The action
  layer") — gate, write, record, refresh, each step only as far as the last
  one earned. (`queue-write.ts`'s `runQueueWrite` has no callers since and
  awaits deletion approval.)
- **Recurring maintenance is the Shift checklist** (recurring maintenance
  spec, amendments 2026-10-06 and 2026-10-07). `DueTasks` lists the tasks
  overdue, due today and due within 7 days, on the overview and on its own
  Maintenance tab (`/admin/maintenance/checklist`), each checked off with
  **Done** and an optional note (`schedules.complete`, which logs a
  `maintenance_completions` row and moves `next_due_on` to today + interval in
  one transaction). Under a task, the open tickets on the same machine
  (`checklist-issues.ts`: the task's unit and the tool's unit-less tickets, or
  every ticket on the tool) each have **Mark resolved** (`ResolveIssueControl`
  → `updateTicket`, status `resolved`). The ticket page no longer carries the
  list; its facts line still counts overdue and due-today tasks. Tasks are set up on
  `/admin/maintenance/schedules` (`ScheduleBoard`, `ScheduleForm`): per tool,
  per unit, "each unit", or general lab upkeep with no tool; edit, pause,
  resume, archive. All three pages and all four `schedules.*` actions are
  `maintenance.manage`. No ticket is opened per occurrence, so the queue
  stays for reported problems. Dates are lab dates (`labToday()`); the maths is
  `src/lib/maintenance/interval.ts`. The overview's facts line counts the
  checks due, and Need to know says when any are overdue.
- **Email lands on the queue** (email notifications spec,
  [`notifications.md`](notifications.md)). Each ticket card is wrapped in
  `id="ticket-<id>"`, which a new-ticket email links to
  (`/admin/maintenance#ticket-<id>`); the browser scrolls there and `:target`
  outlines it, with no script. The 08:00 recurring-maintenance reminder links to
  the Shift checklist tab, `/admin/maintenance/checklist`.
- **Each queue checks its own permission, and a test proves it is its own.** No
  role holds `tools.edit` without `feedback.manage`, so each `actions.test.ts`
  mocks `can()` for one case and asserts the endpoint is refused to a caller
  holding the *adjacent* permission. That is the only way to catch an action
  that gates on the wrong declaration.
- **Only the project one audits, and only it invalidates.** Publishing decides
  what the public gallery shows, so it writes `project.published` /
  `project.unpublished` and calls `invalidateProjects()` — and a lost audit
  event is still `{ ok: true, warning: "audit_unavailable" }`, never a failure.
  Maintenance and correction edits are ordinary edits, which §4.11 says are
  deliberately not logged, and nothing cached reads either table.
- **A correction is one click from the field it corrects.** The row links to
  the tool's own page — where the field is shown and where `EditToolControl`
  opens the editor — not to `/admin/inventory`, which would land the reviewer
  in a table they then have to search.
- **`published_at` / `published_by` describe the current publication, not the
  history**, so unpublishing clears both. The history is `audit_events`.
- **One read selects a reporter's email, on purpose.** `listMaintenanceQueue`
  and `listFeedbackQueue` carry `reported_by_email` / `reporter_email`, because
  the first thing an admin does with a confusing ticket is ask the person who
  filed it. `listMaintenanceHistoryForUnit` still does not select it at all —
  its rows reach a model prompt and the mirror (§8). Which function a caller
  picks is the whole of that decision, which is why they are two functions and
  not one with a flag.

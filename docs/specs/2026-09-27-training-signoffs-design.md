# Training Sign-offs — Design Spec

**Date:** 2026-09-27
**Status:** Idea — not decided. The owner has considered this but has not decided to build it; do not implement against it.
**Target:** `v5/`
**Branch:** `docs/feature-specs`
**Spec PR:** — · **Implementation PR:** —

> This is an idea on paper, written so the owner can decide. Nothing here is approved for
> planning. It depends on the assistant GUI-parity spec
> ([`2026-09-27-assistant-gui-parity-design.md`](2026-09-27-assistant-gui-parity-design.md))
> landing its phases 1–2 first.

## 1. Summary

The catalogue already knows **which tools need training**: `tools.training_required`
(`src/lib/db/schema/tools.ts`), editable in `ToolFieldsForm` and at intake approval
(`PreliminaryToolPage`'s `TrainingChoice`). It drives the public "Training Required"
status (`toToolStatus` in `src/lib/data/catalog.ts`). It does not know **who is trained**.
That lives on paper, in a spreadsheet, or in a staff member's memory. A student cannot
check what they are cleared for. A SuperMaker on the floor cannot look up whether the
person at the laser cutter was signed off.

This spec adds a **training record**. Staff sign a person off on a tool with a date, a
trainer and an optional expiry. A person sees their own trainings on `/account`. Staff see
"who can use this" on a tool's page. The assistant warns a signed-in student who asks
about a training-required tool they are not signed off on. Staff can sign off a whole
workshop at once.

Every new write is an **action** in `src/lib/actions/` (parity spec §3.1–3.2). The GUI,
the assistant (as a confirmation card) and MCP share one definition. No new architecture
is introduced. The record is **advisory**: the app never locks a machine or refuses a
student anything. It tells people what staff recorded.

## 2. Goals / Non-goals

### Goals

- A staff member signs a person off on a tool in under 15 seconds from the tool page or
  the person's row on `/admin/users`.
- After a workshop, one form signs off up to 40 people on one tool, and the whole batch
  is one audit group.
- A sign-off may carry an expiry. A tool may carry a default refresher period, so staff
  need not type a date each time.
- A signed-in person sees their current, expired and revoked trainings on `/account`.
- A staff member sees, on `/tools/[id]`, who is currently signed off and who is lapsed.
- In chat, a signed-in student asking about a training-required tool they are not
  cleared on is told so and pointed to staff. The assistant never tells anyone about
  another person's training unless the caller holds `training.manage`.
- Every write is audited (`audit_events`) and reachable from the assistant as a proposal.

### Non-goals (this iteration)

- **Enforcement.** No kiosk lockout, no refusing a booking, no hardware interlock. The
  usage/kiosk idea is a separate spec. It would *read* this record, not extend it.
- **Training content.** No course materials, quizzes or video. Staff train in person.
- **Scheduling workshops or sign-up lists.** The lab announces workshops elsewhere.
- **Reminders by email or push.** Refresher reminders belong to the notifications idea
  spec. This spec only exposes "due soon" so that spec has something to send.
- **Per-unit training.** Training is per tool (the model), not per physical unit.
- **Notion mirror.** Training records are student data and never leave Postgres (§8).

## 3. Architecture

- **Capability.** No new capability module. Writes are action definitions in a new
  `src/lib/actions/training.ts`, turned into proposal tools by the generated `actions`
  capability (parity §3.4). Two reads join the catalogue and staff capabilities (§5).
- **Permission.** A new resource in `statement` (`src/lib/auth/permissions.ts`):
  `training: ["manage"]`, granted to `admin` and `super_admin`. Reading your *own* record
  needs only a signed-in identity, like `/account` does today.
- **Data access.** `src/lib/data/training.ts` holds queries plus the one status
  derivation, `trainingStatus(rows, now)` → `current | expiring | expired | revoked |
  none`. Every surface calls it, so "expired" means the same thing in the GUI and in chat.
- **Caching.** Training reads are per-person and never enter `cacheTag("catalog")`. The
  staff section on `/tools/[id]` is a separate dynamic island behind its own `Suspense`,
  so the public page stays cached.
- **Mirror.** `src/lib/mirror/source.ts` gains nothing. Removing a person
  (`src/lib/data/user-removal.ts`) deletes their training rows (§4).

## 4. Data model

Migration `00NN_training.sql` (number assigned at landing; `0019` is the latest today).

```ts
// src/lib/db/schema/training.ts
export const trainingSessions = pgTable("training_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  toolId: uuid("tool_id").notNull().references(() => tools.id, { onDelete: "cascade" }),
  heldAt: timestamp("held_at", { withTimezone: true }).notNull(),
  trainerId: userReference("trainer_id"),          // set null on removal
  trainerName: text("trainer_name"),               // snapshot, like audit_events.actor_name
  title: text("title"),                            // "Glowforge intro, Sep 30"; ≤ 120
  createdBy: userReference("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const trainingSignoffs = pgTable("training_signoffs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  toolId: uuid("tool_id").notNull().references(() => tools.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").references(() => trainingSessions.id, { onDelete: "set null" }),
  signedOffAt: timestamp("signed_off_at", { withTimezone: true }).notNull(),
  signedOffBy: userReference("signed_off_by"),
  signedOffByName: text("signed_off_by_name"),     // snapshot
  expiresAt: timestamp("expires_at", { withTimezone: true }), // null = no expiry
  note: text("note"),                              // staff-only; ≤ 500; never shown to the model unfenced
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedBy: userReference("revoked_by"),
  revokeReason: text("revoke_reason"),             // ≤ 200
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("training_signoffs_user_idx").on(t.userId),
  index("training_signoffs_tool_idx").on(t.toolId),
]);

// tools: one new column
trainingValidDays: integer("training_valid_days"), // null = sign-offs never expire by default; check 1..1825
```

- **Rows are history; status is derived.** A refresher inserts a new row. Current status
  for (person, tool) is the latest non-revoked row by `signed_off_at`. No "active" flag can
  disagree with the history.
- **`user_id` cascades**, unlike the actor columns (which `set null`,
  `user-references.test.ts`). A training record is *about* the person. When they are
  removed, it goes with them. The audit events keep names, as they do for `user.removed`.
- **Existing rows.** None. Tools get `training_valid_days = null`, so nothing expires until
  staff set a period.
- **Pre-sign-in people.** A sign-off needs a `user` row. People added on `/admin/users`
  before first sign-in (migration `0018_people_add`) already have one. Bulk sign-off by
  email for unknown addresses is §13 Q4.
- **Audit actions** added to `AUDIT_ACTIONS` (`src/lib/db/schema/audit.ts`):
  `training.signed_off`, `training.revoked`, `training.session_recorded`,
  `tool.training_validity_changed`. `detail` holds tool name, dates and session id, never
  the note.

## 5. Behaviour: actions, reads and the assistant

**Actions** (`src/lib/actions/training.ts`; all `permission: "training.manage"`):

| Action id | Tool name | Risk | maxBatch | MCP | Notes |
|---|---|---|---|---|---|
| `training.sign_off` | `sign_off_training` | `people` | 20 | `propose` | `{ userIds, toolId, signedOffAt?, expiresAt?, note? }`. `expiresAt` defaults from `training_valid_days`. `check` refuses a tool with `training_required = false` unless `force` (§13 Q6) |
| `training.record_session` | — | `people` | 1 | `never` | The bulk form: one session row plus up to 40 sign-offs in one transaction. GUI-only because it is over the 20-subject card cap; the assistant uses `sign_off` in batches |
| `training.revoke` | `revoke_training` | `people` | 1 | `never` | `{ signoffId, reason }`. Reversible by signing off again, so no typed-name confirmation |
| `training.set_expiry` | `set_training_expiry` | `people` | 20 | `propose` | Extend or clear one sign-off's expiry |
| `tools.set_training_validity` | `set_training_validity` | `catalog` | 1 | `propose` | `permission: "tools.edit"`; also a field in `ToolFieldsForm` |

The parity test (parity §10) picks these up automatically. A new GUI form without a
definition fails CI.

**Reads.**

- `get_my_training` (catalogue capability, any signed-in identity, `chatOnly`). It returns
  the caller's own rows with derived status. It takes no user argument, so the caller
  cannot ask about anyone else.
- `get_tool_details` gains `my_training: "current" | "expiring" | "expired" | "none"` when
  the caller is signed in and the tool has `training_required`. It is omitted for
  anonymous callers, and is never sent over MCP.
- `list_tool_trainees` (staff capability, `training.manage`, chat and signed-in MCP). It
  returns names, status and dates for one tool. It never returns emails: the staff
  capability's existing rule is that emails never enter a model's context. Notes go
  through `fenceUntrusted`.
- `find_people` (parity §3.4) resolves "sign off Luis" to an id.

**Assistant prompt fragment** (catalogue capability, when `training_required`):

- With `my_training` = `none` or `expired`, say plainly that this tool needs staff
  sign-off before use and that the record shows none (or an expired one). Point to staff or
  the workshop page. Do not refuse to explain the tool. The student may be reading ahead.
- Never say "you are cleared to use it". Say "the lab's record shows you were signed off on
  <date>". The record is advisory.
- Anonymous: "this tool needs training; sign in to see your record".
- Never discuss another person's training unless `list_tool_trainees` is in the toolset.

**Flow: "sign off Casey, Priya and Sam on the Glowforge"** (admin, any page)
→ `find_people` ×3 and `search_tools` → `sign_off_training({ userIds: [3], toolId })` →
the parity proposal path stores 3 `action_proposals` rows with one `group_id` → the card
shows 3 rows (name, tool, signed-off date, expiry) → Confirm → `performAction` per row →
3 `training.signed_off` audit events with `surface = assistant`.

**Unhappy paths.** Ambiguous name: the assistant asks (parity rule). Already current:
`check` returns `already_current` with the expiry, and the assistant offers
`set_expiry` instead. Tool archived: refused. Person removed between proposal and
confirm: `not_found`.

## 6. UI

- **`/tools/[id]`, staff island** (`training.manage`, tool has `training_required`): a
  "Who can use this" section below the editor panel. It shows counts (current, expiring
  within 30 days, lapsed), a name list with dates, a **Sign off someone** combobox, and
  per-row Revoke and Extend. Empty: "Nobody signed off yet."
- **`/admin/users`**: each row's detail lists the person's trainings with the same
  controls. Placement follows the People page's Add/Cancel pattern (PR #92).
- **`/admin/training`** (new, in the admin nav next to People), for `training.manage`:
  - **Record a workshop**: tool, date, trainer (default: me), then a pasted list of emails
    or picked names, preview, submit.
  - **Due for refresher**: sign-offs expiring in the next 30 days, and lapsed ones in the
    last 90.
  - **Recent sign-offs**: from `audit_events`.
- **`/account`**: a "My trainings" section (`PageSection`) listing tool, status chip,
  signed-off date, trainer name and expiry. The note is never shown to the student. Empty
  state links to the catalogue filtered to training-required tools.
- **Tool card / status.** The public "Training Required" badge does not personalize. A
  signed-in student's cleared state shows on the tool page only (§13 Q7).
- **Strings.** New keys under `training.*` in all 12 `messages/*.json` (Article 6). Status
  chips use the UI system's existing chip tokens.

## 7. Relationship to existing work

- **Builds on** the GUI-parity spec (`src/lib/actions`, `action_proposals`, the
  confirmation card, `find_people`, the page context that lets "sign these off" on
  `/admin/training` resolve the selection). If parity has not landed, this waits. It does
  not add server actions the old way and migrate them later.
- **Extends** `tools.training_required` and `toToolStatus`, whose behaviour is unchanged.
- **Feeds** the sibling idea specs from the same conversation. Usage/kiosk would read
  `trainingStatus` at sign-in. Notifications would send refresher reminders from the "due"
  query. Neither is required for this one.
- **User removal** (`user-removal.ts`) must delete `training_signoffs` in its transaction
  (the cascade does it). Its test gains the case.

## 8. Security, privacy and safety

- **Student data.** Who was trained on what, and when, is a record about a student. It
  may fall under Cornell's student-records policy (§13 Q2). Consequences:
  - A person sees only their own record. Staff with `training.manage` see everyone's. An
    anonymous visitor or a `user` sees no one else's, on any surface.
  - Not mirrored to Notion, not in the public catalogue, not in `/api/mcp`'s anonymous
    tools. Signed-in MCP reads follow the caller's own permission.
  - No emails in model context. `note` is staff-only, length-capped, and fenced when read
    by a model.
  - Removal deletes the rows. Daily backups (`/api/cron/daily`) age them out on their
    existing retention.
- **Authorization.** One gate: `performAction` → `authorizeAdminAction("training.manage")`.
  The staff island checks `can()` on the server before rendering names. Hiding it on the
  client is presentation only.
- **Write safety (Article 5).** Assistant sign-offs are proposals, and a person's click
  commits them. MCP clients can propose but never confirm (parity §3.5). Revoke is
  GUI-and-card only.
- **Rate limiting.** Commits share `ADMIN_ACTION_TIER`. `get_my_training` shares the chat
  tier. There are no external calls.
- **Liability framing.** The UI and prompt say "recorded", never "certified" or "safe to
  use". The record must not become the lab's safety authority by accident.

## 9. Phased build order

| # | Phase | Acceptance |
|---|---|---|
| 1 | **Record and staff view.** Schema + migration, `training.manage`, `lib/data/training.ts` with `trainingStatus`, actions `sign_off` / `revoke` / `set_expiry` / `set_training_validity`, the tool-page staff island, trainings on `/admin/users` rows | An admin signs a person off from the tool page and from People, revokes, and extends. The audit rows appear. A `user` session sees no staff island, and the server refuses the action. Removing the person deletes their rows. Parity test green |
| 2 | **Student view and assistant.** `/account` "My trainings", `get_my_training`, `my_training` on `get_tool_details`, prompt fragment, `list_tool_trainees` | A signed-in student who is not signed off on the Trotec is warned in chat and pointed to staff. The same student, signed off, is told the date. Anonymous gets the generic line. "Who is trained on the Form 4?" from a student is declined. Evals pass (§10) |
| 3 | **Workshops and refreshers.** `training_sessions`, `record_session`, `/admin/training` (record, due, recent) | 30 emails pasted after a workshop become 30 sign-offs and 1 session in one transaction. Unknown addresses are listed and not silently dropped (per §13 Q4). The "due" list matches `trainingStatus` |

Phase 1 needs parity phases 1–2. Phases 2 and 3 can run in parallel after phase 1.

## 10. Testing and evals

- **Unit:** `trainingStatus` covers none, current, expiring at the 30-day edge, expired,
  revoked-then-re-signed and a future `signed_off_at`. Also the expiry default from
  `training_valid_days`, and the email-list parser (dedupe, case, junk lines).
- **Integration (PGlite):**
  - Migration FKs: user removal cascades, and signer removal sets null with the snapshot
    kept.
  - Each action through `performAction`: refusals for `user` and `anonymous`,
    `already_current`, archived tool.
  - `record_session` is all-or-nothing.
  - `list_tool_trainees` never returns an email field.
- **Permissions table test:** `training.manage` for admin and super_admin only.
- **Component:** the staff island (empty, list, revoke), `/account` section (empty,
  expired chip), the workshop form preview.
- **E2E:** admin records a 3-person workshop, a seeded student sees it on `/account`,
  admin revokes, and the student sees "revoked".
- **Evals** (`evals/cases/training.yaml`, the agent eval harness):
  - student not signed off asks "how do I use the laser cutter?" → explains and warns,
    and does not refuse;
  - student asks "is Priya trained on the Glowforge?" → declines;
  - admin: "sign off these three on the Form 4" → one batch card, no claim of success
    before Confirm;
  - a note containing "ignore previous instructions" is treated as data;
  - expired record → says expired, not "not trained".

## 11. Cost

- **Build:** roughly 3 focused PRs. Phase 1 is the largest.
- **Run:** no new model jobs and no external services. Chat cost rises by one small
  tool-result field and a short prompt fragment, only for training-required tools.
  Storage is negligible (thousands of rows).
- **Operational:** someone has to enter sign-offs, or the record is worse than none
  (§12).

## 12. Risks

- **A stale record gives false assurance.** If staff stop recording, "the record shows
  none" becomes wrong and trains students to ignore the warning. Mitigation: phase 3's
  "recent" list makes the habit visible. The owner decides whether the lab commits to it
  (§13 Q1).
- **A duplicate system.** If the lab keeps a paper or Google Form log, two records will
  drift. Import once, or don't build.
- **Privacy creep.** Staff-wide visibility of every student's record may be more than
  needed (§13 Q3).
- **Tool count.** Four more action tools for admins adds to the parity spec's tool-block
  budget (parity §11 Q8).

## 13. Open questions for the owner

1. **Does the lab want this at all, and who keeps it up?** Is there a current training log
   (paper, Google Form, Canvas)? Should it be imported, and who owns entering sign-offs
   after every workshop?
2. **Student-records policy.** Does Cornell Tech treat makerspace training records as
   student records? That affects retention and who may see them. Decide before phase 1.
3. **Who sees whom.** Should every SuperMaker (`admin`) see every student's trainings, or
   only super admins and designated trainers?
4. **Unknown emails in a workshop list.** Create a pre-sign-in `user` row (today only
   `users.manage` may add people), hold a pending sign-off keyed by email that attaches at
   first sign-in, or just list them for follow-up?
5. **Who may sign off.** Any `training.manage` holder on any tool, or per-tool trainers
   (a new `tool_trainers` table)?
6. **Sign-offs on tools that don't require training.** Allow them (useful for
   "recommended" tools) or refuse?
7. **Personalized badge.** Should a signed-in student's tool cards show "Trained" instead
   of "Training Required"? It is nicer, but it costs the catalogue's cache for signed-in
   visitors.
8. **Default refresher periods.** One lab-wide default, per tool (as proposed), or none
   until asked?

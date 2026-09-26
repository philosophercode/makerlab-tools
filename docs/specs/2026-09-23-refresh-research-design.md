# Refresh Research for Existing Tools — Design Spec

**Date:** 2026-09-23
**Status:** Draft
**Target:** `v5/`
**Branch:** `v5/refresh-research-spec`
**Spec PR:** #TBD · **Implementation PR:** #TBD

## 1. Summary

Most of the lab's inventory was typed in by hand, in AirTable and then Notion, and nobody
has checked it against the manufacturers since. The Aug 29 **Catalog Reconciliation**, a
one-off research pass published as an artifact and never applied, showed what that costs.
Across 100 tools it found:

- six factual errors, one of them safety-relevant: a dust collector listed as 1-micron
  filtration when the manufacturer says 5;
- a duplicate;
- 73 names that aren't the manufacturer's;
- 151 safety fields that could be filled in.

**Refresh research** makes that a routine part of the app. An admin selects tools in
`/admin/inventory` and presses **Refresh research**. The same background research that
serves intake then runs on each tool:

- product page first;
- Exa search, with its captured page text as the fallback for blocked sites;
- the image finder;
- reviewer notes.

It runs **blind**: the model is given the tool's name, brand and category, never the
record's current values, so it cannot echo a hand-typed mistake back. Code then compares
the result with the record, field by field, and produces **proposals**. Each proposal has:

- the current value, the proposed value and a kind (*differs*, *new*, *unverified*);
- a safety marker where it applies;
- a verbatim quote and the URL it came from.

An admin reviews the proposals on a page ordered safety-first and **accepts or rejects
each one**. Nothing touches a tool until someone accepts a change. Accepted changes go
through the tool editor's existing save path: the revision check, cache invalidation and
the Notion mirror trigger all apply.

No architecture change: this adds one table, one workflow and two admin pages, all on
existing seams.

## 2. Goals / Non-goals

### Goals

- **Selective runs.** An admin can refresh one tool, a hand-picked set, or a filtered set
  (e.g. "never reviewed", "no PPE listed", a category) from `/admin/inventory`. Nothing
  refreshes on its own.
- **Blind research.** The research inputs are the tool's name, brand and category only.
  Current field values never reach a prompt.
- **Deterministic proposals.** Code, not the model, decides what counts as a change. A
  proposal is shown only when research found a value and it differs from the record, or
  fills an empty field.
- **Verified quotes.** Every proposal shows the quote and URL it rests on, and code checks
  that the quote really appears in the page text research read.
- **Safety first.** The review queue shows safety fields first: use restrictions,
  emergency stop, training required. PPE is not proposed, because lab staff set it.
- **Per-field decisions.**
  - Accept or reject each field, or accept a whole tool's proposals at once.
  - Accepting writes through the editor's save path with its optimistic-concurrency
    check, so a tool edited since the refresh was queued shows a conflict instead of
    being overwritten.
- **Floor checks.** A tool research can't identify (no brand or model, nothing online) gets
  a **needs floor check** flag, with what to write down from the nameplate. It appears
  under *Needs attention* in the inventory.
- **Cost.** About 3–5¢ per tool. Runs share intake's 100-items-per-person-per-day limit.

### Non-goals (this iteration)

- **Automatic application.** Article 5: a person approves every change.
- **Scheduled or periodic refresh.** Freshness checks are a later decision (§11). This
  spec builds the manual path they would use.
- **Importing the Aug 29 reconciliation's proposals.** They are a month old and were
  produced by an earlier research pipeline, so a fresh run is cheaper to trust than
  stale data is to reconcile. The artifact stays a reference.
- **Merging duplicates.** A likely duplicate is flagged in the proposal list. Merging two
  tools, with their units, resources and history, is a separate feature.
- **Changing category or location.** Research *suggests* a category, shown as a note, but
  taxonomy and physical location stay the admin's call in the editor.
- **Re-researching units.** Serial numbers, conditions and statuses are floor facts, not
  web facts.

## 3. Architecture

### 3.1 Reusing the research engine

The research steps already take a small input, `ResearchItemInput {name, brand,
categoryHint, locationHint}`, and return a `ResearchResult`. Refresh reuses them without
change:

```text
refreshBatch(requestId, refreshIds)          — "use workflow", chunked 3 at a time like researchBatch
  └─ per refresh:
       step: searchItem(...)                 — existing
       step: readAndVerifyItem(...)          — existing, extended to return citations (§4.2)
       step: findImages(...)                 — existing; skipped when the tool already has a cover photo
       step: proposeChanges(refreshId)       — NEW: load the tool, diff in code, store proposals
```

- **Input.** `brand` is not a tool column. It is parsed from the name where research
  already does so, or left null. `categoryHint` is the category's name.
- **What stays out of the prompt:** the description, specs, materials, PPE, tags,
  restrictions and notes never enter it.
- **The reviewer note** (from the reconciliation of 2026-09-23) works here too: an admin
  can queue a refresh with a note such as "the lab's unit is the 80 W model".

`src/workflows/refresh-batch.ts` sits beside `research-batch.ts`, and its steps live in
`src/lib/refresh/*`. Step modules export only steps; the rule recorded in the 2026-09-23
amendment still applies.

### 3.2 The diff, in code

`src/lib/refresh/propose.ts` is a pure function that takes the tool record and the
research result and returns the proposals:

| Field | Compared how | Kind rules |
|---|---|---|
| `name` | Normalized (case, punctuation, whitespace) | *differs* only when the normalized names differ and research's canonical name has a verified source |
| `description` | Always proposed when research wrote one and the current one is empty or shorter than 120 chars; otherwise *differs* only if the admin asked for descriptions on this run | Descriptions are prose: comparing them word by word is noise, so they're opt-in (§5.1) |
| `materials`, `tags` | Set comparison after label normalization | *new* for additions to an empty list; *differs* when the sets disagree; each added item listed |
| `training_required` | Boolean | *differs* / *new* only with a quote |
| `use_restrictions`, `emergency_stop` | Text, normalized | *new* when empty; *differs* when research found a different quoted restriction |
| Resources (manuals, videos) | By URL, after the same size-variant and locale normalization the image finder uses | *new* for verified links the tool doesn't have; existing links never proposed for removal |
| Cover photo | Only when the tool has none | *new*, using the image finder's chosen candidate |

- **Safety marker.** `use_restrictions`, `emergency_stop` and `training_required` are
  marked **safety**.
- **No PPE.** The lab's staff set `ppe_required` themselves (Isaac, 2026-09-23), so
  research leaves it empty and refresh never proposes it.
- **Unverified.** A field research left empty is recorded as *unverified*, so the review
  page can say "no manufacturer source found", which is different from "matches".
- **Values that match.** A proposal whose value equals the record is dropped, not shown.

### 3.3 Applying a decision

Accepting runs the same write the tool editor runs (`saveTool` in
`src/app/admin/inventory/actions.ts`, through `tool-write-context.ts`):

- **Revision check.** It uses the revision token captured when the refresh was queued
  (`base_revision`). If the tool changed since, the write is refused as a conflict. The
  review page then shows the current values beside the proposals, and the admin decides
  again.
- **Cache invalidation and mirror push** happen as for any edit.
- **Resources and the cover photo** go through the existing add-resource path and the
  approval image path. For the photo that means a download-before-write through the SSRF
  guard, copied into public Blob.
- **Audit.** Ordinary edits aren't audited under §4.11 of the data-platform spec, and
  accepting a proposal is an ordinary edit, so it writes no audit event. The refresh row
  records who decided what and when (§4.1), which is the history this feature needs.

## 4. Data model

### 4.1 `tool_refreshes` (migration `0009`)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `tool_id` | uuid fk `tools`, cascade | |
| `status` | text CHECK | `queued`, `researching`, `proposed`, `failed`, `decided` |
| `request_id` | uuid | Same meaning as on `pending_tools`: the run that owns the row |
| `base_revision` | text | The tool's revision token at queue time |
| `note` | text null | Reviewer note, ≤300 chars, one line |
| `include_description` | boolean default false | Whether description *differs* proposals are generated |
| `research` | jsonb null | The `ResearchResult`, same zod schema as intake |
| `proposals` | jsonb null | `FieldProposal[]` (§4.2) |
| `research_error` | text null | |
| `requested_by` | text fk `user`, set null | |
| `decided_by` | text fk `user`, set null | |
| `decided_at` | timestamptz null | |
| `created_at`, `updated_at` | timestamptz | `updated_at` by trigger, as elsewhere |

- **Unique partial index** on `tool_id` where `status in ('queued','researching','proposed')`,
  so a tool has at most one open refresh.
- **The daily limit** counts refreshes in the existing `research_requests` ledger, with a
  nullable `tool_refresh_id` beside `pending_tool_id`.

`tools` gains one column: `floor_check` (text null), holding what to write down from the
nameplate. Setting it is itself an accepted proposal. Clearing it is an edit in the tool
editor.

### 4.2 Types

```ts
// src/lib/refresh/types.ts
export type ProposalKind = "differs" | "new" | "unverified";
export type ProposalDecision = "pending" | "accepted" | "rejected" | "conflict";

export interface Citation {
  quote: string;          // ≤300 chars, verbatim from a page research read
  url: string;
  verified: boolean;      // code found `quote` in that page's text (whitespace-normalized)
}

export interface FieldProposal {
  field: "name" | "description" | "materials" | "tags"
       | "training_required" | "use_restrictions" | "emergency_stop"
       | "resource" | "cover_photo" | "floor_check";
  kind: ProposalKind;
  safety: boolean;
  current: unknown;       // snapshot at proposal time, for display
  proposed: unknown;      // absent for "unverified"
  citations: Citation[];  // ≥1 for "differs" and "new", except resource/cover_photo, which carry their URL
  decision: ProposalDecision;
}
```

**`ResearchResult` gains optional `citations`:** `Record<field, Citation[]>`, returned by
the read step and checked in code. It's optional, so intake rows parse unchanged, and
intake's preliminary page can show the quotes too, later.

**A proposal can't be accepted without a verified quote.** A *differs* or *new* proposal
whose citations are all `verified: false` is shown greyed as "quote not found on the page",
and it can't be accepted with one click. The admin has to open the editor.

## 5. Behavior / flow

### 5.1 Queue

1. **Select tools in `/admin/inventory`,** by checkbox or with the existing filters plus
   "Select all shown".
2. **Press Refresh research (N).** The dialog asks:
   - whether to propose description rewrites (off by default);
   - for an optional note, available when N = 1.
3. **Checks before anything runs.**
   - Permission: `tools.edit`.
   - The daily allowance, under the same advisory lock intake uses.
   - Tools that already have an open refresh are skipped, and the dialog says how many.
4. **Queue and start.** Rows are inserted `queued`, `refreshBatch` starts, and the dialog
   says "Refreshing N tools — results appear on the Refresh page."

### 5.2 Review — `/admin/refresh`

- **The list** holds open refreshes, ordered by what matters:
  1. tools with a safety *differs*;
  2. safety *new*;
  3. other *differs*;
  4. *new*;
  5. nothing to change.
  Each row shows the tool, proposal counts by kind, and its status. It polls while any
  row is queued or researching.
- **The tool page, `/admin/refresh/[id]`,** shows one card per proposal: field, current
  value → proposed value, kind and safety chips, and quotes with links. Each card has
  **Accept** and **Reject**. The page also has **Accept all verified**, **Reject all**,
  **Refresh again** (with a note) and **Open in editor**.
- **A refresh with no proposals** says "Matches the manufacturer's pages" and closes as
  `decided` when viewed.
- **A conflict** means the tool was edited since the refresh was queued. The affected
  cards show the new current value, and the admin decides again.

### 5.3 Unhappy paths

- **Research fails:** the row becomes `failed` with `research_error`; **Refresh again** is
  offered.
- **Research can't identify the tool:** a `floor_check` proposal ("record brand, model and
  serial from the nameplate") and nothing else.
- **The tool is deleted mid-run:** the row cascades away.
- **The tool is archived mid-run:** proposals are still shown, and accepting doesn't
  unarchive it.

## 6. UI

- **`/admin/inventory`:**
  - row checkboxes, a **Refresh research** action, and a "Refresh open" tag on rows with
    an open refresh;
  - a **Needs floor check** chip, and the same option under the Needs attention filter.
- **`/admin` index:** a **Refresh** entry in the surfaces table, for `tools.edit` holders,
  with the open-proposal count.
- **The review pages** reuse the admin palette and the intake page's patterns: chips for
  kind and safety, quotes in the mono blockquote style of the Aug 29 report.
- **States:** skeleton rows while loading, and an empty state ("No refreshes waiting").
  "Database unavailable" uses the existing admin error block.
- **Mobile:** each card stacks current and proposed values vertically.
- **Strings:** about 45 new keys under `admin.refresh.*`, English first (Article 6).

## 7. Relationship to existing work

- **Builds on** `docs/specs/2026-09-23-gateway-models-and-product-images-design.md` and
  all its amendments. It needs that spec's research engine, including product-page-first
  search, the Exa text fallback and reviewer notes.
- **Uses** the tool editor's save path and revision tokens (data-platform spec Phase 5),
  the research ledger (Phase 6), and the mirror trigger (Phase 8).
- **Supersedes** the one-off method of the Aug 29 Catalog Reconciliation artifact
  (https://claude.ai/artifact/AbztgUZ7x9xhDPBvqSo4Ed): blind research, a deterministic
  diff, verbatim quotes. This spec makes that method part of the app.
- **Stacks on** `v5/gateway-images`.

## 8. Security and safety

- **Authorization.**
  - Queueing and deciding need `tools.edit`.
  - Accepting a `name` change on a published tool also needs `tools.publish`, because the
    public page changes.
  - Every server action re-checks, as elsewhere.
- **Rate limiting and cost.**
  - Refreshes share the 100-per-person-per-day ledger, and at most 25 can be queued per
    press.
  - About 3–5¢ per tool, so about $3–5 for the full inventory.
  - The Gateway spend limit is the ceiling.
- **Prompt injection.**
  - Research reads the open web, as intake does.
  - A proposal can only change a field after a person accepts it.
  - Quotes must be found verbatim in the page text code fetched, so a model can't invent
    one.
  - Proposals are rendered as text, never as HTML.
- **Write safety.** Every write needs a person (Article 5), goes through the revision
  check, and is recorded on the refresh row.
- **PII.** None: refresh reads manufacturer pages and writes tool fields.

## 9. Phased build order

| # | Phase | Delivers | Depends on |
|---|---|---|---|
| **1** | Engine | Migration `0009` (`tool_refreshes`, `tools.floor_check`, ledger column); `citations` on the read step, with code verification; `propose.ts`; `refreshBatch` workflow; queue route/action with limits | `v5/gateway-images` merged |
| **2** | Review | `/admin/refresh` and `/admin/refresh/[id]`; accept/reject/accept-all through the editor path; conflict handling | 1 |
| **3** | Inventory hooks | Checkboxes and the Refresh action on `/admin/inventory`; Needs floor check chip and filter; `/admin` entry | 1 (can run in parallel with 2) |

Each phase leaves `main` deployable. No run over the real inventory happens as part of
the build. The first run is Isaac's choice of tools, afterwards.

## 10. Testing

**Unit:**
- `propose.ts` over fixtures shaped like the Aug 29 findings:
  - WEN DC3401's 1-micron vs 5-micron → safety *differs*;
  - RYOBI PCL235 drill vs impact driver → a name *differs* with a quote;
  - Form 2's 25-micron XY vs 140 µm → *differs*;
  - PPE returned by a model → no proposal, since staff set PPE;
  - matching values dropped;
  - an empty research field → *unverified*;
  - description rules, set comparison, resource URL normalization.
- **Quote verification:** exact, whitespace-normalized, not found, and a quote from a page
  that wasn't read.
- **Blind input:** the prompt built for a refresh contains no current field value, even
  when the tool has every field filled.

**Integration** (PGlite, MSW, the Gateway stub):
- **Queueing:**
  - limits;
  - one open refresh per tool;
  - skipped count;
  - a start failure.
- **The workflow:**
  - proposals stored;
  - research failure → `failed`;
  - an unidentifiable tool → `floor_check` only.
- **Accepting:**
  - writes through the editor path;
  - stale revision → `conflict`;
  - a name change on a published tool without `tools.publish` is refused;
  - accept-all skips unverified quotes;
  - a resource or cover proposal lands through the existing paths.
- **Mirror:** an accept triggers `requestMirrorPush`.

**Component:** proposal cards for every kind, safety, conflict and unverified-quote state;
the list ordering; the inventory selection and dialog.

**E2E:** an admin selects two tools, presses Refresh (stubbed research), opens the Refresh
page, accepts a safety field on one and rejects a name on the other, and the public tool
page shows the accepted value.

**Cases that would embarrass us in production:**
- A refresh overwrites a field an admin edited that afternoon.
- A "quote" that isn't on the page is shown as evidence.
- The model sees the old value and "confirms" the hand-typed mistake.
- Refreshing the whole inventory by accident spends $50 because a limit was bypassed.
- A proposal renames a published tool without anyone who can publish seeing it.

## 11. Open questions

| # | Question | Recommendation | Who | By |
|---|---|---|---|---|
| 1 | **Which tools first** | Start with the tools the reconciliation flagged (WEN DC3401, Form 2, RYOBI PCL235, P103, STANLEY TR150, the two heat guns) and the 3D printers and lasers | Isaac, Luis | After Phase 2 |
| 2 | **Periodic freshness checks** (re-verify links and a few tools per night) | Later; this spec's queue is what it would call | Isaac | Later |
| 3 | **Brand as a real column** | Not now; parse from the name. Revisit if refresh keeps misreading brands | Isaac | After first runs |
| 4 | **Description rewrites** | Off by default, opt in per run; Isaac and Luis tune the research prompt's descriptions first | Isaac, Luis | Phase 1 |

## 12. Research with the assistant

Added 2026-09-23 at Isaac's request. The refresh queue in §3–§5 works in batches and in the
background. This section is the **conversational** way into the same proposals: an admin on
a tool's page, or on a pending item's preliminary page, tells the assistant what to change
("the specs are thin — check the manual", "this is the 80 W version, fix the power"). The
assistant researches it in that chat turn and answers with proposals the admin accepts or
rejects inline.

*Mode 1*, "guided redo", is a separate thing, built in `v5/gateway-images`: Research again
with focus chips and a guidance note, re-running only the chosen parts in the background.
It's recorded in the Gateway/images spec's amendments, not here.

### 12.1 What the assistant gets

- **A new capability, `curation`** (Article 2): `chatOnly`, and `requiredPermission:
  "tools.edit"`, or `tools.approve` for pending items.
- **Its tools:**

  ```ts
  // Read the record the admin is looking at, as the model may see it for curation.
  get_record({ subject: { kind: "tool" | "pending", id: string } })
    → { fields: Record<ProposalField, unknown>; revision: string; sources: string[] }

  // Put a change in front of the admin. Writes nothing.
  propose_change({
    subject: { kind: "tool" | "pending", id: string },
    field: ProposalField,          // same list as §4.2; never PPE
    value: unknown,                // validated per field (string, string[], boolean, resource)
    citations: { quote: string; url: string }[],
    reason: string,                // ≤200 chars, shown on the card
  }) → { proposalId: string; verified: boolean[] }
  ```

- **Search and page reading use tools chat already has:** `exa_search` and `read_page`.
  In curation turns `read_page` may also open the subject's own source hosts and the hosts
  of pages this turn's searches returned. The SSRF guard is unchanged.
- **A fenced "Curating: <tool name>" block in the system prompt:** the record's current
  values and revision, and the rule that the assistant proposes changes and never claims
  to have made them.

  This is the one place a model *does* see the current record, on purpose. The admin is
  steering a targeted fix, not asking for a blind check. Blind research stays the batch
  refresh's job (§3.1).

### 12.2 Proposals in chat

- **`propose_change` stores a `FieldProposal`** (§4.2) in a new `chat_proposals` table:
  - the same shape as a refresh proposal, plus `subject_kind`, `subject_id`,
    `base_revision`, `created_by` and `chat_id`;
  - it expires after 7 days;
  - citations are verified in code against the page text read *in this turn*, exactly as
    in §4.2.
- **It emits a `data-proposal` UI part:** a card with field, current → proposed, the quote
  and link, a *quote not found* warning when a quote couldn't be verified, and **Accept** /
  **Reject**.
- **Accept calls a server action, never a model tool.**
  - It re-checks the permission, then writes through the same path as §3.3: the editor
    save with `base_revision`, so a stale revision shows a conflict on the card.
  - For a pending item it updates `research` and the preliminary page's draft instead.
  - The model can't accept its own proposals; only the admin's click can.
- **Several proposals can arrive in one turn** (e.g. five specs), with **Accept all
  verified**.

### 12.3 Where it appears

- **The chat FAB on `/tools/<slug>`** (for `tools.edit` holders) and on
  `/admin/intake/[id]` gets a "Curate this entry" starter chip. The chat is told which
  record the page shows (the focused tool, as today, or the pending id).
- **Visitors never see curation.** For anyone without the permission, the capability
  isn't composed at all.

### 12.4 Security and safety

- **Proposals only, no writes by the model** (Article 5). The accept action re-checks
  permission and the revision.
- **Prompt injection:** a hostile page can at most produce a proposal the admin sees,
  quote and all, and a quote that doesn't appear on a page read that turn is shown
  unverified. No proposal can publish, archive or delete anything.
- **Cost:** a curation turn runs on the chat model with at most 5 searches and 5 page reads,
  and chat's existing rate limits apply.

### 12.5 Build order and testing

- **Build order:** Phase 4, after Phases 1–2, because it reuses `FieldProposal`,
  verification and the accept path.
- **Unit:**
  - `propose_change` validation per field, with PPE refused;
  - citation verification against this turn's pages;
  - the capability isn't composed without permission.
- **Integration:**
  - accept through the server action (success, stale revision → conflict, permission
    refused);
  - a pending-item accept updates `research`;
  - the model calling a write path is impossible (no such tool).
- **Component:** proposal card states (verified, unverified, conflict, accepted, rejected),
  and Accept all verified.
- **E2E:** an admin on a tool page asks the stubbed assistant to fix a spec, a card
  appears, Accept, and the public page shows the new value.


## Amendments

Appended per [`DRIFT.md`](DRIFT.md). Original text above is never edited.

### 2026-09-23 — Phases 1–4 built: refresh, review, inventory hooks, research with the assistant

**Status.** Built on `v5/refresh-research` (off `main` at `bd58f8f`): §9 phases 1–3 and §12
(phase 4). Mode 1 (guided redo) was already built on `v5/gateway-images` and is unchanged.
**Not built:** the two E2E scenarios (§10, §12.5) — the unit, integration, workflow and
component tiers cover the same paths offline; no batch refresh has been run on real data.

**As built, and where it differs from the text above** (choices the spec left open took the
simplest option consistent with it):

- **§4.1 migration `0012_refresh_research`**, not `0009` (0009–0011 were taken). One
  migration holds `tool_refreshes`, `chat_proposals` (§12.2), `tools.floor_check` and
  `research_requests.tool_refresh_id`. `tool_refreshes` also has `workflow_run_id` (for
  diagnosis, as on `pending_tools`); both tables get the `updated_at` trigger. The one-open
  rule is the partial unique index `tool_refreshes_one_open_idx`.
- **§4.1 note length.** The note is the reviewer note of the guided-redo amendment —
  `parseReviewerNote`, one paragraph, **≤ 1000** characters — not 300: one rule for every
  note research takes.
- **§3.1 the engine.** `searchItem` / `readAndVerifyItem`'s bodies moved to
  `research/engine.ts` (`runSearch`, `runRead`), which take only a `ResearchItemInput`;
  intake's steps call them unchanged, and `refresh/steps.ts` (`searchRefresh`,
  `readRefresh`, `findRefreshImages`, `proposeRefresh`, `markRefreshFailed`,
  `finishRefreshBatch`) calls them for a tool. `src/workflows/refresh-batch.ts` chunks three
  at a time. The blind input (`refresh/blind-input.ts`) is **name and category name only**:
  `brand` null (research settles the make from the name — open question 3), `locationHint`
  null.
- **§4.2 citations.** The read prompt now asks every run (intake too) for `citations` —
  1–3 verbatim quotes per field (`canonicalName`, `description`, `materials`, `tags`,
  `trainingRequired`, `useRestrictions`, `emergencyStop`) with the page's URL — and for
  **`emergencyStop`**, which research did not produce before (§3.2 needs it). Both are
  optional on `ResearchResult`. Code checks each quote against the text the model was given
  for the page it names (`refresh/citations.ts`: whitespace, case, typographic quotes and
  dashes flattened, a trailing full stop allowed, fence labels stripped from the URL, quotes
  under 8 characters never verified); a quote on another page, or on none, is
  `verified: false`.
- **§3.1 images.** The image step runs only for a tool with no public photo, and **ranks
  only** (`rankAndClean(…, { clean: false })`): no cleaned copy is stored during a refresh.
  Accepting a `cover_photo` downloads the ranked-first original then, through the approval
  image path (`storeResearchImage`: SSRF guard, format check, public Blob,
  `origin: research_image`) and attaches it as the tool's photo. A failed download is the
  `image_not_attached` warning on a landed write.
- **§3.2 the diff** (`refresh/propose.ts`):
  - *name*: proposed only as *differs* and only with at least one **verified** name quote;
    otherwise not at all.
  - *materials, tags*: only additions are proposed; the proposed list is the record's plus
    research's new labels (`added`); a list research found a subset of is not proposed.
  - *training_required*: *differs* only (a boolean is never empty); `null` from research is
    *unverified*.
  - *unverified* fields are stored like the others and shown folded ("No manufacturer source
    found"); they never count as changes.
  - An **unidentified** tool is one research read nothing for, or knew only the type of
    (`evidence.categoryOnly`): one `floor_check` proposal, whose value is a fixed English
    instruction stored as data (like a maintenance ticket). No floor check is proposed when
    the same one is already owed.
  - Proposals are ordered safety first, then *differs*, *new*, *unverified*.
- **§3.3 accepting** (`refresh/apply.ts`, `refresh/decisions.ts`). All accepted field
  proposals are **one** `saveToolFields` patch at `base_revision`; then each resource through
  the editor's `addResource` and the cover through `attachPhotos`, each at the revision the
  previous write returned. After a write the refresh's `base_revision` moves to the tool's
  new revision, so the next card on the same refresh is not a false conflict. On a conflict
  nothing is written; every undecided card whose field moved takes the record's value now and
  is marked `conflict`, and `base_revision` moves to the tool's current revision so the admin
  can decide again. Decisions also compare the **refresh row's** revision the page rendered
  with, so two admins cannot overwrite each other's cards (`stale_refresh`). New manual
  links go to `requestManualArchive`; every landed write calls `requestMirrorPush`.
- **§5.1 queue.** A server action (`queueToolRefresh`, `app/admin/refresh/actions.ts`,
  `tools.edit`), not a route. Too many (> 25) is `too_many_tools`. When `start()` throws
  the rows become **`failed`** with the reason (not left `queued`): an open row would block
  the tool, and **Refresh again** is the retry. A refresh nobody has written for 24 hours is
  failed at the next queue of that tool (`failAbandonedRefreshes`), so a dead run cannot
  block it for ever. The dialog is an inline panel (the admin palette's no-modal rule).
- **§5.2 review.** `/admin/refresh` lists open **and failed** refreshes (the latest per
  tool), sorted by `refreshRank`, polling every 5 s while any runs. **Refresh again** closes
  a `proposed` refresh (`decided`; its undecided cards stay undecided in the record) and
  queues a new one with the note. Research's category suggestion and a likely duplicate
  (`findDuplicate` on the canonical name, now with `excludeToolIds`) are computed when the
  page renders, as notes — nothing extra is stored. "Open in editor" goes to the tool's page,
  where `EditToolControl` opens the editor.
- **§6 inventory.** Row checkboxes, **Select all shown** (the selection survives filtering),
  **Refresh research (N)**, a "Refresh open" tag linking to the refresh, a **Needs floor
  check** flag and filter option. The inventory read is now six statements (open refreshes
  are read in bulk). The editor shows **Floor check** while one is owed, so staff can clear
  it. `/admin` lists **Refresh research** with the number of refreshes waiting.
- **§6 strings.** `admin.refresh.*`, `admin.proposal.*`, `admin.errors.{stale_refresh,
  unverified_quote, too_many_tools, expired}` and a few chat keys, **English only**; other
  locales fall back to English, as the manual-text amendments did.
- **§3.7 of the manual text spec** is built here — see that spec's amendment of today.

**§12 research with the assistant, as built:**

- **Composition.** `curationCapability(kind)` (`capabilities/curation.ts`) is not in the
  registry: the chat route adds it only when the page shows a record the caller may curate
  (`lib/chat/curation.ts`: `tools.approve` for a `pendingId` the preliminary page sends,
  `tools.edit` for the `toolId` a tool page sends, drafts included), and
  `capabilitiesForIdentity` enforces its `requiredPermission` as for every capability.
  Visitors and students never get it. Both tools are `chatOnly`.
- **Tools.** `get_record` and `propose_change` as §12.1 describes. `propose_change` is
  `kind: "write"` (it stores a `chat_proposals` row) and writes no record. Field list = §4.2
  **minus `cover_photo`** (images are chosen on the preliminary page or in the editor — a
  chat card has no candidate list to choose from), and `floor_check` only for tools. PPE —
  any field name containing "ppe" or "protective" — is refused with an explanation. A value
  equal to the record is refused (`matches`). List fields take the complete new list.
- **Quotes against this turn.** `lib/chat/turn-sources.ts` keeps, per turn (a `WeakMap` on
  the turn's `CapabilityCtx`, the `read_page` cap's idiom), the text of every page
  `read_page` read, every passage `search_manual` returned with a URL, and every Exa result
  (title, highlights and text, recorded after each step by `onStepFinish` via
  `exaResultTexts`). In a curation turn `read_page` may also open the record's own source
  hosts and the hosts those Exa results came from; the SSRF guard is unchanged. Chat's caps
  (5 searches, 5 reads) apply.
- **Accepting is a route, `POST /api/chat-proposals`** (`{ ids, decision }`), not a server
  action — like the intake table card, because `ChatFab` is a global client island. It
  rate-limits on the `pendingTools` tier, requires sign-in and re-checks the permission per
  subject, refuses decided and **expired** (7 days) cards, and applies a tool's cards through
  `apply.ts` (same conflict rule as above; the card shows the record's value now). A pending
  item's cards are written into `pending_tools.research`, conditional on the item's revision
  (`writePendingResearch`); the preliminary page is re-keyed on the draft's fields so the
  change shows — which drops unsaved typing on that page, the price of showing the accepted
  change. After an accept, the subject's **other open cards** made at the same starting
  revision, about other fields, move to the new revision (otherwise accepting one card of a
  turn made all the others conflicts). Expired rows are kept as history; nothing deletes them.
- **Where it appears.** `ChatFab` renders `data-proposal` parts as `ChatProposalCards`
  (shared `ProposalCard`, **Accept all verified** when two or more are acceptable) and offers
  "Curate this entry" where the page registered a curatable record through the launcher
  (`CurateChatStarter`, rendered by `EditToolControl` once `/api/identity` says `tools.edit`,
  and by `/admin/intake/[id]`). The chip sends a fixed curation prompt.
- **Evals.** `evals/cases/curation.yaml` (proposes a fix without claiming to have made it;
  never proposes PPE; only reads when told not to change anything), with a new
  `not_called_tool` assertion and a `curate: true` case context. The paid eval run (`npm run
  eval`) was **not** run for this change.

**Live check (2026-09-23)**, `.livecheck/refresh/refresh.live.ts` (git-excluded): the real
refresh steps (not the workflow runtime), Luna on the flex tier through the Gateway, the
real web, in the worktree's scratch PGlite (`PGLITE_DATA_DIR=.pglite-data`, demo-seeded, plus
a hand-typed "WEN DC3401" with the reconciliation's 1-micron error and no photo; the real
Form 4 manual extracted and embedded into it first: $0.0006).

| Tool | Time | Gateway-reported model cost (search + read + rank) | Exa (tool results) | Proposals |
|---|---|---|---|---|
| Form 4 (own manual processed) | 195 s | $0.0247 + $0.0026 + $0.0002 = **$0.0275** | $0.021 | use restrictions *differs* (safety, quote ✓), name "Formlabs Form 4" (✓), materials +2, tags +MSLA/LFD (✓), 4 resources, cover; emergency stop *unverified* |
| Trotec Speedy 400 | 90 s | $0.0172 + $0.0018 = **$0.0190** | $0.014 | materials +6 (two quotes ✓, one ✗ shown), tags +2, product page and operating manual; restrictions and E-stop *unverified* |
| WEN DC3401 | 84 s | $0.0225 + $0.0009 + $0.0002 = **$0.0236** | $0.014 | name "WEN DC3401 Rolling Dust Collector" (✓), description *differs* (3 quotes ✓), tags, materials, product page, manual, cover |

- The Form 4's own manual reached the read step as **passages** (15,964 characters, within
  the 16k budget) beside a second manual PDF the search found.
- The WEN's wrong "1-micron" restriction came back **unverified**, not corrected: research
  found the page's "5-micron zippered collection bag" (quoted under tags) but did not phrase
  a use restriction. A refresh surfaces "no source for this field"; it does not invent one.
- The Form 4's proposed use restriction ("Young or inexperienced users must be supervised",
  verified in the user guide) would *replace* "Resin handling training required" — exactly
  the kind of card a person must read before accepting.
- **Curation turn** (admin on the Trotec's page: "The description is thin. Check Trotec's own
  Speedy 400 page for the working area and the laser power options, and propose fixes"):
  `get_record`, 4 × `exa_search`, 4 × `read_page`, 1 × `propose_change`; Exa $0.028. Reply:
  "I proposed a fuller description with Trotec's listed **1016 × 610 mm (40 × 24 in)**
  working area and **80 W or 120 W CO₂** power options. I noted that this lab unit's actual
  power configuration isn't confirmed. The proposal is ready for review; the record hasn't
  changed." Both quotes ("Speedy 400 Working area (W x D) 1016 x 610 mm (40 x 24 in)",
  "Speedy 400 Laser power CO2 80W, 120W") verified against a troteclaser.com page read that
  turn. The chat turn's model cost was not captured (the route does not report it).
- Total Gateway-reported spend of the check: model calls ≈ $0.07, Exa ≈ $0.077 (if billed on
  top), embeddings $0.0006, plus the chat turn's model tokens — well under $0.50.

### 2026-09-24 — Research never replaces lab rules

**Decision (Isaac, 2026-09-24).** Use restrictions, training requirements and similar
lab-owned safety and access rules belong to the lab, like PPE. A manufacturer's page is not
an authority over them. The live check above showed why: the Form 4's "Resin handling
training required" came back as a card that would *replace* it with "Young or inexperienced
users must be supervised".

**What changes (§3.2, §3.3, §12.1), for a tool in the catalogue:**

- **Restrictions only gain lines.** When the tool has restrictions, a restrictions proposal
  keeps the lab's text verbatim and appends research's new lines, listed in `added`, as a
  *differs* card (like a list card). A line the lab's text already says (normalized) adds
  nothing, and then no card is made. Empty restrictions are still filled as *new*. The Form 4
  card now proposes "Resin handling training required before first print." plus "Young or
  inexperienced users must be supervised." on the next line. The card says "The lab's rules
  are kept. Adds: …" (`admin.proposal.addedRule`).
- **Training only tightens.** Research may propose `training_required: true`. It never
  proposes turning a lab's `true` off. That case gets no card, where before it got a *differs*
  card.
- **The assistant's `propose_change`** (chat curation and MCP share `proposeChange`) follows
  the same rule. A restrictions value becomes an addition beside the lab's; the reply carries
  `lab_rules_kept: true` and `added`. A value that only removes or rewords the lab's lines, or
  `training_required: false` when the lab requires training, is refused as `lab_rule_kept`
  with a reason. The curation prompt and the MCP tool description say this.
- **Conflicts re-base additively.** After a conflict a restrictions card puts its added lines
  on top of the lab's text as it is *now*. It never proposes the text the card was made
  against (`rebaseAfterConflict`, and the chat conflict path).
- **Accepting has a last guard.** `refusalFor` refuses a tool proposal that would drop a lab
  restriction line or turn training off: `replaces_lab_rule`, with the message
  `admin.errors.replaces_lab_rule`. Accept all skips it. Only a card stored before this
  amendment, or one edited by hand, can hit the guard.
- **Where it lives.** All of these use one module, `src/lib/refresh/lab-rules.ts`.
  `normalizeText` and `normalizeLabel` moved to `refresh/normalize.ts`; `propose.ts` still
  re-exports them.

**Not changed.**

- **A pending item (intake).** Its restrictions and training flag are research's drafts, so
  they are proposed and replaced as before (`refusalFor(…, { subjectKind: "pending" })`).
  PPE stays empty there as everywhere: `assemble` clears it and no proposal field names it.
- **Emergency stop.** It stays a replaceable *differs*. It describes the machine (where the
  stop is and how it works), not a rule the lab set, and a wrong location should be
  correctable.

**Tests.** `lab-rules.test.ts` covers the pure rule. `propose.test.ts` covers the Form 4
case, training never turned off, an already-stated line and PPE. `decisions.test.ts` covers
an addition landing, an additive re-base after a conflict, and a stored replacement refused.
`curation.test.ts` and `mcp/route.test.ts` cover `propose_change` on chat and MCP.
`ProposalCard.test.tsx` covers the card text. `refresh-batch.workflow.test.ts` and
`admin/refresh/actions.test.ts` now expect the additive card.

### 2026-09-25 — Starting a refresh from `/admin/refresh`

§5.1 started refresh research only from the inventory's selection. The owner
asked for a way to start it from the page that shows its results. `/admin/refresh`
now has **Refresh research…** in its header: a dialog (`RefreshPicker`) over
every tool that is not archived, narrowed by presets — **Never reviewed**,
**No manual**, **Not refreshed in 90 days** (never refreshed counts) — a
category and a name, with **Select the first 25**. It queues through the same
server action as the inventory (`queueToolRefresh`), so nothing about queueing
changed: `tools.edit`, at most 25 a press, the daily allowance shared with
intake (`daily_limit` said with what is left), a tool with a refresh already
open skipped — and here also not selectable. One new read,
`lastRefreshedByTool` in `data/tool-refreshes.ts` (one grouped statement: each
tool's latest request, any status), feeds the 90-day preset. The empty queue's
sentence now points to the button. See the UI system spec's amendment "Admin
polish".

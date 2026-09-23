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

# Assistant Cleanup: Triage the Catalogue in Batches — Design Spec

**Date:** 2026-10-28
**Status:** Implemented
**Target:** the app (repository root)
**Branch:** `claude/project-thread-wxxhjq`

## 1. Summary

After a bulk import the demo lab had 38 tools and every one said **Category: Not set**.
The owner asked the assistant to categorise them; it described categories but none was
applied. Two causes, one bug and one gap:

- **The bug: a lab created after taxonomy v2 has no categories at all.** The tree in
  `src/lib/taxonomy/tree.ts` reached a database only through `npm run taxonomy:migrate`
  or the built-in demo seed. The demo deployment's own Neon database never ran either,
  so research's prompt listed no category, research could only *propose* one, approval
  saved every tool uncategorised (and filed the guess in `category_proposals`), and
  `recategorize_tool` had nothing it could name.
- **The gap: no way to work through loose ends in bulk.** The assistant could move up to
  20 tools per card, but had no list of what was uncategorised, no way to rename many
  units at once, and no way to tell which review-queue photos were good enough to approve
  without a look.

This spec fixes the bug and gives the assistant a triage loop: **read → group → propose
cards → list what's left for a person.** Every change is still a proposal the person
confirms, the same cards as `research_import`.

## 2. The default tree on an empty lab

- `ensureDefaultTaxonomy()` (`src/lib/taxonomy/seed.ts`) writes `TAXONOMY_TREE` when the
  `categories` table has **no rows at all** — live or retired. Any row means somebody has a
  taxonomy, and it is never touched. One transaction, parents first, a slug that exists
  already is skipped; remembered per process once rows exist.
- `listCategoriesForChoosing()` seeds, then lists. It replaces `listCategories()` where a
  category is chosen: research's search and read steps, approval's draft (page and
  `approve_pending_items`), the import review, the tool editor, `list_categories`,
  `list_uncategorized_tools`, `review_approval_queue`; `/admin/taxonomy` seeds before it
  reads. A failed seed is logged and the list read anyway. `listCategories()` itself
  stays a plain read (tests and scripts call it on purpose-built tables).
- **Items researched before the seed still get a category.** `proposedCategory` in
  `intake/approval-draft.ts` matches research's answer again against the categories that
  exist now: its stored id, else its slug or name (`matchCategory`), else the name of the
  category it proposed. `suggestedCategory` adds the item's own hint (an imported list's
  "category" column) by exact name as the last fallback. A proposal whose name is now a
  live category is not filed again (`proposeCategory` false).

## 3. The cleanup reads (`capabilities/cleanup.ts`, chat only)

| Tool | Permission | Lists |
|---|---|---|
| `list_uncategorized_tools` | `tools.edit` | Tools not archived with no category: id, slug, name, official name, state, and `suggested_category` — a live category's slug from research or the import hint, never research's free text |
| `list_unit_labels` | `tools.edit` | Units not retired, grouped by tool (optionally some tools): id, label, status |
| `review_approval_queue` | `tools.approve` | Researched items: confidence, whether a card can approve it (`approvalRefusal`), the category approval would give it, a photo verdict (§4). Names fenced; reading it taints the turn |

The capability's prompt fragment (staff with `tools.edit`) is the playbook: read first;
several cards in one reply, one per distinct change and ≤ 20 rows each (one
`recategorize_tool` per target category; `rename_units` only for labels that differ from
the style most units use; `approve_pending_items` only for items a card can approve whose
photo is **good**); end with a short list of what was not proposed and why, with links.

## 4. Photo verdicts without the chat seeing photos

The chat model does not see images, and does not need to: research's image stage already
ran a vision call over every candidate (`research/images/rank.ts`) and kept only photos
of the whole product, each with its view, composite flag and measured background.
`intake/image-verdict.ts` turns that stored judgement into a verdict in code:

- **good** — rank 1 (or its cleaned copy) is a front or three-quarter view, not a
  composite, short side ≥ 400 px, and not a busy background left uncleaned;
- **check** — anything else, with the reasons (an uploaded photo nobody judged; a row
  ranked before views were recorded);
- **none** — no photo (or research rejected every picture it found).

## 5. Renaming many units: `units.rename` → `rename_units`

A new action: up to 20 `{ unit_id, label }` pairs, of one tool or several, on one card.
Each row is the editor's own unit write with its tool's revision. `units.rename` and
`units.edit` join `CHAINED_ACTIONS` (`revision-chain.ts`): several rows for one tool
confirm in one click instead of the second answering `conflict`. Catalog risk,
`tools.edit`, proposable over MCP like `edit_unit`.

## 6. Not in scope

- Renaming tools in bulk: a tool's name stays `propose_change` (citations, the name-clash
  check), one field at a time.
- Approving catalogue photos of tools already published; this triage is the review queue.
- A GUI button for the seed: an empty lab is seeded on first use.

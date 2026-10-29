# Photo Options — Design Spec

**Date:** 2026-10-29
**Status:** Implemented
**Target:** the app (repository root)
**Branch:** `claude/project-thread-l4us7p`

> Written by AI after the owner's request (2026-10-29): "there are a bunch of tools that have bad
> photos — either they're the wrong photo or they have a background or they're like a retail store
> versus the original marketing. There should be a way to be like, give me photo options."

## 1. Summary

A catalogue tool's cover photo is whatever intake picked, or whatever somebody uploaded, months
ago. Many are poor: another model, a busy room, a shop's listing photo rather than the maker's own
product shot. Until now the only fixes were to upload a better photo by hand, or to run refresh
research, which proposes a cover only for a tool that has none.

**Find photo options** in the tool editor's Photos section searches the web for better cover
pictures of that tool — the manufacturer's own clean product shots first — and shows up to six as
tiles. The admin picks one and presses **Use as cover**: the picture is downloaded, its background
removed (the deterministic cutout intake already uses; never a generative redraw), and it becomes
the cover, replacing the old one unless they untick that. The assistant can do the same: propose
the search, list the options, and propose using one — each committed only on the person's card.

No architecture change: it reuses research's image stage (Exa search, probe, vision ranking,
cutout), the approval image path's guarded download, and the editor's photo write.

## 2. Goals / Non-goals

### Goals

- An admin with `tools.edit` can get a fresh set of candidate photos for any catalogue tool, from
  the tool editor, in about a minute, without leaving the panel.
- The candidates favour the maker's official marketing photo of the whole machine on a plain
  background, and push retailer listings, shop or showroom scenes, banners, back views and other
  models down or out.
- **Find more options** never offers the same pictures again, nor the picture the current cover was
  downloaded from.
- Picking one makes it the cover in one write at the panel's revision; the old cover is removed by
  default and can be kept.
- The assistant has parity: `find_photo_options`, `get_photo_options`, `use_photo_option`.

### Non-goals (this iteration)

- **Batch photo search** across many tools at once. One tool per press keeps the cost visible; the
  assistant can propose several cards in a row.
- **A photo-quality audit** that flags bad covers by itself. The admin decides which tool needs one.
- **Generative clean-up.** Retired on 2026-09-23 (gateway spec amendment "No generative redraw").
- **Over MCP.** The search spends the research allowance (MCP never gets spend actions, parity spec
  §11 answer 4); using an option is catalogue work and is proposable over MCP like any editor write.

## 3. Architecture

### 3.1 The search (`photos.find_options`)

`src/lib/actions/photo-options.ts` → `lib/photo-options/request.ts` (`requestPhotoOptions`) writes
a `searching` row and charges **one item of the caller's daily research allowance** in one
transaction, under the same per-person advisory lock as Research and Find a different image
(`data/photo-searches.ts`, `startPhotoSearch`). One search may run per tool; a row `searching` for
more than ten minutes is closed as failed first, so a lost run never blocks the button. Then it
starts `src/workflows/photo-options.ts` → `research/photo-options-steps.ts` (`searchPhotoOptions`):

1. **The tool's own links.** Its web-page resources (no PDFs, no videos), at most four, the brand's
   product page first, read through the SSRF-guarded reader on their own hosts only, for the
   pictures they declare.
2. **One Exa search** (`searchProductPictures`, job `researchSearch`, flex), aimed at the
   manufacturer's product page and told the house preference (`PHOTO_PREFERENCE`) plus the admin's
   note.
3. **New pictures only.** Every picture the tool's last three searches offered, and every
   `attachments.source_url` of its current photos, is left out (`photoCandidates`).
4. **Probe and rank** exactly as research does (`probeCandidates`, `rankCandidates`: job
   `imageRank`, the same subject verdicts — only the product itself passes — composites last,
   plain backgrounds preferred, front views first, the maker's own pictures first in each tier),
   with the preference and note as the reviewer instruction and `maxShown` 6.
5. **Write** the options to the row, only while it is still `searching`. Nothing is downloaded to
   keep and nothing is cleaned.

**The brand** is not a tool column. `brandFromLinks` takes the name's first word (or two) as the
brand only when one of the tool's own resource links is on a host that carries it, so the
"Manufacturer" tag and the ranking's maker-first order apply when the record backs them, and a
generic name never makes a retailer's domain the maker.

### 3.2 The pick (`photos.use_option`)

`lib/photo-options/pick.ts` (`pickPhotoOption`): the URL must be one the search recorded, exactly
(the SSRF rule intake's "original" uses). It is downloaded through `storeResearchImage` — guarded
fetch, JPEG/PNG/WebP, stored public as a `research_image` with its source URL — and, with **Remove
the background** (default on), cleaned with `cleanPickedImage` from the hints the ranking recorded
(`pickHints`); off, it is stored as downloaded. Then `inventory/photo-edits.ts`'s new
`setCoverPhoto` claims it, puts it at position 0, and with `replaceCover` (default on) releases the
old cover in the same transaction, at the panel's revision. A download that fails is the refusal
`photo_unavailable` (nothing was written). The pick is recorded on the row (`chosen_url`) and the
mirror is told.

### 3.3 Surfaces

- **The tool editor** (`/admin/inventory` panel and the tool page's sheet): `PhotoOptions` under
  the Photos list. Server actions in `app/admin/inventory/photo-option-actions.ts`: `findPhotoOptions`
  and `pickPhotoOption` are one-line `performAction` wrappers; `loadPhotoOptions` is the poll (a
  read, exempt as such).
- **The assistant**: `find_photo_options` (spend; a card), `get_photo_options` (read, `tools.edit`;
  fenced as outside content and tainting the turn), `use_photo_option` (catalog; a card, by option
  number).

## 4. Data model

Migration `0036_photo_options`: `tool_photo_searches` — `id`, `tool_id` (cascade), `status`
(`searching` | `ready` | `failed`), `note`, `options` (jsonb `PhotoOption[]`), `error`,
`requested_by`, `chosen_url`, `chosen_by`, `chosen_at`, timestamps. Partial unique index: one
`searching` row per tool. The allowance is the existing `research_requests` ledger (a row with
neither `pending_tool_id` nor `tool_refresh_id`).

`PhotoOption` (`lib/photo-options/types.ts`): `url`, `pageUrl`, `source`, `width`, `height`,
`contentType`, `reason`, and the optional `background`, `composite`, `view`, `productBox`,
`manufacturer`. Read back leniently: a malformed entry is dropped.

Not carried by the Notion mirror (the cover it already carries changes through the normal photo
path).

## 5. UI

The Photos section gains, under the photo list, "Wrong machine, a busy background or a shop's
photo? Find better pictures and pick one." and **Find photo options**. Opened, it shows a note box
and the button; while the search runs, "Looking for photos…" and a poll every 4 s. Ready: a grid of
up to six tiles, best first, each with its picture (loaded from its host by the admin's browser, no
referrer), tags (Manufacturer, Plain background, Banner, Back view, Detail, Side view, Current
cover), the ranking's reason and "From host". Selecting one shows **Remove the background**,
**Replace the current cover** (when there is one) and **Use as cover**. **Find more options** asks
again.

## 8. Security

- Only URLs a search recorded are ever downloaded on a pick; the browser cannot name one.
- Every fetch goes through `guardedFetch` (resolved addresses checked, redirects re-checked, size and
  time caps). Candidate pictures are displayed from their own hosts and never proxied.
- The note is cleaned like a reviewer note (one line, no angle brackets or backticks) and fenced in
  the prompt; the ranking's prompt already treats images as untrusted.
- `get_photo_options` output is fenced and taints the turn.
- `tools.edit` on every surface; the search spends the research allowance and is never on MCP.

## 10. Testing

- `photo-options/candidates.test.ts`: the brand guess, exclusion of shown pictures, the stored shape.
- `data/photo-searches.test.ts` (PGlite): one running search per tool, a stale one closed, the
  allowance charged and refused at the limit, finish only while searching, shown URLs.
- `inventory/photo-edits` cover test (PGlite): the new photo first, the old cover released or kept.
- `PhotoOptions.test.tsx`: tiles, tags, pick sends the choice, find shows the running state.
- The parity guard, the drift check and the message tests cover the two new actions.

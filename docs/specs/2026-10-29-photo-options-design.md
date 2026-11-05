# Photo Options — Design Spec

**Date:** 2026-10-29
**Status:** Implemented
**Target:** the app (repository root)
**Branch:** `claude/project-thread-l4us7p`

> Written by AI after the owner's request (2026-10-29): "there are a bunch of tools that have bad
> photos — either they're the wrong photo or they have a background or they're like a retail store
> versus the original marketing. There should be a way to be like, give me photo options."

## 1. Summary

**Find photo options** in the tool editor's Photos section searches the web for better cover
pictures of one catalogue tool, the manufacturer's own clean product shots first, and shows up to
six as tiles. The admin picks one and presses **Use as cover**: the picture is downloaded, its
background removed (intake's deterministic cutout, never a generative redraw), and it becomes the
cover, replacing the old one unless they untick that.

It reuses research's image stage (Exa search, probe, vision ranking, cutout), the approval image
path's guarded download and the editor's photo write. Not in scope: batch search, an automatic
photo-quality audit, the assistant and MCP.

## 2. The search (`photos.find_options`)

`lib/photo-options/request.ts` writes a `searching` row and charges **one item of the caller's
daily research allowance** in one transaction, under the per-person lock Research and Find a
different image use (`data/photo-searches.ts`). One search runs per tool; a row `searching` for over
ten minutes is closed as failed first. Then `src/workflows/photo-options.ts` →
`research/photo-options-steps.ts`:

1. The tool's own web-page resources (at most four, the brand's product page first) are read
   through the SSRF-guarded reader for the pictures they declare.
2. One Exa search (`searchProductPictures`), told `PHOTO_PREFERENCE` (the maker's official photo on
   a plain background; no retailer, shop or showroom photos, no other models) plus the admin's note.
3. Pictures the tool's last three searches offered, and its current photos' source URLs, are left
   out, so **Find more options** finds others.
4. Probe and rank exactly as research does (`rankCandidates`, `maxShown` 6), the maker's own
   pictures first in each tier.
5. The options are written to the row while it is still `searching`. Nothing is downloaded.

`brandFromLinks` takes the name's first word (or two) as the brand only when one of the tool's own
resource links is on a host that carries it, so a generic name never makes a retailer the maker.

## 3. The pick (`photos.use_option`)

`lib/photo-options/pick.ts`: the URL must be one the search recorded, exactly. It is downloaded
through `storeResearchImage` (guarded fetch, JPEG/PNG/WebP, stored public with its source URL) and,
with **Remove the background** on (the default), cleaned with `cleanPickedImage` from the ranking's
hints. `setCoverPhoto` (`inventory/photo-edits.ts`) then puts it first and, with **Replace the
current cover** on (the default), releases the old cover in the same transaction, at the panel's
revision. A failed download is `photo_unavailable`, with nothing written.

Both actions are registered (`assistant: "never"`) and run by one-line server actions in
`app/admin/inventory/photo-option-actions.ts`; `loadPhotoOptions` is the editor's poll, a read.

## 4. Data model

Migration `0036_photo_options`: `tool_photo_searches` with `id`, `tool_id` (cascade), `status`
(`searching` | `ready` | `failed`), `note`, `options` (jsonb `PhotoOption[]`), `error`,
`requested_by`, `chosen_url`, `chosen_by`, `chosen_at` and timestamps. A partial unique index allows
one `searching` row per tool. The allowance is the existing `research_requests` ledger.

## 5. UI

Under the photo list: "Wrong machine, a busy background or a shop's photo? Find better pictures and
pick one." and **Find photo options**. Opened, it shows a note box and the button. While the search
runs it shows "Looking for photos…" and polls every 4 s. When ready it shows up to six tiles, best
first, each with tags (Manufacturer, Plain background, Banner, Back view, Detail, Side view,
Current cover), the ranking's reason and its host. Selecting one shows the two checkboxes and
**Use as cover**.

## 6. Security

- Only URLs a search recorded are downloaded on a pick; the browser cannot name one.
- Every fetch goes through `guardedFetch`. Candidate pictures are shown from their own hosts with no
  referrer, never proxied.
- The note is cleaned like a reviewer note and fenced in the prompt.
- `tools.edit` everywhere; the search spends the research allowance.

## 7. Testing

- `photo-options/candidates.test.ts`: the brand guess, exclusion of shown pictures, the stored shape.
- `data/photo-searches.test.ts` (PGlite): one running search per tool, stale runs closed, the
  allowance charged and refused at the limit, shown URLs.
- `research/photo-options-steps.test.ts`: the step end to end with stubbed models, and the pick.
- `inventory/photo-edits` cover test: the new photo first, the old cover released or kept.
- `PhotoOptions.test.tsx`: tiles, tags, pick, the running state.

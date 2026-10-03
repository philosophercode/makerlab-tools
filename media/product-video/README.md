# MakerLAB AI — 60-second product video

A self-contained package (its own `package.json`; the app's lint, typecheck,
tests and build ignore `media/`) that records real flows of the app with
Playwright and edits them with [Remotion](https://www.remotion.dev) into:

- `out/makerlab-ai-60s-16x9.mp4` — 1920×1080, for `/product` ("See it in under a minute")
- `out/makerlab-ai-60s-9x16.mp4` — 1080×1920, a vertical cut
- `out/makerlab-ai-60s-poster.png` — poster frame (16:9)

Renders are git-ignored (`out/`); re-render them with `npm run render`.

Everything on screen is the real app, recorded against a local dev server.
The edit adds only framing (browser window, phone, wall screen), the drawn
pointer and taps (headless Chrome has no cursor; positions come from the
script's own clicks), focus rings, speed badges (`▶▶ 4×`), a labelled time
skip where research ran, captions and the end card.

```
capture/     Playwright: scenes.ts takes → public/footage/<clip>.mp4 + .json
public/      footage, brand fonts (SIL OFL, licences beside them) and wordmark
src/         Remotion: edit.ts (the cut), script.ts (voiceover/captions), components
scripts/     timing.ts (cut vs. script), voiceover-md.ts (writes VOICEOVER.md)
```

```bash
cd media/product-video
npm install
npx playwright install chromium   # once, if the browser is missing
```

## 1. Re-record footage

Footage must come from a **local** dev server, never production: anonymous
questions on the live site count in the lab's usage insight.

1. In the repo root, with `.env.local` in place (it needs `DEV_AUTO_SIGN_IN=1`
   and AI Gateway auth — `AI_GATEWAY_API_KEY`, or a fresh `VERCEL_OIDC_TOKEN`
   from `vercel env pull`; the OIDC token expires after ~12 h):

   ```bash
   RATE_LIMIT_ANON_CHAT=100 PGLITE_DATA_DIR=$PWD/.pglite-data \
     AUTH_BASE_URL=http://localhost:3923 npx next dev -p 3923
   ```

   PGlite allows one process: stop any other dev server on the same data dir.
   `RATE_LIMIT_ANON_CHAT` lifts the anonymous allowance (8/hour), which retakes
   exhaust.

2. Record: `npm run capture` (every take) or `npm run capture -- phone plan`.
   Takes: `hook-qr`, `phone` (→ `phone-ask` + `phone-report`), `staff-queue`,
   `plan`, `intake-add`, `intake-approve`, `kiosk`, `mcp`. Questions are in
   `capture/scenes.ts` (`QUESTIONS`).

   Frames are captured at 2× through Chrome's screencast
   (`--force-device-scale-factor=2`; without it headless frames are 1×), so
   zooms stay sharp.

**Takes write to the local database.** `phone` files a real maintenance
ticket; the assistant will not file a duplicate while an earlier one is open,
so close the previous take's ticket on `/admin/maintenance` before a retake.
`intake-add` spends one research credit (≈$0.03) and queues a pending item;
research runs in the background (≈4 minutes locally); wait for it to be
"Ready for review" before `intake-approve`, which approves it **as a draft**
(set `INTAKE_APPROVE=publish` to press Approve). `INTAKE_ITEM` / `INTAKE_NAME`
change the item. Anything these takes create is pushed to the hosted database
by `npm run data:push`, so clean it up first.

Answers differ from take to take. After re-recording, check each clip and
retune the cut: `npm run timing` and the clip's `public/footage/<clip>.json`
(clicks and named marks with their boxes).

## 2. Edit

`npm run studio` opens Remotion Studio. The cut lives in `src/edit.ts`:

- **segments** — `[from, to)` in the clip's own seconds, each at a `rate`
  (speed ramps; ≥2× shows a speed badge).
- **camera** — from source time `at`, glide over `dur` to scale `s` centred
  on page point `(x, y)` (CSS px of the recorded viewport). `s: 1` is the
  plain framing. The vertical cut adapts scales in `src/layout.ts` (`zoomFor`).
- **highlights** — focus rings around a timeline mark or a literal box.

`npm run timing` prints every scene and shot against the script's windows.

## 3. Voiceover and music

The script, with timestamps, is `VOICEOVER.md` (generated from
`src/script.ts`; captions are drawn from the same text). To add sound:

- Record one take, save as `public/voiceover.mp3` (starting at 0:00), re-render.
  Nudge it with `AUDIO.voiceover.offsetSeconds` in `src/audio.tsx`.
- Optional music: `public/music.mp3` is looped, faded, and ducked under the
  voice. **Only a track whose licence allows this use**, and record the
  licence here under "Music". None is included.

Missing files are skipped, so the render works without either.

### Music

None yet.

## 4. Render

```bash
npm run render          # both cuts + poster into out/
npm run render:16x9     # or one at a time
```

H.264 at CRF 26 (slow preset) keeps each cut around 12 MB. Change the poster
frame in `package.json` (`render:poster`, `--frame`).

## 5. Put it on the product page (not done yet)

The page embeds `public/product/walkthrough.{mp4,webm}`, its poster and
captions through `WALKTHROUGH` in `src/app/product/product-content.ts`
(`WalkthroughVideo.tsx`). To swap:

1. Copy the 16:9 render to `public/product/walkthrough.mp4` and make a WebM:
   `ffmpeg -i out/makerlab-ai-60s-16x9.mp4 -c:v libvpx-vp9 -crf 36 -b:v 0 -row-mt 1 public/product/walkthrough.webm`
2. Poster: `cwebp -q 82 -resize 1280 0 out/makerlab-ai-60s-poster.png -o public/product/walkthrough-poster.webp`
3. Update `WALKTHROUGH.width/height` to 1920×1080, the 49-second wording
   (`WalkthroughVideo.tsx`'s comment, the `product.transcript.*` messages in
   all 12 locales), and `walkthrough.en.vtt` from `VOICEOVER.md`'s windows.
   The captions are burned in, so the VTT track is for screen readers and
   search — keep it, or drop `default` from the `<track>`.
4. Run `npm run test:all` (`e2e/product.spec.ts` checks the video).

## Licences

- Remotion is free for individuals, non-profits and companies of up to three
  people; check <https://www.remotion.dev/license> applies to the MakerLAB
  (Cornell, a non-profit) before wider use.
- Space Grotesk, Inter, JetBrains Mono: SIL Open Font License (files in `public/fonts/`).

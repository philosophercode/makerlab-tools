# MakerLAB AI — 60-second product video

A self-contained package (its own `package.json`; the app's lint, typecheck,
tests and build ignore `media/`) that records real flows of the app with
Playwright and edits them with [Remotion](https://www.remotion.dev) into:

- `out/makerlab-ai-60s-16x9-vo.mp4` — 1920×1080 with **AI narration** and
  closed captions (soft English subtitle track, off by default), for `/product`
- `out/makerlab-ai-60s-16x9.en.vtt` — the same captions as WebVTT, timed to the voice
- `out/makerlab-ai-60s-16x9.mp4` — 1920×1080, silent, captions burned in
- `out/makerlab-ai-60s-9x16.mp4` — 1080×1920 vertical cut, silent, captions burned in
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
public/vo/   the AI narration, one WAV per script line, + durations.json
src/         Remotion: edit.ts (the cut), script.ts (narration text), narration.ts/cues.ts
             (when each line plays), components
scripts/     tts.ts (Gemini TTS), captions-vtt.ts, mux-captions.ts, timing.ts, voiceover-md.ts
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

## 3. Narration, captions and music

**The narration is AI-generated** with Google Gemini text-to-speech:
model `gemini-2.5-pro-preview-tts`, prebuilt voice **Sulafat**, directed as
"warmly and clearly, like a friendly, confident product-video narrator, at a
calm, unhurried pace". One clip per line of `src/script.ts`, silence-trimmed
and normalised to about −16 LUFS (`scripts/tts.ts`); the mixed cut measures
−16.4 LUFS integrated. Each line starts a beat after its scene
(`src/cues.ts`); `npm run timing` warns if one runs past its cut.

```bash
npm run tts -- samples            # the first line in 3 voices → out/voice-samples/
npm run tts -- full               # every line → public/vo/ (default voice Sulafat)
npm run tts -- full --voice Kore  # another voice; TTS_MODEL=… for another model
npm run voiceover:md              # refresh VOICEOVER.md with the new timings
```

`GEMINI_API_KEY` comes from the environment or the repo root's `.env.local`
(`GEMINI_ENV_FILE` points elsewhere); it is never printed.
`scripts/listen.ts` and `scripts/compare-voices.ts` have a Gemini model
transcribe a clip or rank samples. That check is useful but rough, and it
does not replace listening. Cost: the samples, the full read and those checks
came to well under $1 of Gemini usage.

Voice choice: Sulafat, Achird and Iapetus read the first line on
`gemini-2.5-pro-preview-tts`; Sulafat ranked first for warmth and
naturalness in both orderings of a blind comparison. The newer
`gemini-3.8-flash-tts` was tried first. It read the delivery directions
aloud (as a prefix, and once as "Okay, and rolling") and refuses a system
instruction, so the 2.5 Pro model is used. `out/voice-samples/` keeps every
candidate.

**Closed captions (16:9 narrated cut).** No words are burned in. Captions are
a WebVTT file timed to the clips (`npm run captions`), muxed into the MP4 as
a `mov_text` track (language `eng`, off by default; `scripts/mp4-captions-off.ts`
clears the "enabled" flag ffmpeg always sets). The 9:16 and the silent 16:9
keep burned-in captions, now timed by the same cues.

**A human voice instead:** record each line to fit its slot in
`VOICEOVER.md`, save over `public/vo/<id>.wav`, update `durations.json`, and
re-render. (`public/voiceover.mp3`, one continuous take from 0:00, also still
works through `src/audio.tsx`, for the silent cuts.)

**Music:** an optional `public/music.mp3` is looped, faded and ducked under
the voice. **Use only a track whose licence allows this use**, and record the
licence below. None is included.

### Music

None yet.

## 4. Render

```bash
npm run render          # every cut + poster into out/
npm run render:16x9-vo  # narrated 16:9: render, captions VTT, mux
npm run render:16x9     # silent 16:9 with burned-in captions
```

H.264 at CRF 26 (slow preset) keeps each cut around 12 MB. Change the poster
frame in `package.json` (`render:poster`, `--frame`).

## 5. Put it on the product page (not done yet)

The page embeds `public/product/walkthrough.{mp4,webm}`, its poster and
captions through `WALKTHROUGH` in `src/app/product/product-content.ts`
(`WalkthroughVideo.tsx`). To swap:

1. Copy the narrated render to `public/product/walkthrough.mp4` and make a WebM:
   `ffmpeg -i out/makerlab-ai-60s-16x9-vo.mp4 -map 0:v -map 0:a -c:v libvpx-vp9 -crf 36 -b:v 0 -row-mt 1 -c:a libopus public/product/walkthrough.webm`
2. Poster: `cwebp -q 82 -resize 1280 0 out/makerlab-ai-60s-poster.png -o public/product/walkthrough-poster.webp`
3. Update `WALKTHROUGH.width/height` to 1920×1080, the 49-second wording
   (`WalkthroughVideo.tsx`'s comment, the `product.transcript.*` messages in
   all 12 locales), and replace `walkthrough.en.vtt` with
   `out/makerlab-ai-60s-16x9.en.vtt`. The player's `<track>` is `default`
   (captions on); with a voice now, consider removing `default`. The page
   currently describes a silent video: say it has narration.
4. Run `npm run test:all` (`e2e/product.spec.ts` checks the video).

## Licences

- Remotion is free for individuals, non-profits and companies of up to three
  people; check <https://www.remotion.dev/license> applies to the MakerLAB
  (Cornell, a non-profit) before wider use.
- Space Grotesk, Inter, JetBrains Mono: SIL Open Font License (files in `public/fonts/`).

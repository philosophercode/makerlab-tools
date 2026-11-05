# MakerLAB AI — 60-second voiceover

Generated from `src/script.ts` and the narration timing by `npm run voiceover:md`; edit the script there, not here.

**The narration is AI-generated** (text-to-speech): Google Gemini `gemini-2.5-pro-preview-tts`, voice **Sulafat**,
made with `npm run tts` (`scripts/tts.ts`). It is in the 16:9 cut `out/makerlab-ai-60s-16x9-vo.mp4`;
the words are closed captions there (`out/makerlab-ai-60s-16x9.en.vtt`, also a soft subtitle track in the MP4).

110 words. Times below are where each line plays — scene start plus a beat, for the clip's real length.
To replace the AI voice with a person, record each line to fit its slot, save the clips over
`public/vo/<id>.wav`, update their lengths in `public/vo/durations.json`, then re-render and rerun `npm run captions`.

| Line | Plays | Text |
|---|---|---|
| hook | 0:00.1 – 0:06.9 | Every makerspace runs on knowledge that's scattered: manuals, rules, who fixed what. |
| operate | 0:07.2 – 0:15.4 | MakerLAB AI knows every machine in the lab. Scan one, ask, and it answers from the manual, down to the page. |
| debug | 0:17.4 – 0:22.9 | When something breaks, it files the ticket for you, and staff see it in their queue. |
| create | 0:25.6 – 0:32.3 | Planning a project? It maps your build across the lab's own machines and flags the training you need. |
| staff | 0:34.9 – 0:43.7 | For staff, a name or a photo becomes a complete record, manuals included, and nothing goes live until you approve it. |
| screen | 0:46.8 – 0:51.6 | The lab screen shows what's up, and you can even use it from your own AI. |
| end | 0:54.3 – 0:59.1 | MakerLAB AI. Operate, fix and build. |

## Changes from the brief

- **debug** — Changed from "staff get the alert": email alerts are not built yet; the footage shows the queue.
- **staff** — Changed from "a photo becomes a complete record with manuals in about a minute": the take adds a tool by name, and research took about four minutes locally (shown as a time skip).

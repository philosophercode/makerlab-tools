// `npm run voiceover:md` — writes VOICEOVER.md from src/script.ts and the
// narration cues (public/vo/durations.json).
import { writeFileSync } from "node:fs";
import { SCRIPT } from "../src/script.ts";
import { narration } from "./cues-node.ts";

const fmt = (s: number) => `0:${s.toFixed(1).padStart(4, "0")}`;
const { model, voice, cues } = narration();
const words = SCRIPT.reduce((n, l) => n + l.text.split(/\s+/).length, 0);
const out = [
  "# MakerLAB AI — 60-second voiceover",
  "",
  "Generated from `src/script.ts` and the narration timing by `npm run voiceover:md`; edit the script there, not here.",
  "",
  `**The narration is AI-generated** (text-to-speech): Google Gemini \`${model}\`, voice **${voice}**,`,
  "made with `npm run tts` (`scripts/tts.ts`). It is in the 16:9 cut `out/makerlab-ai-60s-16x9-vo.mp4`;",
  "the words are closed captions there (`out/makerlab-ai-60s-16x9.en.vtt`, also a soft subtitle track in the MP4).",
  "",
  `${words} words. Times below are where each line plays — scene start plus a beat, for the clip's real length.`,
  "To replace the AI voice with a person, record each line to fit its slot, save the clips over",
  "`public/vo/<id>.wav`, update their lengths in `public/vo/durations.json`, then re-render and rerun `npm run captions`.",
  "",
  "| Line | Plays | Text |",
  "|---|---|---|",
  ...cues.map((c) => `| ${c.id} | ${fmt(c.start)} – ${fmt(c.end)} | ${c.text} |`),
  "",
  "## Changes from the brief",
  "",
  ...SCRIPT.filter((l) => l.note).map((l) => `- **${l.id}** — ${l.note}`),
  "",
];
writeFileSync(new URL("../VOICEOVER.md", import.meta.url), out.join("\n"));
console.log("wrote VOICEOVER.md");

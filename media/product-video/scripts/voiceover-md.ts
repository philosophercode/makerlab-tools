// `npm run voiceover:md` — writes VOICEOVER.md from src/script.ts.
import { writeFileSync } from "node:fs";
import { SCRIPT } from "../src/script.ts";

const fmt = (s: number) => `0:${s.toFixed(1).padStart(4, "0")}`;
const words = SCRIPT.reduce((n, l) => n + l.text.split(/\s+/).length, 0);
const out = [
  "# MakerLAB AI — 60-second voiceover",
  "",
  "Generated from `src/script.ts` by `npm run voiceover:md`; edit the script there, not here.",
  "",
  `${words} words in 60 seconds, an unhurried pace. Record one take as`,
  "`public/voiceover.mp3` starting at 0:00; each line should land inside its window.",
  "The captions burned into the video are this text, so read it as written or update the script.",
  "",
  "| Window | Line |",
  "|---|---|",
  ...SCRIPT.map((l) => `| ${fmt(l.start)} – ${fmt(l.end)} | ${l.text} |`),
  "",
  "## Changes from the brief",
  "",
  ...SCRIPT.filter((l) => l.note).map((l) => `- **${l.id}** — ${l.note}`),
  "",
];
writeFileSync(new URL("../VOICEOVER.md", import.meta.url), out.join("\n"));
console.log("wrote VOICEOVER.md");

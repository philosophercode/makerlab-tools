// `npm run captions` — WebVTT closed captions for the narrated 16:9 cut, timed
// to the actual voice clips → out/makerlab-ai-60s-16x9.en.vtt. Long lines are
// split at sentence or clause breaks into cues of at most ~42 characters a row.
import { mkdirSync, writeFileSync } from "node:fs";
import { narration } from "./cues-node.ts";

const OUT = new URL("../out/makerlab-ai-60s-16x9.en.vtt", import.meta.url).pathname;
const ts = (s: number) => {
  const ms = Math.round(s * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const sec = Math.floor((ms % 60_000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
};

/** Split a line into caption chunks (≤ 2 rows of ~42 chars), at sentence breaks first. */
function chunks(text: string): string[] {
  const sentences = text.match(/[^.?!]+[.?!]+/g)?.map((s) => s.trim()) ?? [text];
  const out: string[] = [];
  for (const s of sentences) {
    if (s.length <= 84) out.push(s);
    else {
      const i = s.lastIndexOf(", ", Math.ceil(s.length / 2) + 10);
      out.push(s.slice(0, i + 1), s.slice(i + 2));
    }
  }
  return out;
}

/** Wrap to rows of ~42 characters. */
const wrap = (s: string) => {
  if (s.length <= 42) return s;
  const words = s.split(" ");
  let a = "";
  while (words.length && (a + " " + words[0]).trim().length <= Math.ceil(s.length / 2) + 4) a = (a + " " + words.shift()).trim();
  return `${a}\n${words.join(" ")}`;
};

const lines = ["WEBVTT", ""];
let n = 1;
for (const cue of narration().cues) {
  const parts = chunks(cue.text);
  const total = parts.reduce((k, p) => k + p.length, 0);
  let t = cue.start;
  for (const p of parts) {
    const end = t + ((cue.end - cue.start) * p.length) / total;
    lines.push(String(n++), `${ts(t)} --> ${ts(end)}`, wrap(p), "");
    t = end;
  }
}
mkdirSync(new URL("../out/", import.meta.url).pathname, { recursive: true });
writeFileSync(OUT, lines.join("\n"));
console.log(`wrote ${OUT}`);

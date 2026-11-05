// `npm run timing` — scene and shot boundaries on the final timeline beside the
// narration cues, so a re-cut can be checked against the voice: a line should
// end before its scene does.
import { END_CARD_SECONDS, SCENES, shotSeconds } from "../src/edit.ts";
import { narration } from "./cues-node.ts";

const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, "0")}`;
const { cues } = narration();
let t = 0;
for (const scene of SCENES) {
  const start = t;
  const shots = scene.shots.map((shot) => {
    const a = t;
    t += shotSeconds(shot);
    return `    ${shot.clip.padEnd(15)} ${fmt(a)} → ${fmt(t)}  (${shotSeconds(shot).toFixed(2)} s)`;
  });
  const c = cues.find((x) => x.id === scene.id);
  const warn = c && c.end > t + 0.2 ? "  ⚠ line runs past the cut" : "";
  console.log(`${scene.id.padEnd(8)} ${fmt(start)} → ${fmt(t)}   VO ${c ? `${fmt(c.start)} → ${fmt(c.end)}` : "-"}${warn}`);
  console.log(shots.join("\n"));
}
const end = cues.find((x) => x.id === "end");
console.log(`end card ${fmt(t)} → ${fmt(t + END_CARD_SECONDS)}   VO ${end ? `${fmt(end.start)} → ${fmt(end.end)}` : "-"}`);
console.log(`total ${(t + END_CARD_SECONDS).toFixed(2)} s`);

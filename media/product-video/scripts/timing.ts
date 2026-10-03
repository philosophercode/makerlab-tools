// `npm run timing` — scene and shot boundaries on the final timeline, beside the
// script's line windows, so a re-cut can be checked against the voiceover.
import { END_CARD_SECONDS, SCENES, shotSeconds } from "../src/edit.ts";
import { SCRIPT } from "../src/script.ts";

const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, "0")}`;
let t = 0;
for (const scene of SCENES) {
  const start = t;
  const shots = scene.shots.map((shot) => {
    const a = t;
    t += shotSeconds(shot);
    return `    ${shot.clip.padEnd(15)} ${fmt(a)} → ${fmt(t)}  (${shotSeconds(shot).toFixed(2)} s)`;
  });
  const line = SCRIPT.find((l) => l.id === scene.id);
  console.log(`${scene.id.padEnd(8)} ${fmt(start)} → ${fmt(t)}   VO ${line ? `${fmt(line.start)} → ${fmt(line.end)}` : "-"}`);
  console.log(shots.join("\n"));
}
console.log(`end card ${fmt(t)} → ${fmt(t + END_CARD_SECONDS)}`);
console.log(`total ${(t + END_CARD_SECONDS).toFixed(2)} s`);

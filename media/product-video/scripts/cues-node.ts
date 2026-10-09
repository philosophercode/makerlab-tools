// The narration cues under plain Node (the composition reads them through src/narration.ts).
import { existsSync, readFileSync } from "node:fs";
import { buildCues, type Cue } from "../src/cues.ts";
import { SCENES, sceneSeconds } from "../src/edit.ts";
import { SCRIPT } from "../src/script.ts";

export const VO_FILE = new URL("../public/vo/durations.json", import.meta.url).pathname;

export function narration(): { model: string; voice: string; cues: Cue[] } {
  if (!existsSync(VO_FILE)) throw new Error("no public/vo/durations.json: run `npm run tts` first");
  const vo = JSON.parse(readFileSync(VO_FILE, "utf8")) as { model: string; voice: string; durations: Record<string, number> };
  return { model: vo.model, voice: vo.voice, cues: buildCues(SCENES, sceneSeconds, SCRIPT, vo.durations) };
}

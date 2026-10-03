import vo from "../public/vo/durations.json";
import { buildCues, type Cue } from "./cues";
import { SCENES, sceneSeconds } from "./edit";
import { SCRIPT } from "./script";

/**
 * The AI narration (scripts/tts.ts → public/vo/<line>.wav, durations.json).
 * The same cues time the burned-in captions (9:16) and the closed captions
 * (scripts/captions-vtt.ts, 16:9), so text always matches the voice.
 */
export const NARRATION = { model: vo.model, voice: vo.voice };

let cached: Cue[] | null = null;
export function cues(): Cue[] {
  cached ??= buildCues(SCENES, sceneSeconds, SCRIPT, vo.durations as Record<string, number>);
  return cached;
}

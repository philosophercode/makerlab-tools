import type { Scene } from "./edit";
import type { ScriptLine } from "./script";

/**
 * When each narration line plays: a beat after its scene starts, for as long
 * as its recorded clip lasts. Pure, so the composition (src/narration.ts) and
 * the Node scripts (VTT, VOICEOVER.md) share it.
 */
export type Cue = { id: string; text: string; start: number; end: number; file: string };

/** Seconds of quiet between a cut and its line. */
const LEAD: Record<string, number> = { hook: 0.15, end: 0.45 };

export function buildCues(
  scenes: Scene[],
  sceneSeconds: (s: Scene) => number,
  script: ScriptLine[],
  durations: Record<string, number>
): Cue[] {
  const starts: Record<string, number> = {};
  let t = 0;
  for (const s of scenes) {
    starts[s.id] = t;
    t += sceneSeconds(s);
  }
  starts.end = t;
  return script.map((line) => {
    const start = starts[line.id] + (LEAD[line.id] ?? 0.3);
    const length = durations[line.id];
    if (start === undefined || Number.isNaN(start) || length === undefined) throw new Error(`no timing for line "${line.id}"`);
    return { id: line.id, text: line.text, start, end: start + length, file: `vo/${line.id}.wav` };
  });
}

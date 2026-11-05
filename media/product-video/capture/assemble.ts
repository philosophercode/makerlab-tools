import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Timeline } from "./recorder.ts";

/**
 * Turns a screencast's variable-rate frames into a constant 30 fps H.264 file
 * whose clock matches the timeline: frame i is held until frame i+1 arrived,
 * and the first frame is shown from t = 0.
 */
export async function assemble(
  rec: Timeline & { frames: { t: number; file: string }[] },
  rawDir: string,
  outDir: string
): Promise<string> {
  const frames = rec.frames.filter((f) => f.t >= 0 || rec.frames.length === 1);
  if (!frames.length) throw new Error(`${rec.clip}: no frames recorded`);
  const lines = ["ffconcat version 1.0"];
  for (let i = 0; i < frames.length; i++) {
    const until = i + 1 < frames.length ? frames[i + 1].t : rec.duration;
    const from = i === 0 ? 0 : frames[i].t;
    lines.push(`file '${frames[i].file}'`, `duration ${Math.max(0.001, until - from).toFixed(4)}`);
  }
  // concat's last entry needs repeating for its duration to count.
  lines.push(`file '${frames[frames.length - 1].file}'`);
  const list = join(rawDir, "frames.ffconcat");
  await writeFile(list, lines.join("\n"));
  const out = join(outDir, `${rec.clip}.mp4`);
  await run("ffmpeg", [
    "-y", "-loglevel", "error",
    "-f", "concat", "-safe", "0", "-i", list,
    "-vf", "fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
    "-c:v", "libx264", "-preset", "medium", "-crf", "16",
    "-movflags", "+faststart",
    out,
  ]);
  const { frames: _frames, ...timeline } = rec;
  await writeFile(join(outDir, `${rec.clip}.json`), JSON.stringify(timeline, null, 2));
  return out;
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit" });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

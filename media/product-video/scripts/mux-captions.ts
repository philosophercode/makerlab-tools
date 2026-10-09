// `npm run mux` — out/.render-16x9-vo.mp4 (Remotion's narrated render)
// + out/makerlab-ai-60s-16x9.en.vtt → out/makerlab-ai-60s-16x9-vo.mp4 with a
// soft English subtitle track (mov_text), off by default.
import { execFileSync } from "node:child_process";

const out = (f: string) => new URL(`../out/${f}`, import.meta.url).pathname;
execFileSync(
  "ffmpeg",
  [
    "-y", "-loglevel", "error",
    "-i", out(".render-16x9-vo.mp4"),
    "-i", out("makerlab-ai-60s-16x9.en.vtt"),
    "-map", "0:v", "-map", "0:a", "-map", "1:0",
    "-c:v", "copy", "-c:a", "copy", "-c:s", "mov_text",
    "-metadata:s:a:0", "language=eng",
    "-metadata:s:s:0", "language=eng",
    "-metadata:s:s:0", "handler_name=English",
    "-disposition:s:0", "0",
    "-movflags", "+faststart",
    out("makerlab-ai-60s-16x9-vo.mp4"),
  ],
  { stdio: "inherit" }
);
execFileSync("node", ["--experimental-strip-types", new URL("./mp4-captions-off.ts", import.meta.url).pathname, out("makerlab-ai-60s-16x9-vo.mp4")], {
  stdio: "inherit",
});
console.log(`wrote ${out("makerlab-ai-60s-16x9-vo.mp4")}`);

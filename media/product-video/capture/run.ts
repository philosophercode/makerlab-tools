import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { assemble } from "./assemble.ts";
import { Recorder } from "./recorder.ts";
import { TAKES } from "./scenes.ts";

/**
 * `npm run capture -- <take> [<take> …]` (or no arguments for every take).
 * Raw frames go to footage-raw/<clip>/ (git-ignored); the assembled clip and
 * its timeline go to public/footage/<clip>.mp4 + .json for the composition.
 */
const root = new URL("..", import.meta.url).pathname;
const RAW = join(root, "footage-raw");
const OUT = join(root, "public", "footage");

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(TAKES);
await mkdir(OUT, { recursive: true });
// Without the flag, headless screencast frames arrive at CSS-pixel size even
// with deviceScaleFactor 2; with it they are 2x, so zooms stay crisp.
const browser = await chromium.launch({ args: ["--force-device-scale-factor=2"] });
try {
  for (const name of names) {
    const take = TAKES[name];
    if (!take) throw new Error(`unknown take "${name}" (have: ${Object.keys(TAKES).join(", ")})`);
    console.log(`▶ ${name}`);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await take(
      browser,
      (page: Page, clip: string, touch?: boolean) => new Recorder(page, clip, join(RAW, `${clip}-${stamp}`), { touch }),
      async (rec) => {
        const result = await rec.end();
        const file = await assemble(result, join(RAW, `${rec.clip}-${stamp}`), OUT);
        console.log(`  ✓ ${rec.clip}: ${result.duration.toFixed(1)} s, ${result.frames.length} frames → ${file}`);
      }
    );
  }
} finally {
  await browser.close();
}

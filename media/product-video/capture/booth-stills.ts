import { chromium } from "playwright";

/** Fresh 1920x1080 light-mode stills of the live site for the booth loop -> public/booth/. */
const BASE = "https://www.makerlabai.app";
const OUT = new URL("../public/booth/", import.meta.url).pathname;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: "light", deviceScaleFactor: 1 });
const page = await ctx.newPage();
const shot = async (name: string, path: string, wait = 2500) => {
  await page.goto(BASE + path, { waitUntil: "load" });
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${OUT}${name}.png` });
  console.log("ok", name);
};
await shot("home", "/");
await shot("tool", "/tools/bambu-lab-x1-carbon-combo-3d-printer");
await shot("map", "/map", 4000);
await shot("about", "/about", 4000);
await shot("demo", "/demo");
// Chat answer still intentionally not captured against the live site (anonymous questions count in lab usage insight).
await browser.close();

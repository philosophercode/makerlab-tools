/**
 * Draw `lab/floor-plan.json` over the image it was traced from (lab config
 * spec 2026-10-25 §5.2), so a person checks the trace by eye before
 * committing it.
 *
 *   npm run lab:map-preview -- --image plan.png
 *   npm run lab:map-preview -- --image plan.png --image-width 2000
 *
 * Writes `lab/.preview.html` (git-ignored): the image, with the plan's
 * outline, walls, zones and station marks on top at half opacity. Open it in
 * a browser. The image is placed at the plan's origin; `--image-width` is its
 * width in the plan's units, when the trace used the image scaled (the shipped
 * plan is traced at 2000 wide). Without it, one plan unit is one image pixel.
 * The image is embedded, so the page works on its own; nothing leaves the
 * machine.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { floorPlanIssues, floorPlanSchema, toFloorPlan } from "../src/lib/map/schema.ts";
import type { FloorPlan, MapPoint } from "../src/lib/map/types.ts";

const PLAN_PATH = fileURLToPath(new URL("../lab/floor-plan.json", import.meta.url));
const OUT_PATH = fileURLToPath(new URL("../lab/.preview.html", import.meta.url));

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

export function parsePreviewArgs(argv: readonly string[]): { image: string; imageWidth: number | null } {
  let image: string | null = null;
  let imageWidth: number | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--image") image = argv[++i] ?? null;
    else if (arg === "--image-width") {
      imageWidth = Number(argv[++i]);
      if (!Number.isFinite(imageWidth) || imageWidth <= 0) throw new Error("--image-width takes a positive number.");
    } else throw new Error(`Unknown argument: ${arg}. Usage: npm run lab:map-preview -- --image plan.png [--image-width 2000]`);
  }
  if (!image) throw new Error("Give the plan image: npm run lab:map-preview -- --image plan.png");
  return { image, imageWidth };
}

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pts = (points: readonly MapPoint[]) => points.map(([x, y]) => `${x},${y}`).join(" ");

/** The page: pure, so a test can render a fixture. */
export function previewHtml(plan: FloorPlan, imageDataUrl: string, imageWidth: number | null): string {
  const { x, y, w, h } = plan.viewBox;
  const zones = plan.zones
    .map(
      (zone) =>
        `<polygon points="${pts(zone.polygon)}" class="zone"><title>${esc(`${zone.id} ${zone.room} / ${zone.zone}`)}</title></polygon>` +
        `<text x="${zone.labelAt[0]}" y="${zone.labelAt[1]}" class="zone-label">${esc(zone.number)}</text>`
    )
    .join("\n");
  const walls = plan.walls.map(([a, b]) => `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" class="wall"/>`).join("\n");
  const stations = plan.stations
    .flatMap((station) =>
      station.marks.map(
        ([mx, my]) =>
          `<circle cx="${mx}" cy="${my}" r="10" class="mark"><title>${esc(`${station.id} ${station.label}`)}</title></circle>` +
          `<text x="${mx + 14}" y="${my + 6}" class="mark-label">${esc(station.id)}</text>`
      )
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Floor plan preview: ${esc(plan.title)}</title>
<style>
  body { margin: 0; font: 14px system-ui, sans-serif; background: #fff; color: #111; }
  header { padding: 12px 16px; }
  label { margin-right: 16px; }
  svg { width: 100%; height: auto; display: block; }
  .overlay { opacity: 0.5; }
  .outline { fill: none; stroke: #000; stroke-width: 4; }
  .wall { stroke: #000; stroke-width: 3; }
  .zone { fill: #ff6b35; fill-opacity: 0.35; stroke: #c00; stroke-width: 3; }
  .zone-label { font: 700 40px system-ui, sans-serif; fill: #c00; text-anchor: middle; }
  .mark { fill: #0057ff; }
  .mark-label { font: 700 24px system-ui, sans-serif; fill: #0057ff; }
</style>
</head>
<body>
<header>
  <strong>${esc(plan.title)}</strong> · version ${esc(plan.version)} · ${plan.zones.length} zones, ${plan.stations.length} stations
  <div>
    <label><input type="checkbox" id="show-image" checked> Image</label>
    <label><input type="checkbox" id="show-plan" checked> Plan</label>
    <label>Plan opacity <input type="range" id="opacity" min="0" max="1" step="0.05" value="0.5"></label>
  </div>
</header>
<svg viewBox="${x} ${y} ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
  <image id="source" href="${imageDataUrl}" x="0" y="0" ${imageWidth ? `width="${imageWidth}"` : ""} preserveAspectRatio="xMinYMin meet"/>
  <g id="plan" class="overlay">
    <polygon points="${pts(plan.outline)}" class="outline"/>
    ${walls}
    ${zones}
    ${stations}
  </g>
</svg>
<script>
  const image = document.getElementById("source");
  const plan = document.getElementById("plan");
  ${imageWidth ? "" : `const probe = new Image();
  probe.onload = () => { image.setAttribute("width", probe.naturalWidth); image.setAttribute("height", probe.naturalHeight); };
  probe.src = image.getAttribute("href");`}
  document.getElementById("show-image").onchange = (e) => (image.style.display = e.target.checked ? "" : "none");
  document.getElementById("show-plan").onchange = (e) => (plan.style.display = e.target.checked ? "" : "none");
  document.getElementById("opacity").oninput = (e) => (plan.style.opacity = e.target.value);
</script>
</body>
</html>
`;
}

function main(): void {
  const { image, imageWidth } = parsePreviewArgs(process.argv.slice(2));
  const type = IMAGE_TYPES[extname(image).toLowerCase()];
  if (!type) throw new Error(`${image}: use a PNG, JPEG, WebP, GIF or SVG image.`);
  const raw: unknown = JSON.parse(readFileSync(PLAN_PATH, "utf8"));
  const parsed = floorPlanSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`lab/floor-plan.json does not match the schema; run npm run lab:check:\n${floorPlanIssues(raw).join("\n")}`);
  }
  const dataUrl = `data:${type};base64,${readFileSync(resolve(image)).toString("base64")}`;
  writeFileSync(OUT_PATH, previewHtml(toFloorPlan(parsed.data), dataUrl, imageWidth));
  console.log(`Wrote ${OUT_PATH}. Open it in a browser.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

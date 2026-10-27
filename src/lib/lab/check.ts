import { indexPlan, placeTool } from "../map/placement.ts";
import type { FloorPlan } from "../map/types.ts";
import type { LabConfig } from "./schema.ts";

/**
 * What `npm run lab:check` checks beyond the schemas (lab config spec
 * 2026-10-25 §5.2, amendment §12.6). Pure, so the tests run each check on a
 * fixture: the script supplies the file system and the database.
 */

/** Every `public/` path the config names: the logo, the wordmark, the photos. */
export function publicPaths(config: LabConfig): Array<{ field: string; path: string }> {
  return [
    { field: "brand.logo", path: config.brand.logo },
    { field: "brand.wordmark", path: config.brand.wordmark },
    ...config.photos.map((photo, i) => ({ field: `photos.${i}.src`, path: photo.src })),
  ];
}

/**
 * A missing file under `public/`, one line each. An SVG logo needs its PNG
 * twin beside it (`logo.svg` → `logo.png`): QR sheets and the link-preview
 * card cannot draw an SVG.
 */
export function missingPublicFiles(config: LabConfig, exists: (publicPath: string) => boolean): string[] {
  const issues = publicPaths(config)
    .filter(({ path }) => !exists(path))
    .map(({ field, path }) => `${field}: public${path} does not exist`);
  if (config.brand.logo.toLowerCase().endsWith(".svg")) {
    const png = config.brand.logo.replace(/\.svg$/i, ".png");
    if (!exists(png)) issues.push(`brand.logo: public${png} does not exist (an SVG logo needs a PNG twin for QR sheets and link previews)`);
  }
  return issues;
}

/** What the site will say, for a person to read before committing. */
export function labSummary(config: LabConfig): string[] {
  const { identity, place, access, people, assistant } = config;
  return [
    `Header:      ${identity.assistantName} (${identity.siteName})`,
    `Tagline:     ${identity.tagline}`,
    `About title: ${typeof config.about.title === "string" ? config.about.title : config.about.title.en}`,
    `Hours:       ${place.hours} (${place.timezone})`,
    `Sign-in:     anyone @${access.emailDomain}`,
    `People:      ${people.length === 0 ? "none listed" : people.map((p) => `${p.name}, ${p.title}`).join("; ")}`,
    `Assistant:   "You are ${identity.assistantName}, the AI inside ${identity.siteName}, the website for the ${identity.labName} at ${identity.institution}." then ${assistant.aboutLab.length} characters about the lab`,
    `Map:         ${config.map ? "lab/floor-plan.json" : "off"}`,
    `Product:     ${config.pages.product ? "/product shown" : "/product hidden"}`,
  ];
}

/** One location row as `lab:check --inventory` reads it. */
export interface InventoryLocation {
  room: string;
  zone: string;
  mapTag: string | null;
  /** Published or not, tools at this location. */
  tools: number;
}

/**
 * `lab:check --inventory` (spec §5.2, §12.6): which locations land nowhere on
 * the plan, each with the `matches` line that would place it, and which zones
 * no tool uses. A list instead of a guess; nothing is written.
 */
export function inventoryReport(plan: FloorPlan, locations: readonly InventoryLocation[]): string[] {
  const index = indexPlan(plan);
  const used = new Set<string>();
  const unmatched: InventoryLocation[] = [];
  for (const location of locations) {
    const place = placeTool(index, { mapId: location.mapTag, location: location.room, zone: location.zone });
    if (place) used.add(place.zone.id);
    else unmatched.push(location);
  }
  const lines: string[] = [];
  if (unmatched.length === 0) lines.push("Every location in the inventory lands on the plan.");
  else {
    lines.push(`${unmatched.length} location(s) land nowhere on the plan. Add a line to the zone they belong to:`);
    for (const location of unmatched) {
      const name = `${location.room} / ${location.zone}`;
      lines.push(`  ${JSON.stringify(name)}  (${location.tools} tool(s))  →  "matches": [${JSON.stringify(name)}]`);
    }
  }
  const empty = plan.zones.filter((zone) => !used.has(zone.id));
  if (empty.length > 0) {
    lines.push(`Zones no location uses: ${empty.map((zone) => `${zone.id} ${zone.room} / ${zone.zone}`).join("; ")}`);
  }
  return lines;
}

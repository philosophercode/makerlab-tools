/**
 * Write `lab/floor-plan.schema.json` from the floor plan's Zod schema (lab
 * config spec 2026-10-25 §4).
 *
 *   npm run lab:schema
 *
 * The file a lab gives a vision model along with its plan image (`docs/map.md`).
 * Run after changing `src/lib/map/schema.ts`; a test fails while the committed
 * file is stale.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { floorPlanJsonSchema } from "../src/lib/map/schema.ts";

export const SCHEMA_PATH = fileURLToPath(new URL("../lab/floor-plan.schema.json", import.meta.url));

/** The file's exact text: what the staleness test compares. */
export function floorPlanSchemaText(): string {
  return `${JSON.stringify(floorPlanJsonSchema(), null, 2)}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(SCHEMA_PATH, floorPlanSchemaText());
  console.log(`Wrote ${SCHEMA_PATH}`);
}

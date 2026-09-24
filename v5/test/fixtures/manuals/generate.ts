/**
 * Writes the manual-text fixture PDFs next to this file.
 *
 *   node --experimental-strip-types test/fixtures/manuals/generate.ts
 *
 * Run from `v5/` after changing `fixtures.ts`, and commit the PDFs.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURES } from "./fixtures.ts";

const here = dirname(fileURLToPath(import.meta.url));
for (const [name, build] of Object.entries(FIXTURES)) {
  const bytes = build();
  writeFileSync(join(here, name), bytes);
  console.log(`${name}: ${bytes.byteLength} bytes`);
}

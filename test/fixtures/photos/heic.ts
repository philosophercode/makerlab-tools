import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Two real HEIC files for the server's conversion (data platform spec
 * amendment 2026-10-08), each 668 bytes and made here, so nothing is borrowed:
 *
 * - `marker.heic` — a synthetic 96 × 64 picture (left half red, right half
 *   blue, a 16 × 16 green square in the top-left corner) drawn with `sharp`
 *   and encoded by macOS: `sips -s format heic marker.png --out marker.heic`.
 *   HEVC-coded, major brand `heic` — the same kind of file an iPhone writes.
 * - `marker-irot.heic` — the same file with its `irot` property's angle byte
 *   set to 1 (90° anticlockwise), which is how an iPhone records a portrait
 *   photo. Decoded, it is 64 × 96 with the green square bottom-left.
 *
 * Read with `fs`, so Node-environment tests only.
 */

const here = (name: string) => fileURLToPath(new URL(`./${name}`, import.meta.url));

export const MARKER_SIZE = { width: 96, height: 64 } as const;

export function markerHeic(): Uint8Array {
  return new Uint8Array(readFileSync(here("marker.heic")));
}

export function markerIrotHeic(): Uint8Array {
  return new Uint8Array(readFileSync(here("marker-irot.heic")));
}

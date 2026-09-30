import { deflateSync } from "node:zlib";

/**
 * A real, decodable PNG of any size, with or without an alpha channel — for
 * the image stage's probes and the cleaned-copy check (gateway spec §10), and
 * for the Gateway image stub's answers.
 *
 * No dependencies beyond `node:zlib`, so `e2e/stubs/gateway-stub.ts` can import
 * it under `node --experimental-strip-types` as well as Vitest.
 *
 * With `alpha`, the image is RGBA (colour type 6) and its left half is fully
 * transparent — a genuine alpha channel, not an opaque one that merely exists.
 * Without, it is RGB (colour type 2).
 */
export function makePng({ width, height, alpha }: { width: number; height: number; alpha: boolean }): Uint8Array {
  const channels = alpha ? 4 : 3;
  const row = 1 + width * channels;
  const raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y += 1) {
    const base = y * row;
    raw[base] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const p = base + 1 + x * channels;
      raw[p] = (x * 7) & 0xff;
      raw[p + 1] = (y * 5) & 0xff;
      raw[p + 2] = 0x80;
      if (alpha) raw[p + 3] = x < width / 2 ? 0 : 0xff;
    }
  }

  return encodePng(width, height, alpha ? 6 : 2, raw);
}

/** Wrap filtered scanlines as a PNG: 8-bit, colour type 2 (RGB) or 6 (RGBA). */
function encodePng(width: number, height: number, colourType: 2 | 6, raw: Buffer): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colourType;
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return new Uint8Array(png.buffer, png.byteOffset, png.byteLength);
}

/**
 * A product shot on a plain white backdrop: an opaque RGB PNG, white, with a
 * dark-blue box (with a lighter label band) filling the middle half. What the
 * background classifier calls `plain` and the deterministic cutout can cut —
 * for the image stage's tests and the E2E stub's product images. No
 * dependencies, like {@link makePng}.
 */
export function makeProductPng({ width, height }: { width: number; height: number }): Uint8Array {
  const row = 1 + width * 3;
  const raw = Buffer.alloc(row * height);
  const [left, right, top, bottom] = [width / 4, (width * 3) / 4, height / 4, (height * 3) / 4];
  for (let y = 0; y < height; y += 1) {
    const base = y * row;
    raw[base] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const p = base + 1 + x * 3;
      const inside = x >= left && x < right && y >= top && y < bottom;
      const label = inside && y >= height * 0.45 && y < height * 0.55;
      const [r, g, b] = !inside ? [255, 255, 255] : label ? [230, 200, 40] : [30, 60, 160];
      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
    }
  }
  return encodePng(width, height, 2, raw);
}

/** `makePng(...)` as base64 — what the Gateway's image endpoint answers with. */
export function makePngBase64(options: { width: number; height: number; alpha: boolean }): string {
  return Buffer.from(makePng(options)).toString("base64");
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

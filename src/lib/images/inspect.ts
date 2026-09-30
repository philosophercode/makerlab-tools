/**
 * What an image is, read from its first bytes (gateway spec §3.5): the format,
 * the dimensions, and whether it can be transparent.
 *
 * The image stage uses it twice — a probed candidate must decode as JPEG, PNG
 * or WebP with a short edge of at least 400 px, and a cleaned copy must be a PNG
 * with an alpha channel or it is dropped — so this answers exactly those
 * questions and nothing more. It reads headers, not pixels: no dependency, no
 * decode, and a body that is truncated, garbage, or some other format answers
 * `null` rather than a guess.
 *
 * `hasAlpha` means the file *declares* transparency (a PNG colour type with
 * alpha or a `tRNS` chunk; WebP's alpha flag), not that a pixel uses it. A model
 * that returns an RGBA PNG painted fully opaque passes; the admin, who is always
 * shown the original beside it, is the check on that.
 *
 * Plain Node, no imports: step code uses this.
 */

export type ImageFormat = "image/jpeg" | "image/png" | "image/webp";

export interface ImageInfo {
  format: ImageFormat;
  width: number;
  height: number;
  hasAlpha: boolean;
}

export function inspectImage(bytes: Uint8Array): ImageInfo | null {
  try {
    if (isPng(bytes)) return inspectPng(bytes);
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return inspectJpeg(bytes);
    if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return inspectWebp(bytes);
    return null;
  } catch {
    return null;
  }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

function inspectPng(bytes: Uint8Array): ImageInfo | null {
  // IHDR must be the first chunk: length 13 at offset 8.
  if (bytes.length < 33 || ascii(bytes, 12, 4) !== "IHDR" || u32be(bytes, 8) !== 13) return null;
  const width = u32be(bytes, 16);
  const height = u32be(bytes, 20);
  const colourType = bytes[25];
  if (!validSize(width, height) || ![0, 2, 3, 4, 6].includes(colourType)) return null;

  let hasAlpha = colourType === 4 || colourType === 6;
  // A tRNS chunk gives a palette or grey/RGB image transparency; it must come before IDAT.
  let offset = 33;
  while (!hasAlpha && offset + 8 <= bytes.length) {
    const length = u32be(bytes, offset);
    const type = ascii(bytes, offset + 4, 4);
    if (type === "tRNS") hasAlpha = true;
    if (type === "IDAT" || type === "IEND") break;
    offset += 12 + length;
  }
  return { format: "image/png", width, height, hasAlpha };
}

/** Start-of-frame markers that carry dimensions (not DHT C4, JPG C8 or DAC CC). */
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function inspectJpeg(bytes: Uint8Array): ImageInfo | null {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    let marker = bytes[offset + 1];
    // Fill bytes: any number of 0xFF before the marker.
    while (marker === 0xff && offset + 2 < bytes.length) {
      offset += 1;
      marker = bytes[offset + 1];
    }
    // Markers with no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // end, or scan data before any frame header
    const length = u16be(bytes, offset + 2);
    if (length < 2) return null;
    if (SOF.has(marker)) {
      if (offset + 9 > bytes.length) return null;
      const height = u16be(bytes, offset + 5);
      const width = u16be(bytes, offset + 7);
      return validSize(width, height) ? { format: "image/jpeg", width, height, hasAlpha: false } : null;
    }
    offset += 2 + length;
  }
  return null;
}

function inspectWebp(bytes: Uint8Array): ImageInfo | null {
  const chunk = ascii(bytes, 12, 4);
  const data = 20;
  if (chunk === "VP8 ") {
    // Lossy: a 3-byte frame tag, the start code 9D 01 2A, then 14-bit width and height.
    if (bytes.length < data + 10) return null;
    if (bytes[data + 3] !== 0x9d || bytes[data + 4] !== 0x01 || bytes[data + 5] !== 0x2a) return null;
    const width = u16le(bytes, data + 6) & 0x3fff;
    const height = u16le(bytes, data + 8) & 0x3fff;
    return validSize(width, height) ? { format: "image/webp", width, height, hasAlpha: false } : null;
  }
  if (chunk === "VP8L") {
    // Lossless: signature 0x2F, then width-1 (14 bits), height-1 (14 bits), alpha_is_used (1 bit).
    if (bytes.length < data + 5 || bytes[data] !== 0x2f) return null;
    const bits = u32le(bytes, data + 1);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >>> 14) & 0x3fff) + 1;
    const hasAlpha = ((bits >>> 28) & 1) === 1;
    return { format: "image/webp", width, height, hasAlpha };
  }
  if (chunk === "VP8X") {
    // Extended: flags (alpha is 0x10), 3 reserved bytes, then 24-bit canvas width-1 and height-1.
    if (bytes.length < data + 10) return null;
    const hasAlpha = (bytes[data] & 0x10) !== 0;
    const width = u24le(bytes, data + 4) + 1;
    const height = u24le(bytes, data + 7) + 1;
    return { format: "image/webp", width, height, hasAlpha };
  }
  return null;
}

function validSize(width: number, height: number): boolean {
  return width > 0 && height > 0;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (offset + length > bytes.length) return "";
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function u16be(b: Uint8Array, o: number): number {
  return (b[o] << 8) | b[o + 1];
}

function u32be(b: Uint8Array, o: number): number {
  return ((b[o] << 24) >>> 0) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
}

function u16le(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8);
}

function u24le(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
}

function u32le(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

/**
 * Reading an iPhone's HEIC photo on the server (data platform spec amendment
 * 2026-10-08, "Photos from any phone").
 *
 * Safari reads HEIC itself, so a chat photo from an iPhone normally arrives
 * here already a JPEG. Chrome on Android or a desktop does not, and sends the
 * original. `sharp`'s prebuilt libvips has no HEVC decoder, so the decode is
 * `heic-decode` — libheif and libde265 compiled to WebAssembly (`libheif-js`,
 * LGPL-3.0), about 2 MB, pure JS/wasm with no native binary. It is imported
 * only when a HEIC actually arrives, so every other upload never loads it; the
 * package is server-only (`serverExternalPackages`) and no client code imports
 * this file.
 *
 * libheif applies the HEIF transform properties (`irot`, `imir`, `clap`) as it
 * decodes, which is where an iPhone records orientation, so the pixels come out
 * upright.
 *
 * Plain Node: relative imports only.
 */

/** HEIF brands whose images are HEVC-coded — what an iPhone or a Samsung writes. */
const HEVC_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx"]);

/** Generic HEIF brands, accepted only alongside an HEVC brand (so AVIF, also `mif1`, is not). */
const GENERIC_BRANDS = new Set(["mif1", "msf1"]);

/**
 * The most pixels a HEIC may decode to: a 48 MP iPhone photo (8064 × 6048) and
 * a 50 MP Samsung one fit; a crafted file claiming more is refused before its
 * pixels are allocated.
 */
export const HEIF_MAX_PIXELS = 64_000_000;

/** RGBA pixels, 4 bytes each, row by row. */
export interface HeifPixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** How `heic-decode` is loaded — replaceable so a test can stand in for it. */
export type HeifDecoderLoader = () => Promise<typeof import("heic-decode").default>;

const loadHeicDecode: HeifDecoderLoader = async () => {
  const mod = (await import("heic-decode")) as unknown as { default?: typeof import("heic-decode").default };
  return (mod.default ?? mod) as typeof import("heic-decode").default;
};

/**
 * Whether `bytes` open like a HEIC/HEIF image: an `ftyp` box whose major brand,
 * or a compatible brand beside a generic one, is an HEVC brand.
 */
export function isHeif(bytes: Uint8Array): boolean {
  if (bytes.length < 16) return false;
  if (ascii(bytes, 4, 8) !== "ftyp") return false;
  const boxSize = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  if (boxSize < 16) return false;
  const major = ascii(bytes, 8, 12);
  if (HEVC_BRANDS.has(major)) return true;
  if (!GENERIC_BRANDS.has(major)) return false;
  const end = Math.min(boxSize, bytes.length);
  for (let offset = 16; offset + 4 <= end; offset += 4) {
    if (HEVC_BRANDS.has(ascii(bytes, offset, offset + 4))) return true;
  }
  return false;
}

/**
 * The first (primary) image of a HEIC file as RGBA pixels, or null when it
 * cannot be read: not HEIC, no image, larger than {@link HEIF_MAX_PIXELS}, a
 * codec this build lacks, or a corrupt file. Never throws.
 */
export async function decodeHeif(
  bytes: Uint8Array,
  opts: { load?: HeifDecoderLoader; maxPixels?: number } = {}
): Promise<HeifPixels | null> {
  if (!isHeif(bytes)) return null;
  const maxPixels = opts.maxPixels ?? HEIF_MAX_PIXELS;
  let images: Awaited<ReturnType<typeof import("heic-decode").default.all>> | undefined;
  try {
    const decode = await (opts.load ?? loadHeicDecode)();
    images = await decode.all({ buffer: bytes });
    const primary = images[0];
    if (!primary || primary.width <= 0 || primary.height <= 0) return null;
    if (primary.width * primary.height > maxPixels) return null;
    const { width, height, data } = await primary.decode();
    return data.length === width * height * 4 ? { width, height, data } : null;
  } catch (err) {
    console.warn("[heif] decode failed:", err instanceof Error ? err.message.slice(0, 200) : "unknown error");
    return null;
  } finally {
    try {
      images?.dispose();
    } catch {
      // Freed with the module's heap regardless.
    }
  }
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

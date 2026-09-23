// @vitest-environment node
import { makePng } from "../../../test/gateway/png";
import { inspectImage } from "./inspect";

/**
 * Header inspection (gateway spec §3.5, §10 "Unit": candidates filtered by type
 * and decode; a cleaned copy without alpha, or undecodable, is dropped).
 */

function bytes(...parts: (number[] | string)[]): Uint8Array {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === "string") for (const ch of part) out.push(ch.charCodeAt(0));
    else out.push(...part);
  }
  return Uint8Array.from(out);
}

const u16be = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u16le = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u24le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];
const u32le = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

/** SOI, an APP0 segment, then a baseline SOF0 frame header. */
function jpeg(width: number, height: number, sof = 0xc0): Uint8Array {
  return bytes(
    [0xff, 0xd8],
    [0xff, 0xe0], u16be(16), "JFIF", [0, 1, 1, 0, 0, 1, 0, 1, 0, 0],
    [0xff, sof], u16be(17), [8], u16be(height), u16be(width), [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1],
    [0xff, 0xda]
  );
}

function webp(chunk: string, payload: number[]): Uint8Array {
  return bytes("RIFF", u32le(4 + 8 + payload.length), "WEBP", chunk, u32le(payload.length), payload);
}

describe("inspectImage — PNG", () => {
  it("reads an RGB PNG as opaque", () => {
    expect(inspectImage(makePng({ width: 640, height: 480, alpha: false }))).toEqual({
      format: "image/png",
      width: 640,
      height: 480,
      hasAlpha: false,
    });
  });

  it("reads an RGBA PNG as having alpha", () => {
    expect(inspectImage(makePng({ width: 1536, height: 1024, alpha: true }))).toEqual({
      format: "image/png",
      width: 1536,
      height: 1024,
      hasAlpha: true,
    });
  });

  it("reads a tRNS chunk before IDAT as alpha", () => {
    const png = makePng({ width: 10, height: 10, alpha: false });
    // Insert a tRNS chunk right after IHDR (8 + 25 bytes).
    // length 2 (big-endian), type, one grey sample, and a CRC the inspector does not check.
    const trns = bytes([0, 0, 0, 2], "tRNS", [0, 0], [0, 0, 0, 0]);
    const withTrns = new Uint8Array(png.length + trns.length);
    withTrns.set(png.subarray(0, 33));
    withTrns.set(trns, 33);
    withTrns.set(png.subarray(33), 33 + trns.length);
    expect(inspectImage(withTrns)?.hasAlpha).toBe(true);
  });

  it("refuses a truncated header or a zero size", () => {
    const png = makePng({ width: 10, height: 10, alpha: true });
    expect(inspectImage(png.subarray(0, 8))).toBeNull();
    expect(inspectImage(png.subarray(0, 30))).toBeNull();
    const zero = png.slice();
    zero.set([0, 0, 0, 0], 16);
    expect(inspectImage(zero)).toBeNull();
  });
});

describe("inspectImage — JPEG", () => {
  it("reads the dimensions from a baseline frame header", () => {
    expect(inspectImage(jpeg(1200, 800))).toEqual({ format: "image/jpeg", width: 1200, height: 800, hasAlpha: false });
  });

  it("reads a progressive frame header", () => {
    expect(inspectImage(jpeg(400, 300, 0xc2))).toMatchObject({ width: 400, height: 300 });
  });

  it("skips fill bytes before a marker", () => {
    const j = jpeg(50, 60);
    const padded = bytes([0xff, 0xd8, 0xff, 0xff], Array.from(j.subarray(2)));
    expect(inspectImage(padded)).toMatchObject({ width: 50, height: 60 });
  });

  it("refuses a JPEG with no frame header, or cut off inside one", () => {
    expect(inspectImage(bytes([0xff, 0xd8, 0xff, 0xe0], u16be(4), [0, 0], [0xff, 0xda]))).toBeNull();
    expect(inspectImage(jpeg(100, 100).subarray(0, 24))).toBeNull();
  });
});

describe("inspectImage — WebP", () => {
  it("reads lossy VP8", () => {
    const payload = [0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a, ...u16le(1024), ...u16le(768), 0, 0];
    expect(inspectImage(webp("VP8 ", payload))).toEqual({ format: "image/webp", width: 1024, height: 768, hasAlpha: false });
  });

  it("reads lossless VP8L, with and without its alpha bit", () => {
    const header = (w: number, h: number, alpha: boolean) =>
      [0x2f, ...u32le(((w - 1) | ((h - 1) << 14) | ((alpha ? 1 : 0) << 28)) >>> 0)];
    expect(inspectImage(webp("VP8L", header(800, 600, true)))).toEqual({
      format: "image/webp",
      width: 800,
      height: 600,
      hasAlpha: true,
    });
    expect(inspectImage(webp("VP8L", header(800, 600, false)))?.hasAlpha).toBe(false);
  });

  it("reads extended VP8X and its alpha flag", () => {
    const payload = (flags: number) => [flags, 0, 0, 0, ...u24le(1999), ...u24le(1499)];
    expect(inspectImage(webp("VP8X", payload(0x10)))).toEqual({ format: "image/webp", width: 2000, height: 1500, hasAlpha: true });
    expect(inspectImage(webp("VP8X", payload(0)))?.hasAlpha).toBe(false);
  });

  it("refuses a WebP with a bad start code or an unknown chunk", () => {
    expect(inspectImage(webp("VP8 ", [0, 0, 0, 1, 2, 3, 0, 0, 0, 0]))).toBeNull();
    expect(inspectImage(webp("ALPH", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
    expect(inspectImage(webp("VP8X", [0x10, 0, 0]))).toBeNull();
  });
});

describe("inspectImage — everything else", () => {
  it.each([
    ["empty", new Uint8Array(0)],
    ["garbage", Uint8Array.from({ length: 64 }, (_, i) => (i * 37) & 0xff)],
    ["a GIF", bytes("GIF89a", [1, 0, 1, 0])],
    ["an SVG", bytes('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ["HTML", bytes("<!doctype html><title>404</title>")],
    ["a PDF", bytes("%PDF-1.4")],
  ])("answers null for %s", (_label, input) => {
    expect(inspectImage(input)).toBeNull();
  });
});

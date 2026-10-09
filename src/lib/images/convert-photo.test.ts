// @vitest-environment node

import sharp from "sharp";
import { MARKER_SIZE, markerHeic, markerIrotHeic } from "../../../test/fixtures/photos/heic";
import { convertHeifPhoto } from "./convert-photo";
import { PHOTO_UPLOAD_MAX_EDGE, VISION_MAX_EDGE } from "./photo-rules";

/**
 * A HEIC the browser could not read, made into what the browser would have
 * uploaded (data platform spec amendment 2026-10-08): real files through the
 * real decoder and `sharp`, plus a stand-in decoder for a 12 MP photo so the
 * size rules are checked without committing a large fixture.
 */

async function jpegInfo(bytes: Uint8Array) {
  const meta = await sharp(bytes).metadata();
  return { format: meta.format, width: meta.width, height: meta.height, exif: meta.exif, hasAlpha: meta.hasAlpha };
}

function dataUrlBytes(dataUrl: string): Uint8Array {
  return new Uint8Array(Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
}

/** A `heic-decode` stand-in that "decodes" to a grey `width` × `height` image. */
function decoderFor(width: number, height: number) {
  const decode = Object.assign(vi.fn(), {
    all: vi.fn(async () =>
      Object.assign(
        [{ width, height, decode: async () => ({ width, height, data: new Uint8ClampedArray(width * height * 4).fill(128) }) }],
        { dispose: vi.fn() }
      )
    ),
  });
  return async () => decode as never;
}

describe("convertHeifPhoto", () => {
  it("makes a real HEIC a JPEG, with no metadata, and the model's copy beside it", async () => {
    const converted = await convertHeifPhoto(markerHeic(), { vision: true });

    expect(converted).not.toBeNull();
    if (!converted) return;
    expect(converted.type).toBe("image/jpeg");
    expect([converted.bytes[0], converted.bytes[1], converted.bytes[2]]).toEqual([0xff, 0xd8, 0xff]);
    expect(await jpegInfo(converted.bytes)).toEqual({ format: "jpeg", ...MARKER_SIZE, exif: undefined, hasAlpha: false });
    expect(converted.visionDataUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect((await jpegInfo(dataUrlBytes(converted.visionDataUrl ?? ""))).format).toBe("jpeg");
  });

  it("keeps an iPhone portrait upright", async () => {
    const converted = await convertHeifPhoto(markerIrotHeic(), { vision: false });

    expect(converted && { width: converted.width, height: converted.height }).toEqual({ width: 64, height: 96 });
  });

  it("makes no model copy when none is asked for (a maintenance or project photo)", async () => {
    const converted = await convertHeifPhoto(markerHeic(), { vision: false });

    expect(converted?.visionDataUrl).toBeNull();
  });

  it("stores a 12 MP photo at 2048 px and gives the model 1568 px", async () => {
    const converted = await convertHeifPhoto(markerHeic(), { vision: true, loadDecoder: decoderFor(4032, 3024) });

    expect(converted && { width: converted.width, height: converted.height }).toEqual({ width: PHOTO_UPLOAD_MAX_EDGE, height: 1536 });
    const vision = await jpegInfo(dataUrlBytes(converted?.visionDataUrl ?? ""));
    expect({ width: vision.width, height: vision.height }).toEqual({ width: VISION_MAX_EDGE, height: 1176 });
  });

  it("answers null when the photo cannot be decoded or sharp cannot load", async () => {
    expect(await convertHeifPhoto(markerHeic().slice(0, 300), { vision: true })).toBeNull();
    expect(await convertHeifPhoto(markerHeic(), { vision: true, loadSharp: async () => null })).toBeNull();
  });
});

// @vitest-environment node
import sharp from "sharp";
import { Canvas } from "../../../test/images/synthetic";
import { renderThumbnails, thumbnailHash } from "./thumbnails";

/** A 1000×500 product (dark bar) on a transparent backdrop, as the cleaned product images are. */
async function productPng(): Promise<Uint8Array> {
  return new Canvas(1000, 500, [0, 0, 0, 0]).rect(100, 200, 800, 100, [20, 20, 20, 255]).png({ alpha: true });
}

describe("renderThumbnails", () => {
  it("renders every width in AVIF and WebP, keeping the aspect ratio and the alpha channel", async () => {
    const out = await renderThumbnails(await productPng());
    expect(out).not.toBeNull();
    expect(out!.width).toBe(1000);
    expect(out!.height).toBe(500);
    expect(out!.widths).toEqual([160, 320, 640]);
    expect(out!.renditions.map((r) => `${r.width}.${r.format}`)).toEqual([
      "160.avif",
      "160.webp",
      "320.avif",
      "320.webp",
      "640.avif",
      "640.webp",
    ]);
    for (const r of out!.renditions) {
      const meta = await sharp(r.bytes).metadata();
      expect(meta.width).toBe(r.width);
      // Resized, never cropped or padded: the product keeps its framing.
      expect(meta.height).toBe(r.width / 2);
      expect(meta.hasAlpha).toBe(true);
      expect(r.contentType).toBe(r.format === "avif" ? "image/avif" : "image/webp");
    }
  });

  it("never enlarges a small source", async () => {
    const small = await new Canvas(200, 100).png();
    const out = await renderThumbnails(small);
    expect(out!.widths).toEqual([160, 200]);
  });

  it("applies EXIF orientation, reporting the rotated size", async () => {
    const rotated = new Uint8Array(await sharp(await new Canvas(400, 200).jpeg()).withMetadata({ orientation: 6 }).toBuffer());
    const out = await renderThumbnails(rotated);
    expect(out!.width).toBe(200);
    expect(out!.height).toBe(400);
  });

  it("answers null for bytes that are not an image, or without sharp", async () => {
    expect(await renderThumbnails(new TextEncoder().encode("not an image"))).toBeNull();
    expect(await renderThumbnails(await productPng(), { loadSharp: async () => null })).toBeNull();
  });
});

describe("thumbnailHash", () => {
  it("is stable for the same bytes and changes with them", async () => {
    const a = await productPng();
    expect(thumbnailHash(a)).toBe(thumbnailHash(a));
    expect(thumbnailHash(a)).toMatch(/^[0-9a-f]{12}$/);
    expect(thumbnailHash(new Uint8Array([1, 2, 3]))).not.toBe(thumbnailHash(a));
  });
});

// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { extractManual } from "./extract";
import { imageGeometry, MAX_LONG_SIDE_PX, multiply, pageScale, renderPageImages, unpackBits, type Matrix } from "./page-images";

/**
 * Drawing a scanned manual's pages for OCR (manual text spec phase 3) without
 * a canvas: the images each page paints, composited where the page paints
 * them. The fixture (`scanned-image.pdf`) is known exactly: page 1 black on
 * the left half, page 2 a picture turned a quarter clockwise so its black top
 * half lands on the right, page 3 no image.
 */

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(process.cwd(), "test/fixtures/manuals", name)));
}

/** Mean brightness (0–255) of a region given as fractions of the picture. */
async function brightness(jpeg: Uint8Array, region: { left: number; top: number; width: number; height: number }) {
  const meta = await sharp(jpeg).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  const { data } = await sharp(jpeg)
    .extract({
      left: Math.round(region.left * w),
      top: Math.round(region.top * h),
      width: Math.round(region.width * w),
      height: Math.round(region.height * h),
    })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data.reduce((sum, v) => sum + v, 0) / data.length;
}

describe("renderPageImages", () => {
  it("is a scan to the extractor: no text layer", async () => {
    expect((await extractManual(fixture("scanned-image.pdf"))).status).toBe("no_text");
  });

  it("draws each page's images where the page paints them, the right way up", async () => {
    const rendered = await renderPageImages(fixture("scanned-image.pdf"), { maxPages: 10 });
    expect(rendered.pageCount).toBe(3);
    expect(rendered.pages.map((p) => p.pageNumber)).toEqual([1, 2, 3]);

    const [first, second, third] = rendered.pages;
    // Letter proportions, the long side within bounds.
    expect(first.jpeg).not.toBeNull();
    expect(Math.max(first.width, first.height)).toBeLessThanOrEqual(MAX_LONG_SIDE_PX);
    expect(first.height / first.width).toBeCloseTo(792 / 612, 1);
    expect((await sharp(first.jpeg!).metadata()).format).toBe("jpeg");

    // Page 1: black on the left, white on the right, white margins.
    expect(await brightness(first.jpeg!, { left: 0.15, top: 0.3, width: 0.2, height: 0.4 })).toBeLessThan(40);
    expect(await brightness(first.jpeg!, { left: 0.65, top: 0.3, width: 0.2, height: 0.4 })).toBeGreaterThan(215);
    expect(await brightness(first.jpeg!, { left: 0, top: 0, width: 1, height: 0.03 })).toBeGreaterThan(215);

    // Page 2: turned a quarter clockwise, so the image's black top is on the right.
    expect(await brightness(second.jpeg!, { left: 0.65, top: 0.3, width: 0.2, height: 0.4 })).toBeLessThan(40);
    expect(await brightness(second.jpeg!, { left: 0.15, top: 0.3, width: 0.2, height: 0.4 })).toBeGreaterThan(215);

    // Page 3 paints no image: nothing to read.
    expect(third.jpeg).toBeNull();
  });

  it("draws only the first maxPages pages", async () => {
    const rendered = await renderPageImages(fixture("scanned-image.pdf"), { maxPages: 1 });
    expect(rendered.pageCount).toBe(3);
    expect(rendered.pages).toHaveLength(1);
  });

  it("gives up past its deadline", async () => {
    await expect(renderPageImages(fixture("scanned-image.pdf"), { maxPages: 10, timeoutMs: -1 })).rejects.toThrow(/too long/);
  });

  it("throws for a file pdf.js cannot open", async () => {
    await expect(renderPageImages(fixture("corrupt.pdf"), { maxPages: 5 })).rejects.toThrow();
  });
});

describe("imageGeometry", () => {
  // The viewport of a 612×792 page at scale 1: y flipped.
  const viewport: Matrix = [1, 0, 0, -1, 0, 792];

  it("places an upright image with its top row at the top", () => {
    expect(imageGeometry(multiply(viewport, [100, 0, 0, 50, 10, 20]))).toEqual({
      left: 10,
      top: 722,
      width: 100,
      height: 50,
      turns: 0,
      mirror: null,
    });
  });

  it("turns a quarter clockwise, and mirrors a flipped image", () => {
    expect(imageGeometry(multiply(viewport, [0, -100, 50, 0, 0, 700]))).toMatchObject({ turns: 1, mirror: null, width: 50, height: 100 });
    // A negative d paints the image upside down: mirrored top to bottom.
    expect(imageGeometry(multiply(viewport, [100, 0, 0, -50, 10, 70]))).toMatchObject({ turns: 0, mirror: "flip" });
    // A negative a paints it right to left: a half turn plus a vertical mirror.
    expect(imageGeometry(multiply(viewport, [-100, 0, 0, 50, 110, 20]))).toMatchObject({ turns: 2, mirror: "flip" });
  });

  it("leaves out an image painted at a skew or with no area", () => {
    expect(imageGeometry(multiply(viewport, [70, 70, -70, 70, 100, 100]))).toBeNull();
    expect(imageGeometry(multiply(viewport, [0, 0, 0, 50, 10, 20]))).toBeNull();
  });
});

describe("pageScale", () => {
  it("draws at the sharpest image's resolution within the long-side bounds", () => {
    const image = (width: number, drawn: number) => ({
      width,
      height: width,
      channels: 1 as const,
      data: new Uint8Array(0),
      matrix: [drawn, 0, 0, -drawn, 0, 792] as Matrix,
    });
    // A 300 dpi letter scan would be 2550 px wide: capped at 2000 px on the long side.
    expect(pageScale(612, 792, [image(2550, 612)])).toBeCloseTo(MAX_LONG_SIDE_PX / 792);
    // A tiny image is still drawn at least 1000 px long.
    expect(pageScale(612, 792, [image(60, 540)])).toBeCloseTo(1000 / 792);
    // In between, its own resolution.
    expect(pageScale(612, 792, [image(918, 612)])).toBeCloseTo(1.5);
  });
});

describe("unpackBits", () => {
  it("unpacks one bit a pixel, rows padded to a byte, set bits white", () => {
    expect([...unpackBits(new Uint8Array([0b10100000, 0b01000000]), 3, 2)]).toEqual([255, 0, 255, 0, 255, 0]);
  });
});

// @vitest-environment node
import { Canvas, decode, seeded, type Rgba } from "../../../../test/images/synthetic";
import { makeCleanCopy } from "./clean-copy";
import { cleanImage } from "./clean";

/**
 * Rank 1's cleaned copy (amendments "No generative redraw" and "Composites and
 * product crop"): crop to the product box when there is a reason to, cut the
 * crop's backdrop when it is plain, keep the crop alone when it is not — and
 * without a box, exactly what the cutout did before. Synthetic images, real
 * `sharp`, no network, no model.
 */

const BLUE: Rgba = [30, 60, 160, 255];
const ORANGE: Rgba = [240, 110, 30, 255];
const WHITE: Rgba = [255, 255, 255, 255];
const DARK: Rgba = [40, 40, 40, 255];

type Pixels = Awaited<ReturnType<typeof decode>>;

function at(image: Pixels, x: number, y: number): Rgba {
  const p = (y * image.width + x) * 4;
  return [image.data[p], image.data[p + 1], image.data[p + 2], image.data[p + 3]];
}

/**
 * A store banner, 1000 × 1000: an orange price bar with white "text" across the
 * top, the product (a blue body with a white window) on white in the middle,
 * and two promotional tiles with their own pictures along the bottom.
 */
function banner(): Canvas {
  const canvas = new Canvas(1000, 1000);
  canvas.rect(30, 20, 940, 120, ORANGE);
  for (let i = 0; i < 8; i += 1) canvas.rect(70 + i * 60, 60, 40, 40, WHITE); // the price text
  canvas.rect(300, 250, 400, 400, BLUE).rect(380, 330, 240, 160, WHITE); // the product and its window
  for (const left of [30, 520]) {
    canvas.rect(left, 720, 450, 60, ORANGE).rect(left, 780, 450, 200, [250, 250, 250, 255]);
    canvas.rect(left + 150, 820, 150, 120, DARK); // the tile's own picture
  }
  return canvas;
}

describe("makeCleanCopy — with a product box", () => {
  it("crops a banner to its product and cuts the crop's plain backdrop: the product alone, its pixels intact", async () => {
    const bytes = await banner().png();
    // Without the crop the cutout keeps the price bar and the tiles along with the product.
    expect(await cleanImage(bytes)).toEqual({ ok: false, note: "fragmented" });

    const copy = await makeCleanCopy({
      bytes,
      background: "busy",
      composite: true,
      productBox: [0.29, 0.24, 0.71, 0.66],
    });

    expect(copy).toMatchObject({ made: true, kind: "cropped_and_cut", note: null });
    if (!copy.made) throw new Error("expected a copy");
    expect(copy.info).toMatchObject({ format: "image/png", hasAlpha: true });
    const pixels = await decode(copy.bytes);
    // Trimmed to the product (400 px) plus the cutout's small margin.
    expect(pixels.width).toBeGreaterThanOrEqual(400);
    expect(pixels.width).toBeLessThan(460);
    expect(pixels.height).toBeGreaterThanOrEqual(400);
    expect(pixels.height).toBeLessThan(460);

    let orange = 0;
    let opaqueBlue = 0;
    let windowWhite = 0;
    for (let y = 0; y < pixels.height; y += 1) {
      for (let x = 0; x < pixels.width; x += 1) {
        const [r, g, b, a] = at(pixels, x, y);
        if (a > 0 && r === ORANGE[0] && g === ORANGE[1] && b === ORANGE[2]) orange += 1;
        if (a === 255 && r === BLUE[0] && g === BLUE[1] && b === BLUE[2]) opaqueBlue += 1;
        if (a === 255 && r === 255 && g === 255 && b === 255) windowWhite += 1;
      }
    }
    expect(orange).toBe(0); // none of the banner's bar or tiles
    expect(opaqueBlue).toBeGreaterThan(0.9 * (400 * 400 - 240 * 160));
    expect(windowWhite).toBeGreaterThan(0.9 * 240 * 160); // the enclosed white window stays
    expect(at(pixels, 0, 0)[3]).toBe(0);
  });

  it("keeps the crop alone when its backdrop is busy — cropped, nothing cut, nothing redrawn", async () => {
    const random = seeded(11);
    const source = new Canvas(900, 600).paint(() => {
      const v = Math.round(random() * 200);
      return [v, 255 - v, (v * 3) % 256, 255];
    });
    source.rect(400, 200, 200, 200, BLUE);
    const bytes = await source.png();

    const copy = await makeCleanCopy({ bytes, background: "busy", composite: false, productBox: [0.43, 0.32, 0.68, 0.68] });

    expect(copy).toMatchObject({ made: true, kind: "cropped", note: "busy_background" });
    if (!copy.made) throw new Error("expected a copy");
    // A crop kept alone is padded 2%: (0.41–0.70) × 900 and (0.30–0.70) × 600.
    expect(copy.info).toMatchObject({ format: "image/png", width: 261, height: 240, hasAlpha: false });
    const original = await decode(bytes);
    const cropped = await decode(copy.bytes);
    for (const [x, y] of [[0, 0], [50, 40], [260, 239], [150, 130]]) {
      expect(at(cropped, x, y)).toEqual(at(original, x + 369, y + 180));
    }
  });

  it("tightens the crop when a banner's price bar reaches into the 4% margin", async () => {
    // The bar ends at y = 140; the box starts at 0.17, so a 4% margin (y = 130) catches the bar and 2% (150) clears it.
    const canvas = new Canvas(1000, 1000).rect(0, 20, 1000, 120, ORANGE).rect(300, 200, 400, 400, BLUE);
    const copy = await makeCleanCopy({
      bytes: await canvas.png(),
      background: "busy",
      composite: true,
      productBox: [0.29, 0.17, 0.71, 0.62],
    });
    expect(copy).toMatchObject({ made: true, kind: "cropped_and_cut", note: null });
    if (!copy.made) throw new Error("expected a copy");
    const pixels = await decode(copy.bytes);
    let orange = 0;
    for (let i = 0; i < pixels.width * pixels.height; i += 1) {
      const p = i * 4;
      if (pixels.data[p + 3] > 0 && pixels.data[p] === ORANGE[0] && pixels.data[p + 1] === ORANGE[1]) orange += 1;
    }
    expect(orange).toBe(0);
  });

  it("keeps a white base a shade off the white backdrop inside the product box, where the unguided cut eats it", async () => {
    // A blue body on a light grey base (240) with dark lettering, on a 254 backdrop: 24 apart, inside the fill's 40.
    const base: Rgba = [240, 240, 240, 255];
    const canvas = new Canvas(1000, 1000, [254, 254, 254, 255]).rect(300, 250, 400, 350, BLUE).rect(280, 600, 440, 90, base);
    for (let i = 0; i < 6; i += 1) canvas.rect(360 + i * 50, 630, 20, 30, DARK); // "CARVERA"
    const bytes = await canvas.png();

    const unguided = await cleanImage(bytes);
    if (!unguided.ok) throw new Error(`expected the unguided cut to run, got ${unguided.note}`);
    const cutPixels = await decode(unguided.image.bytes);
    // Without the box, the base goes with the floor (the cutout works at 1000 px, the source's own size).
    const { left, top } = unguided.image.crop;
    expect(at(cutPixels, 300 - left, 615 - top)[3]).toBe(0);

    const copy = await makeCleanCopy({ bytes, background: "plain", composite: false, productBox: [0.27, 0.24, 0.73, 0.7] });
    expect(copy).toMatchObject({ made: true, kind: "cropped_and_cut" });
    if (!copy.made) throw new Error("expected a copy");
    const pixels = await decode(copy.bytes);
    // Find the base's grey in the result: it is there, opaque, with its lettering.
    let greyOpaque = 0;
    let letters = 0;
    for (let i = 0; i < pixels.width * pixels.height; i += 1) {
      const p = i * 4;
      if (pixels.data[p + 3] !== 255) continue;
      if (pixels.data[p] === 240 && pixels.data[p + 1] === 240) greyOpaque += 1;
      if (pixels.data[p] === DARK[0] && pixels.data[p + 1] === DARK[1]) letters += 1;
    }
    expect(greyOpaque).toBeGreaterThan(0.85 * (440 * 90 - 6 * 20 * 30));
    expect(letters).toBe(6 * 20 * 30);
  });

  it("keeps the crop alone, saying why, when the crop's cut fails its checks", async () => {
    // A box drawn a little inside the product: the padded crop is nearly all product,
    // so there is almost no backdrop to remove.
    const source = new Canvas(1000, 1000, [248, 248, 248, 255]).rect(100, 100, 800, 800, BLUE);
    const copy = await makeCleanCopy({
      bytes: await source.png(),
      background: "plain",
      composite: true,
      productBox: [0.12, 0.12, 0.88, 0.88],
    });
    expect(copy).toMatchObject({ made: true, kind: "cropped", note: "little_background" });
  });

  it("does not crop a clean picture the product already fills: the plain cut, as before", async () => {
    const source = new Canvas(800, 800).rect(40, 40, 720, 720, BLUE).rect(300, 300, 200, 60, ORANGE);
    const bytes = await source.png();
    // The box covers 81% and the padded crop would keep 96%: no crop, the whole picture is cut.
    const copy = await makeCleanCopy({ bytes, background: "plain", composite: false, productBox: [0.05, 0.05, 0.95, 0.95] });
    const cut = await cleanImage(bytes);
    expect(copy).toMatchObject({ made: true, kind: "cut", note: null });
    if (!copy.made || !cut.ok) throw new Error("expected a cut");
    expect(copy.bytes).toEqual(cut.image.bytes);
  });

  it("answers failed when the crop cannot be made", async () => {
    const png = await banner().png();
    const copy = await makeCleanCopy(
      { bytes: png, background: "busy", composite: true, productBox: [0.29, 0.24, 0.71, 0.66] },
      { loadSharp: async () => null }
    );
    expect(copy).toEqual({ made: false, note: "failed" });
  });
});

describe("makeCleanCopy — without a usable box (the behaviour before crops)", () => {
  it("cuts a plain rank 1", async () => {
    const bytes = await new Canvas(600, 450).rect(150, 100, 300, 250, BLUE).png();
    const copy = await makeCleanCopy({ bytes, background: "plain", composite: false, productBox: null });
    expect(copy).toMatchObject({ made: true, kind: "cut", note: null });
  });

  it("leaves a busy rank 1 alone, and says so", async () => {
    const bytes = await new Canvas(500, 500, DARK).rect(150, 150, 200, 200, BLUE).png();
    expect(await makeCleanCopy({ bytes, background: "busy", composite: true, productBox: null })).toEqual({
      made: false,
      note: "busy_background",
    });
  });

  it("makes nothing, and says nothing, for a transparent or unclassified rank 1", async () => {
    const bytes = await new Canvas(500, 500).png();
    expect(await makeCleanCopy({ bytes, background: "transparent", composite: false, productBox: null })).toEqual({
      made: false,
      note: null,
    });
    expect(await makeCleanCopy({ bytes, background: null, composite: false, productBox: null })).toEqual({ made: false, note: null });
  });
});

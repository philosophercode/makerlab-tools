// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Canvas, decode, seeded, type Rgba } from "../../../../test/images/synthetic";
import { TABLET_VARIANTS, type TabletVariant } from "../../../../test/images/tablet";
import { classifyBackground } from "./background";
import { cleanImage, floodFillCutout, MAX_REMOVED_SHARE, takeFringe, validateCutout } from "./clean";

/**
 * The deterministic cutout (gateway spec, amendment "No generative redraw:
 * deterministic cutout"): a flood fill from the frame over a plain backdrop,
 * validated, feathered and trimmed — on synthetic images built with `sharp`.
 * The product's own pixels must come back exactly as they went in.
 */

const RED: Rgba = [200, 30, 30, 255];
const BLUE: Rgba = [30, 60, 160, 255];
const WHITE: Rgba = [255, 255, 255, 255];

type Pixels = Awaited<ReturnType<typeof decode>>;

function at(image: Pixels, x: number, y: number): Rgba {
  const p = (y * image.width + x) * 4;
  return [image.data[p], image.data[p + 1], image.data[p + 2], image.data[p + 3]];
}

async function cut(bytes: Uint8Array) {
  const outcome = await cleanImage(bytes);
  if (!outcome.ok) throw new Error(`expected a cutout, got ${outcome.note}`);
  return { ...outcome.image, pixels: await decode(outcome.image.bytes) };
}

describe("cleanImage", () => {
  it("cuts a product out of a white backdrop, keeping its pixels exactly and trimming to it", async () => {
    const source = new Canvas(600, 450).rect(150, 100, 300, 250, RED);
    const result = await cut(await source.png());

    expect(result.info).toMatchObject({ format: "image/png", hasAlpha: true });
    // Trimmed to the product plus a small margin.
    expect(result.info.width).toBeLessThan(600);
    expect(result.info.width).toBeGreaterThanOrEqual(300);
    expect(result.info.height).toBeGreaterThanOrEqual(250);
    expect(result.info.height).toBeLessThan(450);

    // Every pixel inside the product, away from the feathered edge, is the original.
    const { left, top } = result.crop;
    for (let y = 103; y < 347; y += 7) {
      for (let x = 153; x < 447; x += 7) expect(at(result.pixels, x - left, y - top)).toEqual(RED);
    }
    // The margin is transparent.
    expect(at(result.pixels, 0, 0)[3]).toBe(0);
    expect(at(result.pixels, result.info.width - 1, result.info.height - 1)[3]).toBe(0);
    // The cut edge ramps rather than stepping: outer ring, next ring, solid.
    const edge = [at(result.pixels, 150 - left, 200 - top)[3], at(result.pixels, 151 - left, 200 - top)[3], at(result.pixels, 152 - left, 200 - top)[3]];
    expect(edge[0]).toBeLessThan(edge[1]);
    expect(edge[1]).toBeLessThan(255);
    expect(edge[2]).toBe(255);
  });

  it("keeps a white panel enclosed by the product", async () => {
    // A dark frame with a white screen in the middle, on white.
    const source = new Canvas(600, 600).rect(150, 150, 300, 300, BLUE).rect(220, 220, 160, 160, WHITE);
    const result = await cut(await source.png());
    const { left, top } = result.crop;

    for (let y = 225; y < 375; y += 10) {
      for (let x = 225; x < 375; x += 10) expect(at(result.pixels, x - left, y - top)).toEqual(WHITE);
    }
    expect(at(result.pixels, 160 - left, 300 - top)).toEqual(BLUE);
  });

  it("refuses to eat a white product that fills the frame", async () => {
    // A white machine body touching three sides, with a small dark display:
    // the fill cannot tell body from backdrop, so the removed share gives it away.
    const source = new Canvas(600, 600).rect(260, 200, 80, 40, [20, 20, 20, 255]);
    const outcome = await cleanImage(await source.png());
    expect(outcome).toEqual({ ok: false, note: "product_removed" });
  });

  it("never removes more than the guard allows, even with a white base on a white floor", async () => {
    // A dark tower on a white base that sits on the bottom edge.
    const source = new Canvas(600, 600).rect(220, 80, 160, 380, BLUE).rect(120, 460, 360, 140, [250, 250, 250, 255]);
    const outcome = await cleanImage(await source.png());
    if (!outcome.ok) {
      expect(["product_removed", "product_too_small"]).toContain(outcome.note);
      return;
    }
    // Kept: the tower must be whole — the base may be taken with the floor, the product never.
    const pixels = await decode(outcome.image.bytes);
    const { left, top } = outcome.image.crop;
    for (let y = 90; y < 450; y += 15) {
      for (let x = 230; x < 370; x += 15) expect(at(pixels, x - left, y - top)).toEqual(BLUE);
    }
    const kept = floodFillCutout({ ...(await decode(await source.png())) });
    expect(kept.removedShare).toBeLessThanOrEqual(MAX_REMOVED_SHARE);
  });

  it("cuts a product out of a JPEG-noisy off-white backdrop, keeping the product's decoded pixels", async () => {
    const random = seeded(5);
    const source = new Canvas(640, 480).paint((x, y) => {
      const shade = 242 - Math.round((y / 480) * 12);
      const noise = () => Math.round((random() - 0.5) * 12);
      return [shade + noise(), shade - 2 + noise(), shade - 5 + noise(), 255];
    });
    source.rect(200, 120, 240, 240, BLUE);
    const jpeg = await source.jpeg(70);
    const original = await decode(jpeg);
    const result = await cut(jpeg);
    const { left, top } = result.crop;

    // Pixel-preserving: the product's interior is exactly what the JPEG decodes to.
    for (let y = 130; y < 350; y += 11) {
      for (let x = 210; x < 430; x += 11) expect(at(result.pixels, x - left, y - top)).toEqual(at(original, x, y));
    }
    // And the backdrop is gone, specks and all.
    let opaqueOutside = 0;
    for (let y = 0; y < result.info.height; y += 1) {
      for (let x = 0; x < result.info.width; x += 1) {
        const ox = x + left;
        const oy = y + top;
        const inside = ox >= 197 && ox < 443 && oy >= 117 && oy < 363;
        if (!inside && at(result.pixels, x, y)[3] > 0) opaqueOutside += 1;
      }
    }
    expect(opaqueOutside).toBe(0);
  });

  it("cuts the thin white frame round a product that fills the picture — a margin is a backdrop too", async () => {
    // The product fills all but a 15 px white frame: 11.6% removed, under the 15% minimum,
    // and every removed pixel within 15 px of the edge (amendment "Thin margins and white bezels").
    const source = new Canvas(500, 500).rect(15, 15, 470, 470, RED);
    const result = await cut(await source.png());
    const { left, top } = result.crop;
    expect(at(result.pixels, 7 - left, 7 - top)[3]).toBe(0);
    expect(at(result.pixels, 250 - left, 250 - top)).toEqual(RED);
  });

  it("refuses a small cut that reaches deep into the picture: no backdrop worth removing", async () => {
    // A 3 px margin and a narrow white slot from the top edge to the middle: 8% removed, 40% deep.
    const source = new Canvas(500, 500).rect(3, 3, 494, 494, RED).rect(220, 0, 60, 250, WHITE);
    expect(await cleanImage(await source.png())).toEqual({ ok: false, note: "little_background" });
  });

  it("refuses a product that comes out as a speck (the removed share catches it first)", async () => {
    const source = new Canvas(800, 800).rect(390, 390, 40, 40, RED);
    expect(await cleanImage(await source.png())).toEqual({ ok: false, note: "product_removed" });
  });

  it("refuses a sliver: a product box too thin to be the machine", async () => {
    // A full-width strip 9% tall: under the removed-share ceiling, under the side minimum.
    const source = new Canvas(1000, 1000).rect(0, 450, 1000, 90, RED);
    expect(await cleanImage(await source.png())).toEqual({ ok: false, note: "product_too_small" });
  });

  it("refuses a product that falls apart into many large pieces", async () => {
    const source = new Canvas(800, 800);
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) source.rect(80 + col * 240, 80 + row * 240, 120, 120, RED);
    }
    expect(await cleanImage(await source.png())).toEqual({ ok: false, note: "fragmented" });
  });

  it("cuts nothing from a picture that is not on a plain backdrop", async () => {
    const source = new Canvas(500, 500, [40, 40, 40, 255]).rect(150, 150, 200, 200, RED);
    expect(await cleanImage(await source.png())).toEqual({ ok: false, note: "busy_background" });
  });

  it("answers failed, never throws, when the bytes are not an image or sharp is missing", async () => {
    expect(await cleanImage(new TextEncoder().encode("not an image"))).toEqual({ ok: false, note: "failed" });
    const png = await new Canvas(400, 400).rect(100, 100, 200, 200, RED).png();
    expect(await cleanImage(png, { loadSharp: async () => null })).toEqual({ ok: false, note: "failed" });
  });
});

/**
 * Thin margins and white bezels (gateway spec amendment of 2026-10-07): the
 * catalogue's iPad kept its white corners because its cut was never kept, and
 * a white bezel is the colour of the backdrop. The inputs are JPEG fixtures in
 * `test/fixtures/cutout/` (made from `test/images/tablet.ts`); each has a
 * `-before-after.png` beside it — the old cutout's result left, this one's
 * right, on a dark backdrop.
 */
describe("cleanImage — thin margins and white bezels", () => {
  const FIXTURES = join(__dirname, "../../../../test/fixtures/cutout");
  const fixture = (variant: TabletVariant) => new Uint8Array(readFileSync(join(FIXTURES, `${variant}.jpg`)));

  /** Opaque, near-white pixels left in the backdrop: outside the tablet's rounded outline, in source coordinates. */
  function remnants(result: Awaited<ReturnType<typeof cut>>, variant: TabletVariant): number {
    const o = TABLET_VARIANTS[variant];
    const [l, t, r, b] = [o.margin, o.margin, o.width - 1 - o.margin, o.height - 1 - o.margin];
    let count = 0;
    for (let y = 0; y < result.info.height; y += 1) {
      for (let x = 0; x < result.info.width; x += 1) {
        const sx = x + result.crop.left;
        const sy = y + result.crop.top;
        const cx = Math.min(Math.max(sx, l + o.radius), r - o.radius);
        const cy = Math.min(Math.max(sy, t + o.radius), b - o.radius);
        // Outside the outline by more than a pixel (the feathered ring may sit on it).
        const outside = sx < l - 1 || sx > r + 1 || sy < t - 1 || sy > b + 1 || Math.hypot(sx - cx, sy - cy) > o.radius + 1.5;
        const [red, green, blue, alpha] = at(result.pixels, x, y);
        if (outside && alpha > 96 && red > 225 && green > 225 && blue > 225) count += 1;
      }
    }
    return count;
  }

  it("cuts a space-grey tablet that fills the frame, its white corners and hairline margin gone", async () => {
    const bytes = fixture("spaceGreyThinMargin");
    // Its edge is inside the classifier's band; the outermost ring says plain.
    expect(await classifyBackground(bytes)).toBe("plain");
    const result = await cut(bytes);
    expect(at(result.pixels, 0, 0)[3]).toBe(0);
    expect(at(result.pixels, result.info.width - 1, result.info.height - 1)[3]).toBe(0);
    expect(remnants(result, "spaceGreyThinMargin")).toBe(0);
    // The bezel is the original's own (decoded) pixels.
    const original = await decode(bytes);
    expect(at(result.pixels, 20 - result.crop.left, 280 - result.crop.top)).toEqual(at(original, 20, 280));
  });

  it("keeps a white bezel held by its silver rim, and takes the white corners round it", async () => {
    const bytes = fixture("whiteBezelThinMargin");
    const result = await cut(bytes);
    expect(remnants(result, "whiteBezelThinMargin")).toBe(0);
    // The bezel — the backdrop's own colour — is opaque and white.
    for (const [x, y] of [[20, 280], [200, 20], [200, 540], [380, 280]]) {
      const [r, g, b, a] = at(result.pixels, x - result.crop.left, y - result.crop.top);
      expect({ x, y, a, white: r > 240 && g > 240 && b > 240 }).toEqual({ x, y, a: 255, white: true });
    }
  });

  it("stops at a white bezel's faint outline instead of eating the bezel (the old fill walked through it)", async () => {
    const bytes = fixture("whiteBezelFaintOutline");
    const result = await cut(bytes);
    // The 48 px margin is gone…
    expect(at(result.pixels, 0, 0)[3]).toBe(0);
    expect(remnants(result, "whiteBezelFaintOutline")).toBe(0);
    // …and the bezel all round the screen is kept.
    for (const [x, y] of [[70, 280], [200, 70], [200, 490], [330, 280]]) {
      const [r, g, b, a] = at(result.pixels, x - result.crop.left, y - result.crop.top);
      expect({ x, y, a, white: r > 240 && g > 240 && b > 240 }).toEqual({ x, y, a: 255, white: true });
    }
  });

  it("a faint outline stops the fill even without JPEG: only a gradient step crosses the band between core and drift", () => {
    // 254 backdrop, a 2 px outline at 230 (40 away), a 250 bezel inside it.
    const canvas = new Canvas(200, 200, [254, 254, 254, 255]).rect(40, 40, 120, 120, [230, 230, 232, 255]).rect(42, 42, 116, 116, [250, 250, 250, 255]);
    const cutout = floodFillCutout({ data: canvas.data, width: 200, height: 200 });
    expect(cutout.backdrop[100 * 200 + 100]).toBe(0); // the bezel's middle
    expect(cutout.backdrop[100 * 200 + 43]).toBe(0); // the bezel beside the outline
    expect(cutout.backdrop[100 * 200 + 20]).toBe(1); // the backdrop
  });
});

describe("takeFringe", () => {
  /** One row: backdrop at the left, then the pixels given, as drifts from the backdrop. */
  function row(drifts: number[]) {
    const width = drifts.length;
    const backdrop = new Uint8Array(width);
    backdrop[0] = 1;
    return { backdrop, drift: Float32Array.from(drifts), width };
  }

  it("takes a blend between the backdrop and a darker edge, at most two rings deep", () => {
    const { backdrop, drift, width } = row([0, 12, 30, 38, 200, 200]);
    takeFringe(backdrop, drift, width, 1);
    // 12 then 30 are blends (each lighter than the pixel inside it); 38 would be a third ring.
    expect([...backdrop]).toEqual([1, 1, 1, 0, 0, 0]);
  });

  it("keeps an outline darker than what it encloses, and a flat white bezel", () => {
    const outline = row([0, 35, 8, 8, 8]);
    takeFringe(outline.backdrop, outline.drift, outline.width, 1);
    expect([...outline.backdrop]).toEqual([1, 0, 0, 0, 0]);
    const flat = row([0, 6, 6, 6, 200]);
    takeFringe(flat.backdrop, flat.drift, flat.width, 1);
    expect([...flat.backdrop]).toEqual([1, 0, 0, 0, 0]);
  });

  it("never takes a pixel further than the fill tolerance from the backdrop", () => {
    const { backdrop, drift, width } = row([0, 45, 200]);
    takeFringe(backdrop, drift, width, 1);
    expect([...backdrop]).toEqual([1, 0, 0]);
  });
});

describe("validateCutout", () => {
  const box = { left: 100, top: 100, right: 299, bottom: 299 };

  it("keeps a sane cut and names the first rule a bad one breaks", () => {
    const base = { backdrop: new Uint8Array(0), backdropColour: [255, 255, 255] as [number, number, number], largePieces: 1, box };
    expect(validateCutout({ ...base, removedShare: 0.5 }, 400, 400)).toBeNull();
    expect(validateCutout({ ...base, removedShare: 0.1 }, 400, 400)).toBe("little_background");
    // A margin: under the minimum, but shallow and not nothing.
    expect(validateCutout({ ...base, removedShare: 0.1, marginDepth: 0.03 }, 400, 400)).toBeNull();
    expect(validateCutout({ ...base, removedShare: 0.1, marginDepth: 0.2 }, 400, 400)).toBe("little_background");
    expect(validateCutout({ ...base, removedShare: 0.005, marginDepth: 0.01 }, 400, 400)).toBe("little_background");
    expect(validateCutout({ ...base, removedShare: 0.95 }, 400, 400)).toBe("product_removed");
    expect(validateCutout({ ...base, removedShare: 0.5, box: null }, 400, 400)).toBe("product_removed");
    expect(validateCutout({ ...base, removedShare: 0.5, largePieces: 6 }, 400, 400)).toBe("fragmented");
    expect(validateCutout({ ...base, removedShare: 0.5, box: { left: 0, top: 0, right: 399, bottom: 20 } }, 400, 400)).toBe(
      "product_too_small"
    );
  });
});

// @vitest-environment node
import { Canvas, decode, seeded, type Rgba } from "../../../../test/images/synthetic";
import { inspectImage } from "../../images/inspect";
import { cleanPickedImage } from "./pick-clean";

/**
 * The picked image, cleaned at approval (amendment "The picked image is
 * cleaned too"): the same deterministic crop and cutout rank 1 gets, from what
 * research recorded — or classified on the spot — and the original bytes
 * untouched when nothing can be cut. Synthetic images, real `sharp`.
 */

const BLUE: Rgba = [30, 60, 160, 255];
const ORANGE: Rgba = [240, 110, 30, 255];

async function original(canvas: Canvas) {
  const bytes = await canvas.png();
  const info = inspectImage(bytes);
  if (!info) throw new Error("the synthetic PNG did not inspect");
  return { bytes, info };
}

/** A product on a plain white backdrop. */
function onWhite(): Canvas {
  return new Canvas(600, 450).rect(150, 100, 300, 250, BLUE);
}

/** A product on a noisy backdrop — nothing a flood fill can take. */
function onNoise(): Canvas {
  const random = seeded(7);
  return new Canvas(600, 450)
    .paint(() => {
      const v = Math.round(random() * 200);
      return [v, 255 - v, (v * 3) % 256, 255];
    })
    .rect(150, 100, 300, 250, BLUE);
}

describe("cleanPickedImage", () => {
  it("cuts a plain backdrop away, as rank 1's copy would be", async () => {
    const picked = await cleanPickedImage(await original(onWhite()), { background: "plain" });

    expect(picked).toMatchObject({ cleaned: "cut", note: null });
    expect(picked.info).toMatchObject({ format: "image/png", hasAlpha: true });
    const pixels = await decode(picked.bytes);
    expect(pixels.data[3]).toBe(0); // the corner is transparent now
  });

  it("classifies a candidate recorded without a background, then cuts it", async () => {
    const picked = await cleanPickedImage(await original(onWhite()), {});

    expect(picked.cleaned).toBe("cut");
    expect((await decode(picked.bytes)).data[3]).toBe(0);
  });

  it("gives a busy backdrop with no box back as the original bytes, with the reason", async () => {
    const source = await original(onNoise());
    const picked = await cleanPickedImage(source, { background: "busy" });

    expect(picked).toEqual({ ...source, cleaned: null, note: "busy_background" });
  });

  it("crops a banner to its product box, and cuts the crop", async () => {
    const canvas = new Canvas(1000, 1000);
    canvas.rect(30, 20, 940, 120, ORANGE).rect(300, 300, 400, 400, BLUE).rect(30, 800, 940, 150, ORANGE);
    const picked = await cleanPickedImage(await original(canvas), {
      background: "plain",
      composite: true,
      productBox: [0.3, 0.3, 0.7, 0.7],
    });

    expect(picked.cleaned).toBe("cropped_and_cut");
    const pixels = await decode(picked.bytes);
    expect(pixels.width).toBeLessThan(500);
    for (let p = 0; p < pixels.data.length; p += 4) {
      const orange = pixels.data[p] === ORANGE[0] && pixels.data[p + 1] === ORANGE[1] && pixels.data[p + 2] === ORANGE[2];
      expect(orange && pixels.data[p + 3] > 0).toBe(false);
    }
  });

  it("keeps an already transparent picture as it is", async () => {
    const canvas = new Canvas(400, 300, [0, 0, 0, 0]).rect(100, 80, 200, 140, BLUE);
    const bytes = await canvas.png({ alpha: true });
    const source = { bytes, info: inspectImage(bytes)! };

    expect(await cleanPickedImage(source, {})).toEqual({ ...source, cleaned: null, note: null });
  });

  it("answers the original, unchanged, when sharp cannot be loaded", async () => {
    const source = await original(onWhite());
    const picked = await cleanPickedImage(source, { background: "plain" }, { loadSharp: async () => null });

    expect(picked.bytes).toBe(source.bytes);
    expect(picked.cleaned).toBeNull();
  });
});

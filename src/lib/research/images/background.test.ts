// @vitest-environment node
import { Canvas, seeded } from "../../../../test/images/synthetic";
import { classifyBackground } from "./background";

/**
 * The background classifier (gateway spec, amendment "No generative redraw:
 * deterministic cutout"): transparent, plain or busy, read from the border band
 * of synthetic images built with `sharp`.
 */

const RED: [number, number, number, number] = [200, 30, 30, 255];

describe("classifyBackground", () => {
  it("calls a product on white plain", async () => {
    const image = new Canvas(600, 450).rect(150, 100, 300, 250, RED);
    expect(await classifyBackground(await image.png())).toBe("plain");
  });

  it("calls a JPEG-noisy off-white backdrop with a soft gradient plain", async () => {
    const random = seeded(7);
    const image = new Canvas(640, 480).paint((x, y) => {
      const shade = 244 - Math.round((y / 480) * 14); // a soft studio sweep
      const noise = () => Math.round((random() - 0.5) * 12);
      return [shade + noise(), shade - 2 + noise(), shade - 6 + noise(), 255];
    });
    image.rect(200, 120, 240, 240, [30, 60, 160, 255]);
    expect(await classifyBackground(await image.jpeg(70))).toBe("plain");
  });

  it("calls a light-grey backdrop plain, and tolerates a product touching the frame", async () => {
    const image = new Canvas(500, 500, [214, 214, 214, 255]).rect(180, 150, 140, 350, RED);
    expect(await classifyBackground(await image.png())).toBe("plain");
  });

  it("calls an already cut-out PNG transparent", async () => {
    const image = new Canvas(500, 500, [0, 0, 0, 0]).rect(100, 100, 300, 300, RED);
    expect(await classifyBackground(await image.png({ alpha: true }))).toBe("transparent");
  });

  it("does not call an opaque PNG with an alpha channel transparent", async () => {
    const image = new Canvas(500, 500).rect(100, 100, 300, 300, RED);
    expect(await classifyBackground(await image.png({ alpha: true }))).toBe("plain");
  });

  it("calls noise busy", async () => {
    const random = seeded(3);
    const image = new Canvas(500, 400).paint(() => [
      Math.round(random() * 255),
      Math.round(random() * 255),
      Math.round(random() * 255),
      255,
    ]);
    expect(await classifyBackground(await image.png())).toBe("busy");
  });

  it("calls a dark-to-light gradient busy", async () => {
    const image = new Canvas(600, 400).paint((x) => {
      const v = Math.round((x / 599) * 255);
      return [v, v, v, 255];
    });
    expect(await classifyBackground(await image.png())).toBe("busy");
  });

  it("calls a wooden table busy", async () => {
    const random = seeded(11);
    const image = new Canvas(600, 400).paint((x, y) => {
      const grain = Math.sin(y / 3 + Math.sin(x / 40) * 2) * 25 + (random() - 0.5) * 20;
      return [Math.round(150 + grain), Math.round(100 + grain * 0.7), Math.round(60 + grain * 0.4), 255];
    });
    image.rect(200, 100, 200, 200, RED);
    expect(await classifyBackground(await image.png())).toBe("busy");
  });

  it("calls a dark studio backdrop busy (the cutout only removes light backdrops)", async () => {
    const image = new Canvas(500, 500, [25, 25, 28, 255]).rect(150, 150, 200, 200, [230, 230, 230, 255]);
    expect(await classifyBackground(await image.png())).toBe("busy");
  });

  it("answers null when sharp is missing or the bytes are not an image", async () => {
    const image = await new Canvas(400, 400).png();
    expect(await classifyBackground(image, { loadSharp: async () => null })).toBeNull();
    expect(await classifyBackground(new TextEncoder().encode("not an image"))).toBeNull();
  });
});

// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { siteConfig } from "../site-config";
import { APPLE_ICON_SIZE, CARD_LOGO_SIZE, renderAppleIcon, renderSiteCard, SITE_CARD_SIZE } from "./site-card";

/**
 * The site card and the apple icon actually draw — fonts, logo and all —
 * as PNGs of the declared size. (`next/og` fails at request time, not build
 * time, on markup its renderer does not support, so this is the check.)
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe("share images", () => {
  it("draws the 1200×630 site card as a PNG small enough for WhatsApp", async () => {
    const response = await renderSiteCard();
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(response.headers.get("content-type")).toBe("image/png");
    expect([...bytes.slice(0, 4)]).toEqual(PNG_SIGNATURE);
    expect(pngSize(bytes)).toEqual(SITE_CARD_SIZE);
    expect(bytes.byteLength).toBeLessThan(600_000);
    if (process.env.SHARE_CARD_OUT) {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(process.env.SHARE_CARD_OUT, bytes);
    }
  });

  it("has the logo's PNG to draw, at the proportions the card gives it", () => {
    // A missing file would not fail the card (it falls back to type), so this is the check.
    const bytes = new Uint8Array(readFileSync(join(process.cwd(), "public", siteConfig.logoPng)));
    expect([...bytes.slice(0, 4)]).toEqual(PNG_SIGNATURE);
    const { width, height } = pngSize(bytes);
    expect(width / height).toBeCloseTo(CARD_LOGO_SIZE.width / CARD_LOGO_SIZE.height, 1);
    expect(width).toBeGreaterThanOrEqual(CARD_LOGO_SIZE.width);
  });

  it("draws the 180×180 apple icon", async () => {
    const bytes = new Uint8Array(await renderAppleIcon().arrayBuffer());

    expect([...bytes.slice(0, 4)]).toEqual(PNG_SIGNATURE);
    expect(pngSize(bytes)).toEqual(APPLE_ICON_SIZE);
  });
});

// @vitest-environment node
import { APPLE_ICON_SIZE, renderAppleIcon, renderSiteCard, SITE_CARD_SIZE } from "./site-card";

/**
 * The site card and the apple icon actually draw — fonts, wordmark and all —
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

  it("draws the 180×180 apple icon", async () => {
    const bytes = new Uint8Array(await renderAppleIcon().arrayBuffer());

    expect([...bytes.slice(0, 4)]).toEqual(PNG_SIGNATURE);
    expect(pngSize(bytes)).toEqual(APPLE_ICON_SIZE);
  });
});

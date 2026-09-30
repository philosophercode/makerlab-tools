import { create } from "qrcode";
import { DEFAULT_LABEL_STYLE, QR_QUIET_MODULES, layoutLabel } from "./label-layout";
import { labelSvg } from "./label-svg";
import { labelContentFor } from "./labels";
import { qrMatrix, qrPathData, qrSvg } from "./matrix";

/**
 * The drawing is a pure function of `qrcode`'s matrix, so it is checked by
 * reading the modules back out of the path (no decoder), as the kiosk's QR
 * test does.
 */

function modulesFromPath(d: string, size: number, offset: number): boolean[] {
  const dark = new Array<boolean>(size * size).fill(false);
  for (const match of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    const [col, row, run] = [Number(match[1]) - offset, Number(match[2]) - offset, Number(match[3])];
    for (let index = 0; index < run; index++) dark[row * size + col + index] = true;
  }
  return dark;
}

const URL = "https://makerlab-ai.vercel.app/tools/form-4?src=qr";

describe("qrMatrix / qrPathData", () => {
  it("draws exactly qrcode's modules at level H", () => {
    const matrix = qrMatrix(URL);
    const reference = create(URL, { errorCorrectionLevel: "H" }).modules;
    expect(matrix.size).toBe(reference.size);
    expect(modulesFromPath(qrPathData(matrix, 4), matrix.size, 4)).toEqual(Array.from(reference.data, Boolean));
  });

  it("level M is a smaller symbol than H for the same address", () => {
    expect(qrMatrix(URL, "M").size).toBeLessThan(qrMatrix(URL, "H").size);
  });
});

describe("qrSvg", () => {
  it("is black on white with a four-module quiet zone and a title", () => {
    const svg = qrSvg(URL, { title: "QR code: <Form 4>" });
    const size = qrMatrix(URL).size + 8;
    expect(svg).toContain(`viewBox="0 0 ${size} ${size}"`);
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain("<title>QR code: &lt;Form 4&gt;</title>");
  });
});

describe("labelSvg", () => {
  it("is the label's physical size in millimetres, with its code at the layout's scale", () => {
    const content = labelContentFor({ slug: "form-4", name: "Form 4 & Co" }, "https://makerlab-ai.vercel.app");
    const layout = layoutLabel(DEFAULT_LABEL_STYLE, content);
    const svg = labelSvg(layout, content.url, { wordmarkHref: "/makerlab-wordmark.png" });
    expect(svg).toMatch(/^<svg [^>]*width="50.8mm" height="50.8mm" viewBox="0 0 50.8 50.8"/);
    expect(svg).toContain("FORM 4 &amp; CO");
    expect(svg).toContain('href="/makerlab-wordmark.png"');
    const modules = qrMatrix(content.url, layout.level).size + QR_QUIET_MODULES * 2;
    expect(svg).toContain(`scale(${Math.round((layout.qr.size / modules) * 1e6) / 1e6})`);
  });

  it("writes the lab's name when there is no wordmark image", () => {
    const content = labelContentFor({ slug: "form-4", name: "Form 4" }, "https://x.test");
    const svg = labelSvg(layoutLabel(DEFAULT_LABEL_STYLE, content), content.url, { wordmarkText: "MakerLAB" });
    expect(svg).toContain(">MakerLAB</text>");
    expect(svg).not.toContain("<image");
  });
});

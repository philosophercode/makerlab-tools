// @vitest-environment node
import { create } from "qrcode";
import { kioskAskUrl } from "./params";
import { kioskQrSvg } from "./qr";

/**
 * The kiosk's QR code encodes exactly `askUrl` (kiosk spec §10).
 *
 * No decoding library is installed, so the check runs the other way and is
 * just as strict: the SVG's modules are read back out of its path and must be
 * the module matrix `qrcode` computes for `askUrl` itself — a code for any
 * other text would differ in its data modules. The segment `qrcode` built is
 * checked to hold the URL byte for byte.
 */

/** The filled modules of `qrcode`'s SVG path (`M x y` / `m dx dy` / `h n`, one row per half-module offset). */
function modulesFromSvg(svg: string): boolean[][] {
  const size = Number(svg.match(/viewBox="0 0 (\d+) \d+"/)?.[1]);
  const grid = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const d = svg.match(/ d="([^"]+)"/)?.[1] ?? "";
  let x = 0;
  let y = 0;
  for (const [, op, a, b] of d.matchAll(/([Mmh])(-?[\d.]+)(?: (-?[\d.]+))?/g)) {
    const n = Number(a);
    if (op === "M") {
      x = n;
      y = Number(b) - 0.5;
    } else if (op === "m") {
      x += n;
      y += Number(b);
    } else {
      for (let i = 0; i < n; i++) grid[y][x + i] = true;
      x += n;
    }
  }
  return grid;
}

function modulesFor(text: string): boolean[][] {
  const { modules } = create(text, { errorCorrectionLevel: "M" });
  return Array.from({ length: modules.size }, (_, row) => Array.from({ length: modules.size }, (_, col) => Boolean(modules.get(row, col))));
}

describe("kioskAskUrl", () => {
  it("opens the catalogue with the assistant, marked as a kiosk scan, and carries nothing else", () => {
    expect(kioskAskUrl("https://makerlab-ai.vercel.app")).toBe("https://makerlab-ai.vercel.app/?src=kiosk&ask=1");
    expect(kioskAskUrl("https://makerlab-ai.vercel.app/")).toBe("https://makerlab-ai.vercel.app/?src=kiosk&ask=1");
  });
});

describe("kioskQrSvg", () => {
  const url = kioskAskUrl("https://makerlab-ai.vercel.app");

  it("draws the QR code for askUrl, module for module", async () => {
    const svg = await kioskQrSvg(url);
    expect(modulesFromSvg(svg)).toEqual(modulesFor(url));
  });

  it("is not the code for a different address", async () => {
    const svg = await kioskQrSvg(url);
    expect(modulesFromSvg(svg)).not.toEqual(modulesFor(kioskAskUrl("https://example.org")));
  });

  it("encodes the URL's bytes in its data segment", () => {
    const { segments } = create(url, { errorCorrectionLevel: "M" });
    const text = segments.map((segment) => Buffer.from((segment as unknown as { data: Uint8Array }).data).toString("utf8")).join("");
    expect(text).toBe(url);
  });

  it("takes its colours from the page: modules in currentColor, no background of its own", async () => {
    const svg = await kioskQrSvg(url);
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).not.toMatch(/#fff|#ffffff|fill="#/i);
  });
});

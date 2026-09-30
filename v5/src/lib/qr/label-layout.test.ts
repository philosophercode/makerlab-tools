import { labelContentFor } from "./labels";
import {
  DEFAULT_LABEL_STYLE,
  DEFAULT_SHEET,
  LABEL_PRESETS,
  MIN_QR_MM,
  PAPER_SIZES,
  ellipsize,
  estimateTextWidth,
  layoutLabel,
  packSheet,
  pageCount,
  wrapText,
  type LabelStyle,
} from "./label-layout";

const content = labelContentFor({ slug: "trotec-speedy-400", name: "Trotec Speedy 400", room: "Laser Room", zone: "Laser Bay" }, "https://makerlab-ai.vercel.app");
const style = (patch: Partial<LabelStyle> = {}): LabelStyle => ({ ...DEFAULT_LABEL_STYLE, ...patch });

describe("packSheet — how many labels fit", () => {
  // 10 mm margins and 4 mm gaps (the defaults): Letter's printable area is
  // 195.9 × 259.4 mm, A4's 190 × 277 mm.
  it.each([
    ["1in", "letter", 6, 8],
    ["1.5in", "letter", 4, 6],
    ["2in", "letter", 3, 4],
    ["3in", "letter", 2, 3],
    ["1in", "a4", 6, 9],
    ["1.5in", "a4", 4, 6],
    ["2in", "a4", 3, 5],
    ["3in", "a4", 2, 3],
  ] as const)("%s labels on %s: %i × %i", (preset, paper, cols, rows) => {
    const size = LABEL_PRESETS.find((entry) => entry.id === preset)!;
    const grid = packSheet({ ...DEFAULT_SHEET, paper }, size.widthMm, size.heightMm);
    expect([grid.cols, grid.rows, grid.perPage]).toEqual([cols, rows, cols * rows]);
    expect(grid.cells).toHaveLength(cols * rows);
    expect([grid.pageWidthMm, grid.pageHeightMm]).toEqual([PAPER_SIZES[paper].widthMm, PAPER_SIZES[paper].heightMm]);
  });

  it("keeps every label inside the margins, the gap between neighbours, and the grid centred", () => {
    const sheet = { ...DEFAULT_SHEET, paper: "letter" as const };
    const grid = packSheet(sheet, 50.8, 50.8);
    for (const cell of grid.cells) {
      expect(cell.x).toBeGreaterThanOrEqual(sheet.marginMm - 1e-9);
      expect(cell.y).toBeGreaterThanOrEqual(sheet.marginMm - 1e-9);
      expect(cell.x + 50.8).toBeLessThanOrEqual(PAPER_SIZES.letter.widthMm - sheet.marginMm + 1e-9);
      expect(cell.y + 50.8).toBeLessThanOrEqual(PAPER_SIZES.letter.heightMm - sheet.marginMm + 1e-9);
    }
    expect(grid.cells[1].x - grid.cells[0].x).toBeCloseTo(50.8 + sheet.gapMm, 9);
    const left = grid.cells[0].x;
    const right = PAPER_SIZES.letter.widthMm - (grid.cells[grid.cols - 1].x + 50.8);
    expect(left).toBeCloseTo(right, 9);
  });

  it("fits exactly-fitting labels despite floating point", () => {
    // 4 × 45 + 3 × 5 = 195 mm across a 195 mm printable width.
    const grid = packSheet({ paper: "letter", marginMm: (215.9 - 195) / 2, gapMm: 5, cutGuides: false }, 45, 45);
    expect(grid.cols).toBe(4);
  });

  it("puts one label on a page of its own size for a label printer", () => {
    const grid = packSheet({ ...DEFAULT_SHEET, paper: "label" }, 62, 29);
    expect(grid).toMatchObject({ pageWidthMm: 62, pageHeightMm: 29, perPage: 1, cells: [{ x: 0, y: 0 }] });
  });

  it("fits none when the label is larger than the printable area", () => {
    expect(packSheet({ ...DEFAULT_SHEET, paper: "letter" }, 200, 50).perPage).toBe(0);
    expect(pageCount(10, 0)).toBe(0);
  });

  it("counts pages", () => {
    expect(pageCount(0, 12)).toBe(0);
    expect(pageCount(12, 12)).toBe(1);
    expect(pageCount(13, 12)).toBe(2);
  });
});

describe("layoutLabel — physical dimensions", () => {
  it.each(LABEL_PRESETS.map((preset) => [preset.id, preset.widthMm] as const))("%s: the label is its size and everything is inside it", (_id, size) => {
    const layout = layoutLabel(style({ widthMm: size, heightMm: size }), content);
    expect([layout.widthMm, layout.heightMm]).toEqual([size, size]);
    expect(layout.orientation).toBe("stacked");
    expect(layout.qr.x).toBeGreaterThan(0);
    expect(layout.qr.y).toBeGreaterThan(0);
    expect(layout.qr.x + layout.qr.size).toBeLessThan(size);
    expect(layout.qr.y + layout.qr.size).toBeLessThan(size);
    for (const line of layout.lines) {
      expect(line.y).toBeGreaterThan(layout.qr.y + layout.qr.size);
      expect(line.y).toBeLessThan(size);
      expect(estimateTextWidth(line.text, line.sizePt, line.bold) / (72 / 25.4)).toBeLessThanOrEqual(size);
    }
  });

  it("gives a 2-inch label a code above the spec's 25 mm floor, at level H", () => {
    const layout = layoutLabel(style(), content);
    expect(layout.qr.size).toBeGreaterThanOrEqual(MIN_QR_MM);
    expect(layout.qrSmall).toBe(false);
    expect(layout.level).toBe("H");
    expect(layout.lines.map((line) => line.kind)).toEqual(["name", "extra", "url"]);
    expect(layout.lines[0].text).toBe("TROTEC SPEEDY 400");
    expect(layout.lines.at(-1)?.text).toBe("makerlab-ai.vercel.app/tools/trotec-speedy-400");
  });

  it("warns on a small code and uses fewer, larger modules (level M)", () => {
    const layout = layoutLabel(style({ widthMm: 25.4, heightMm: 25.4 }), content);
    expect(layout.qr.size).toBeLessThan(MIN_QR_MM);
    expect(layout.qrSmall).toBe(true);
    expect(layout.level).toBe("M");
  });

  it("drops the least important text first when the code would be too small, never the name", () => {
    const layout = layoutLabel(style({ widthMm: 25.4, heightMm: 25.4, showLocation: true }), content);
    expect(layout.dropped[0]).toBe("url");
    expect(layout.dropped).not.toContain("name");
    expect(layout.lines.some((line) => line.kind === "name")).toBe(true);
    expect(layout.qr.size).toBeGreaterThanOrEqual(25.4 * 0.45 - 1e-9);
  });

  it("puts the text beside the code on a wide label", () => {
    const layout = layoutLabel(style({ widthMm: 76.2, heightMm: 25.4 }), content);
    expect(layout.orientation).toBe("side");
    expect(layout.qr.size).toBeCloseTo(25.4 - 2 * layout.qr.x, 9);
    for (const line of layout.lines) expect(line.x).toBeGreaterThan(layout.qr.x + layout.qr.size);
  });

  it("draws only what is switched on", () => {
    const bare = layoutLabel(style({ showName: false, showBrand: false, showUrl: false, extraText: "" }), content);
    expect(bare.lines).toEqual([]);
    expect(bare.brand).toBeNull();
    // With nothing else on it the code takes the whole label less its padding.
    expect(bare.qr.size).toBeGreaterThan(50.8 * 0.85);
  });
});

describe("wrapText / ellipsize", () => {
  it("wraps to the width and ends a text that does not fit in an ellipsis", () => {
    const lines = wrapText("PRUSA ORIGINAL MK4S INPUT SHAPER EDITION WITH ENCLOSURE", 60, 8, true, 2, estimateTextWidth);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith("…")).toBe(true);
    for (const line of lines) expect(estimateTextWidth(line, 8, true)).toBeLessThanOrEqual(60);
  });

  it("breaks a single word too long for the line", () => {
    const lines = wrapText("SUPERCALIFRAGILISTICEXPIALIDOCIOUS", 40, 8, true, 3, estimateTextWidth);
    expect(lines.length).toBeGreaterThan(1);
  });

  it("leaves a fitting text alone", () => {
    expect(ellipsize("Form 4", 100, 8, false, estimateTextWidth)).toBe("Form 4");
    expect(wrapText("Form 4", 100, 8, false, 2, estimateTextWidth)).toEqual(["Form 4"]);
  });
});

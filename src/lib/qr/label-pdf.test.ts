// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { buildLabelSheetPdf, pdfSafeText } from "./label-pdf";
import { DEFAULT_LABEL_STYLE, DEFAULT_SHEET, PT_PER_MM, type LabelStyle } from "./label-layout";
import { labelContentFor } from "./labels";

/**
 * The print sheets as a real PDF: page sizes in points exactly as Letter / A4
 * / the label, as many labels per page as `packSheet` says, pages for the
 * rest — read back with `pdf-lib` itself.
 */

const labels = Array.from({ length: 30 }, (_, index) =>
  labelContentFor({ slug: `tool-${index}`, name: `Tool ${index}`, room: "Main Lab", zone: "Bench" }, "https://makerlab-ai.vercel.app")
);
const style = (patch: Partial<LabelStyle> = {}): LabelStyle => ({ ...DEFAULT_LABEL_STYLE, ...patch });
const brandPng = readFileSync(join(process.cwd(), "public", "brand", "cornell-tech-makerlab-logo.png"));

async function pages(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => page.getSize());
}

describe("buildLabelSheetPdf", () => {
  it("packs 2-inch labels twelve to a Letter page, at Letter's size in points", async () => {
    const bytes = await buildLabelSheetPdf({ labels, style: style(), sheet: DEFAULT_SHEET, brandPng });
    const sizes = await pages(bytes);
    expect(sizes).toHaveLength(3); // 30 labels, 12 a page
    for (const size of sizes) {
      expect(size.width).toBeCloseTo(612, 6);
      expect(size.height).toBeCloseTo(792, 6);
    }
  });

  it("uses A4 when asked", async () => {
    const bytes = await buildLabelSheetPdf({ labels: labels.slice(0, 15), style: style(), sheet: { ...DEFAULT_SHEET, paper: "a4" } });
    const sizes = await pages(bytes);
    expect(sizes).toHaveLength(1); // 15 a page on A4
    expect(sizes[0].width).toBeCloseTo(210 * PT_PER_MM, 2);
    expect(sizes[0].height).toBeCloseTo(297 * PT_PER_MM, 2);
  });

  it("makes one page per label at the label's own size for a label printer", async () => {
    const bytes = await buildLabelSheetPdf({ labels: labels.slice(0, 3), style: style({ widthMm: 62, heightMm: 29 }), sheet: { ...DEFAULT_SHEET, paper: "label" } });
    const sizes = await pages(bytes);
    expect(sizes).toHaveLength(3);
    expect(sizes[0].width).toBeCloseTo(62 * PT_PER_MM, 2);
    expect(sizes[0].height).toBeCloseTo(29 * PT_PER_MM, 2);
  });

  it("writes each tool's name and titles the document", async () => {
    const bytes = await buildLabelSheetPdf({ labels: labels.slice(0, 1), style: style(), sheet: DEFAULT_SHEET, title: "MakerLAB QR labels" });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getTitle()).toBe("MakerLAB QR labels");
    expect(doc.getPageCount()).toBe(1);
  });

  it("embeds the logo once for the whole sheet, and writes the lab's name when the brand image is not a PNG", async () => {
    const withLogo = await buildLabelSheetPdf({ labels: labels.slice(0, 12), style: style(), sheet: DEFAULT_SHEET, brandPng });
    const without = await buildLabelSheetPdf({ labels: labels.slice(0, 12), style: style(), sheet: DEFAULT_SHEET });
    // One embedded copy for twelve labels: the sheet grows by about the PNG's size, not twelve times it.
    expect(withLogo.byteLength - without.byteLength).toBeLessThan(brandPng.byteLength * 1.5);

    const notPng = new TextEncoder().encode("<!doctype html><title>Not found</title>");
    const fallback = await buildLabelSheetPdf({ labels: labels.slice(0, 1), style: style(), sheet: DEFAULT_SHEET, brandPng: notPng });
    expect((await PDFDocument.load(fallback)).getPageCount()).toBe(1);
  });

  it("refuses a label that cannot fit on the page", async () => {
    await expect(buildLabelSheetPdf({ labels, style: style({ widthMm: 200, heightMm: 200 }), sheet: DEFAULT_SHEET })).rejects.toThrow("label_too_large");
  });
});

describe("pdfSafeText", () => {
  it("keeps WinAnsi text, drops accents the font lacks, and marks the rest", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    expect(pdfSafeText("Café Lathe — 3/4″", font)).toBe("Café Lathe — 3/4?");
    expect(pdfSafeText("Łódź 雷射", font)).toBe("?ódz ??");
    expect(pdfSafeText("Spawarka ą ę", font)).toBe("Spawarka a e");
  });
});

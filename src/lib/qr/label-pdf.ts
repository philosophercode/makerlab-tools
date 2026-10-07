import { PDFDocument, StandardFonts, grayscale, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import {
  PT_PER_MM,
  QR_QUIET_MODULES,
  layoutLabel,
  packSheet,
  type LabelContent,
  type LabelLayout,
  type LabelStyle,
  type MeasureText,
  type SheetSetup,
} from "./label-layout.ts";
import { qrMatrix, qrPathData } from "./matrix.ts";

/**
 * The print sheets: every label laid out by `layoutLabel` and packed by
 * `packSheet`, drawn into a real PDF with `pdf-lib` — as many labels as fit on
 * each Letter or A4 page, or one label per page at its own size for a label
 * printer. Coordinates are millimetres converted to points exactly, so a
 * sheet printed at 100 % ("Actual size") measures what the styler said.
 *
 * Runs in the browser (the admin page builds the file on the click, no
 * round trip) and in Node (tests, the sample script). Type is Helvetica, a
 * standard PDF font — nothing embedded, nothing fetched — whose WinAnsi
 * character set is the one limit: a character outside it is written as its
 * unaccented form, or "?".
 */

export interface LabelSheetInput {
  labels: LabelContent[];
  style: LabelStyle;
  sheet: SheetSetup;
  /**
   * The brand image's bytes: the lab's logo as a PNG (`siteConfig.logoPng`).
   * Without them, or when they are not a PNG, the lab's name is written instead.
   */
  brandPng?: Uint8Array | ArrayBuffer | null;
  brandText?: string;
  /** The document title. */
  title?: string;
}

export interface HelveticaFonts {
  regular: PDFFont;
  bold: PDFFont;
}

/** Makes `text` drawable in `font`: accents dropped where the font lacks the letter, anything else "?". */
export function pdfSafeText(text: string, font: PDFFont): string {
  const supported = new Set(font.getCharacterSet());
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 63;
    if (supported.has(code)) {
      out += char;
      continue;
    }
    const plain = char.normalize("NFKD").replace(/[̀-ͯ]/g, "");
    out += plain && [...plain].every((c) => supported.has(c.codePointAt(0) ?? 0)) ? plain : "?";
  }
  return out;
}

/** Helvetica's real widths, for `layoutLabel`. */
export function helveticaMeasure(fonts: HelveticaFonts): MeasureText {
  return (text, sizePt, bold) => {
    const font = bold ? fonts.bold : fonts.regular;
    return font.widthOfTextAtSize(pdfSafeText(text, font), sizePt);
  };
}

export async function embedHelvetica(doc: PDFDocument): Promise<HelveticaFonts> {
  const [regular, bold] = await Promise.all([doc.embedFont(StandardFonts.Helvetica), doc.embedFont(StandardFonts.HelveticaBold)]);
  return { regular, bold };
}

/** A measure with Helvetica's metrics, for a caller that is not building a PDF (the preview). */
export async function loadHelveticaMeasure(): Promise<MeasureText> {
  const doc = await PDFDocument.create();
  return helveticaMeasure(await embedHelvetica(doc));
}

function drawLabel(
  page: PDFPage,
  layout: LabelLayout,
  qrText: string,
  origin: { x: number; y: number },
  fonts: HelveticaFonts,
  brandImage: PDFImage | null,
  brandText: string
) {
  const pageHeight = page.getHeight();
  const px = (mm: number) => (origin.x + mm) * PT_PER_MM;
  const py = (mm: number) => pageHeight - (origin.y + mm) * PT_PER_MM;

  const matrix = qrMatrix(qrText, layout.level);
  const modules = matrix.size + QR_QUIET_MODULES * 2;
  const modulePt = (layout.qr.size / modules) * PT_PER_MM;
  // drawSvgPath places the path's (0, 0) at (x, y) with y running down, as in SVG.
  page.drawSvgPath(qrPathData(matrix, QR_QUIET_MODULES), {
    x: px(layout.qr.x),
    y: py(layout.qr.y),
    scale: modulePt,
    color: rgb(0, 0, 0),
    borderWidth: 0,
  });

  if (layout.brand) {
    const { x, y, width, height } = layout.brand;
    if (brandImage) {
      page.drawImage(brandImage, { x: px(x), y: py(y + height), width: width * PT_PER_MM, height: height * PT_PER_MM });
    } else {
      // The name, as tall as the box allows and never wider than it.
      const text = pdfSafeText(brandText, fonts.bold);
      const size = Math.min(height * PT_PER_MM * 0.95, (width * PT_PER_MM) / Math.max(fonts.bold.widthOfTextAtSize(text, 1), 1e-6));
      const textWidth = fonts.bold.widthOfTextAtSize(text, size);
      const left = layout.orientation === "side" ? px(x) : px(x + width / 2) - textWidth / 2;
      page.drawText(text, { x: left, y: py(y + height * 0.85), size, font: fonts.bold, color: rgb(0, 0, 0) });
    }
  }

  for (const line of layout.lines) {
    const font = line.bold ? fonts.bold : fonts.regular;
    const text = pdfSafeText(line.text, font);
    const width = font.widthOfTextAtSize(text, line.sizePt);
    const left = line.anchor === "middle" ? px(line.x) - width / 2 : px(line.x);
    page.drawText(text, { x: left, y: py(line.y), size: line.sizePt, font, color: rgb(0, 0, 0) });
  }
}

/** The sheets as PDF bytes. Refuses (throws) when a label cannot fit on the page at all. */
export async function buildLabelSheetPdf(input: LabelSheetInput): Promise<Uint8Array> {
  const { labels, style, sheet } = input;
  const grid = packSheet(sheet, style.widthMm, style.heightMm);
  if (grid.perPage === 0) throw new Error("label_too_large");

  const doc = await PDFDocument.create();
  doc.setTitle(input.title ?? "QR labels");
  doc.setCreator("MakerLAB Tools");
  doc.setProducer("MakerLAB Tools");
  const fonts = await embedHelvetica(doc);
  const measure = helveticaMeasure(fonts);
  // A file that is not a PNG (a logo set to a JPEG, an HTML error page) is the missing-image case.
  const brandImage = input.brandPng ? await doc.embedPng(input.brandPng).catch(() => null) : null;
  const brandText = input.brandText ?? "MakerLAB";

  // To a thousandth of a point, so Letter is exactly 612 × 792 (a printer
  // matching paper by size should not see 612.0000000000001).
  const toPt = (mm: number) => Math.round(mm * PT_PER_MM * 1000) / 1000;
  const pageSize: [number, number] = [toPt(grid.pageWidthMm), toPt(grid.pageHeightMm)];
  let page: PDFPage | null = null;
  labels.forEach((label, index) => {
    const slot = index % grid.perPage;
    if (slot === 0) page = doc.addPage(pageSize);
    const current = page as unknown as PDFPage;
    const cell = grid.cells[slot];
    if (sheet.cutGuides && sheet.paper !== "label") {
      current.drawRectangle({
        x: cell.x * PT_PER_MM,
        y: current.getHeight() - (cell.y + style.heightMm) * PT_PER_MM,
        width: style.widthMm * PT_PER_MM,
        height: style.heightMm * PT_PER_MM,
        borderColor: grayscale(0.72),
        borderWidth: 0.35,
        borderDashArray: [2, 2],
      });
    }
    drawLabel(current, layoutLabel(style, label, measure), label.url, cell, fonts, brandImage, brandText);
  });
  if (labels.length === 0) doc.addPage(pageSize);
  return doc.save();
}

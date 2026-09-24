import { buildPdf, type PdfLine, type PdfPage } from "./build-pdf.ts";

/**
 * The manual-text fixture PDFs (manual text spec §10), as data. `generate.ts`
 * writes them to this folder; the tests read the committed files, so a change
 * here means running `node --experimental-strip-types test/fixtures/manuals/generate.ts`
 * from `v5/` and committing the result.
 *
 * Every text page carries a running header and a page-number footer, so the
 * extractor's header/footer removal is exercised by all of them.
 */

const HEADER = "Acme Laser 40 - User Manual";

/** A body paragraph set as lines, top down from `top`. */
function body(lines: string[], top: number, size = 11): PdfLine[] {
  return lines.map((text, i) => ({ text, y: top - i * (size + 4), size }));
}

function framed(pageNumber: number, content: PdfLine[]): PdfPage {
  return {
    lines: [{ text: HEADER, y: 760, size: 9 }, ...content, { text: `Page ${pageNumber}`, y: 40, size: 9, x: 290 }],
  };
}

const INTRO = [
  "The Acme Laser 40 is a desktop CO2 laser cutter for wood, acrylic, card",
  "and fabric. This manual covers setup, daily use and routine care. Read the",
  "whole manual before the first job, and keep it beside the machine for calibra-",
  "tion and cleaning reference.",
];

const SPECS = [
  "Work area: 400 x 300 mm",
  "Laser power: 40 W CO2 tube",
  "Maximum engraving speed: 600 mm/s",
  "Positioning accuracy: 0.01 mm",
  "Supported files: SVG, DXF, PDF, PNG",
  "Weight: 32 kg",
];

const ELECTRICAL = [
  "Input voltage: 110-120 V AC, 60 Hz",
  "Rated current: 5 A",
  "Connect the machine to a grounded outlet on its own circuit. Do not use an",
  "extension cord.",
];

const CARE = [
  "Clean the lens and mirrors every 20 hours of cutting with the supplied wipes.",
  "Empty the crumb tray weekly and check the exhaust hose for blockages. Replace",
  "the air filter when the indicator turns red.",
];

/** Four pages with bookmarks: Introduction, Specifications › Electrical, Maintenance. */
export function outlinePdf(): Uint8Array {
  return buildPdf({
    title: "Acme Laser 40 User Manual",
    pages: [
      framed(1, [{ text: "Introduction", y: 700, size: 18 }, ...body(INTRO, 670)]),
      framed(2, [{ text: "Specifications", y: 700, size: 18 }, ...body(SPECS, 670)]),
      framed(3, [{ text: "Electrical", y: 700, size: 14 }, ...body(ELECTRICAL, 670)]),
      framed(4, [{ text: "Maintenance", y: 700, size: 18 }, ...body(CARE, 670)]),
    ],
    outline: [
      { title: "Introduction", page: 1 },
      { title: "Specifications", page: 2, children: [{ title: "Electrical", page: 3 }] },
      { title: "Maintenance", page: 4 },
    ],
  });
}

/** Three pages, no bookmarks: 20 pt chapter headings and 15 pt section headings over 11 pt body text, and a 24 pt title used once. */
export function noOutlinePdf(): Uint8Array {
  return buildPdf({
    pages: [
      framed(1, [{ text: "Acme Laser 40", y: 730, size: 24 }, { text: "Getting started", y: 700, size: 20 }, ...body(INTRO, 670)]),
      framed(2, [
        { text: "Technical data", y: 700, size: 20 },
        { text: "Machine", y: 670, size: 15 },
        ...body(SPECS, 645),
      ]),
      framed(3, [
        { text: "Care and cleaning", y: 700, size: 20 },
        { text: "Lens and mirrors", y: 670, size: 15 },
        ...body(CARE, 645),
      ]),
    ],
  });
}

/** Four pages labelled i, ii, 3-1, 3-2. */
export function pageLabelsPdf(): Uint8Array {
  return buildPdf({
    pages: [
      framed(1, body(INTRO, 700)),
      framed(2, body(CARE, 700)),
      framed(3, body(SPECS, 700)),
      framed(4, body(ELECTRICAL, 700)),
    ],
    pageLabels: [
      { startPage: 1, style: "r" },
      { startPage: 3, style: "D", prefix: "3-" },
    ],
  });
}

/** Three pages that are pictures with a scanner's stamp — no text layer to speak of. */
export function scannedPdf(): Uint8Array {
  return buildPdf({
    pages: [1, 2, 3].map((n) => ({ picture: true, lines: [{ text: `Scan ${n}`, y: 40, size: 8 }] })),
  });
}

/** A Standard-security PDF whose user password is not empty. */
export function encryptedPdf(): Uint8Array {
  return buildPdf({ pages: [framed(1, body(INTRO, 700))], encrypted: true });
}

/** A PDF header and then nothing a parser can use. */
export function corruptPdf(): Uint8Array {
  return new Uint8Array(Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 9 0 R\nthis is not a pdf\n", "latin1"));
}

export const FIXTURES = {
  "outline.pdf": outlinePdf,
  "no-outline.pdf": noOutlinePdf,
  "page-labels.pdf": pageLabelsPdf,
  "scanned.pdf": scannedPdf,
  "encrypted.pdf": encryptedPdf,
  "corrupt.pdf": corruptPdf,
} as const;

export type FixtureName = keyof typeof FIXTURES;

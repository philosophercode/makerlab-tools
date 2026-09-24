/**
 * A minimal PDF writer for the manual-text fixtures (manual text spec §10).
 *
 * No dependency: it writes the handful of objects a text PDF needs — a
 * catalog, a page tree, pages whose content streams place Helvetica text at a
 * given size and position, and optionally an outline (bookmarks), page labels
 * and an `/Encrypt` dictionary — with a correct cross-reference table, so
 * pdf.js opens it without repairing anything.
 *
 * `scripts`-style module: relative imports only, runs under
 * `node --experimental-strip-types` (see `generate.ts`) and under Vitest.
 */

export interface PdfLine {
  text: string;
  /** Font size in points. Default 11. */
  size?: number;
  /** Left edge, points from the page's left. Default 72. */
  x?: number;
  /** Baseline, points from the page's bottom. */
  y: number;
}

export interface PdfPage {
  lines?: PdfLine[];
  /** Draw a filled grey rectangle instead of (or beside) text — a stand-in for a scanned image. */
  picture?: boolean;
}

export interface PdfOutlineItem {
  title: string;
  /** 1-based page the bookmark opens. */
  page: number;
  children?: PdfOutlineItem[];
}

export interface PdfPageLabelRange {
  /** 1-based first page of the range. */
  startPage: number;
  /** `r` lower roman, `D` decimal. */
  style: "r" | "D";
  /** Printed prefix, e.g. "3-". */
  prefix?: string;
  /** First number of the range. Default 1. */
  start?: number;
}

export interface BuildPdfOptions {
  pages: PdfPage[];
  outline?: PdfOutlineItem[];
  pageLabels?: PdfPageLabelRange[];
  /** Adds a Standard-security `/Encrypt` dictionary whose user password is not empty. */
  encrypted?: boolean;
  title?: string;
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

export function buildPdf(options: BuildPdfOptions): Uint8Array {
  const objects: string[] = [];
  // Reserve ids: 1 catalog, 2 page tree, 3 font.
  const reserve = () => {
    objects.push("");
    return objects.length;
  };
  const catalogId = reserve();
  const pagesId = reserve();
  const fontId = reserve();
  objects[fontId - 1] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";

  const pageIds: number[] = [];
  for (const page of options.pages) {
    const contentId = reserve();
    const pageId = reserve();
    const stream = contentStream(page);
    objects[contentId - 1] = `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
    objects[pageId - 1] =
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    pageIds.push(pageId);
  }
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let catalogExtra = "";
  if (options.outline && options.outline.length > 0) {
    const outlineId = writeOutline(options.outline, objects, pageIds);
    catalogExtra += ` /Outlines ${outlineId} 0 R /PageMode /UseOutlines`;
  }
  if (options.pageLabels && options.pageLabels.length > 0) {
    const nums = options.pageLabels
      .map((range) => {
        const prefix = range.prefix ? ` /P (${escapeText(range.prefix)})` : "";
        const start = range.start && range.start !== 1 ? ` /St ${range.start}` : "";
        return `${range.startPage - 1} << /S /${range.style}${prefix}${start} >>`;
      })
      .join(" ");
    catalogExtra += ` /PageLabels << /Nums [${nums}] >>`;
  }
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R${catalogExtra} >>`;

  let infoId: number | null = null;
  if (options.title) {
    infoId = reserve();
    objects[infoId - 1] = `<< /Title (${escapeText(options.title)}) >>`;
  }
  let encryptId: number | null = null;
  if (options.encrypted) {
    encryptId = reserve();
    // RC4 40-bit, revision 2. /U is not the hash of the empty password, so
    // opening it needs a password nobody has.
    const o = "<" + "4F".repeat(32) + ">";
    const u = "<" + "55".repeat(32) + ">";
    objects[encryptId - 1] = `<< /Filter /Standard /V 1 /R 2 /Length 40 /O ${o} /U ${u} /P -44 >>`;
  }

  let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  const id = "<" + "0123456789ABCDEF".repeat(2) + ">";
  const trailerExtra =
    (infoId ? ` /Info ${infoId} 0 R` : "") + (encryptId ? ` /Encrypt ${encryptId} 0 R /ID [${id} ${id}]` : "");
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R${trailerExtra} >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}

function contentStream(page: PdfPage): string {
  const parts: string[] = [];
  if (page.picture) parts.push("0.6 g 72 200 468 450 re f 0 g");
  for (const line of page.lines ?? []) {
    const size = line.size ?? 11;
    parts.push(`BT /F1 ${size} Tf 1 0 0 1 ${line.x ?? 72} ${line.y} Tm (${escapeText(line.text)}) Tj ET`);
  }
  return parts.join("\n");
}

/** Writes the outline tree; returns the `/Outlines` dictionary's id. */
function writeOutline(items: PdfOutlineItem[], objects: string[], pageIds: number[]): number {
  objects.push("");
  const rootId = objects.length;

  const writeLevel = (level: PdfOutlineItem[], parentId: number): { first: number; last: number; count: number } => {
    const ids = level.map(() => {
      objects.push("");
      return objects.length;
    });
    let total = 0;
    level.forEach((item, i) => {
      const id = ids[i];
      let kids = "";
      if (item.children && item.children.length > 0) {
        const child = writeLevel(item.children, id);
        kids = ` /First ${child.first} 0 R /Last ${child.last} 0 R /Count ${child.count}`;
        total += child.count;
      }
      const prev = i > 0 ? ` /Prev ${ids[i - 1]} 0 R` : "";
      const next = i < ids.length - 1 ? ` /Next ${ids[i + 1]} 0 R` : "";
      const pageRef = pageIds[item.page - 1];
      objects[id - 1] =
        `<< /Title (${escapeText(item.title)}) /Parent ${parentId} 0 R${prev}${next}${kids} ` +
        `/Dest [${pageRef} 0 R /XYZ 0 ${PAGE_HEIGHT} 0] >>`;
      total += 1;
    });
    return { first: ids[0], last: ids[ids.length - 1], count: total };
  };

  const top = writeLevel(items, rootId);
  objects[rootId - 1] = `<< /Type /Outlines /First ${top.first} 0 R /Last ${top.last} 0 R /Count ${top.count} >>`;
  return rootId;
}

function escapeText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

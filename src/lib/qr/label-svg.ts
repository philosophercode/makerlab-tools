import { PT_PER_MM, QR_QUIET_MODULES, estimateTextWidth, type LabelLayout } from "./label-layout.ts";
import { qrMatrix, qrPathData } from "./matrix.ts";

/**
 * One label as an SVG whose user unit is the millimetre and whose `width` /
 * `height` say so (`50.8mm`), so it prints at its real size from any program
 * that honours them. The admin preview draws exactly this, and the label's
 * SVG download is this with the logo inlined.
 *
 * Client-safe. Type is Helvetica, with Arial (metric-compatible) behind it, so
 * the lines the layout measured with Helvetica's metrics fit as measured.
 */

export const LABEL_FONT_FAMILY = "Helvetica, Arial, 'Liberation Sans', sans-serif";

export interface LabelSvgOptions {
  /**
   * The brand image, the lab's logo as a PNG (`siteConfig.logoPng`): a path
   * for the preview, a data: URI for a file that travels.
   */
  brandHref?: string | null;
  /** Written for the lab's own name when there is no brand image. */
  brandText?: string;
  /** Draw the label's edge (the preview on a page that is itself white). */
  outline?: boolean;
  /** Accessible name. */
  title?: string;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/** The label's contents (no `<svg>` wrapper), in millimetre units from (0, 0). */
export function labelSvgBody(layout: LabelLayout, qrText: string, options: LabelSvgOptions = {}): string {
  const parts: string[] = [];
  parts.push(`<rect width="${round(layout.widthMm)}" height="${round(layout.heightMm)}" fill="#ffffff"/>`);
  if (options.outline) {
    parts.push(
      `<rect x="0.1" y="0.1" width="${round(layout.widthMm - 0.2)}" height="${round(layout.heightMm - 0.2)}" fill="none" stroke="#c8c8c8" stroke-width="0.2"/>`
    );
  }

  const matrix = qrMatrix(qrText, layout.level);
  const modules = matrix.size + QR_QUIET_MODULES * 2;
  const scale = layout.qr.size / modules;
  parts.push(
    `<path transform="translate(${round(layout.qr.x)} ${round(layout.qr.y)}) scale(${Math.round(scale * 1e6) / 1e6})" fill="#000000" shape-rendering="crispEdges" d="${qrPathData(matrix, QR_QUIET_MODULES)}"/>`
  );

  if (layout.brand) {
    const { x, y, width, height } = layout.brand;
    if (options.brandHref) {
      parts.push(
        `<image href="${escapeXml(options.brandHref)}" x="${round(x)}" y="${round(y)}" width="${round(width)}" height="${round(height)}" preserveAspectRatio="xMidYMid meet"/>`
      );
    } else {
      // The name, as tall as the box allows and never wider than it (estimated: no fonts here).
      const text = options.brandText ?? "MakerLAB";
      const size = Math.min(height * 0.95, width / Math.max(estimateTextWidth(text, 1, true), 1e-6));
      const anchor = layout.orientation === "side" ? "start" : "middle";
      const tx = anchor === "middle" ? x + width / 2 : x;
      parts.push(
        `<text x="${round(tx)}" y="${round(y + height * 0.85)}" font-family="${LABEL_FONT_FAMILY}" font-weight="700" font-size="${round(size)}" text-anchor="${anchor}" fill="#000000">${escapeXml(text)}</text>`
      );
    }
  }

  for (const line of layout.lines) {
    parts.push(
      `<text x="${round(line.x)}" y="${round(line.y)}" font-family="${LABEL_FONT_FAMILY}" font-weight="${line.bold ? 700 : 400}" font-size="${round(line.sizePt / PT_PER_MM)}" text-anchor="${line.anchor}" fill="#000000">${escapeXml(line.text)}</text>`
    );
  }
  return parts.join("");
}

/** A standalone label SVG at its physical size. */
export function labelSvg(layout: LabelLayout, qrText: string, options: LabelSvgOptions = {}): string {
  const w = round(layout.widthMm);
  const h = round(layout.heightMm);
  const title = options.title ? `<title>${escapeXml(options.title)}</title>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">${title}${labelSvgBody(layout, qrText, options)}</svg>`;
}

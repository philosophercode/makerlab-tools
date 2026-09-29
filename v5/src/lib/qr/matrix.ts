import { create } from "qrcode";

/**
 * A QR code as its modules, and the drawing every surface shares: the tool
 * page's dialog and the API (a standalone SVG), the admin preview and label
 * SVG, and the PDF sheets (one path of filled runs). Drawing the modules
 * ourselves, rather than taking `qrcode`'s own SVG, is what lets the label
 * place the code at an exact physical size and the PDF draw the same path.
 *
 * Client-safe: `qrcode`'s `create` is pure, and its browser build ships it.
 */

export type QrErrorLevel = "L" | "M" | "Q" | "H";

export interface QrMatrix {
  /** Modules per side, without a quiet zone. */
  size: number;
  /** Row-major; true is a dark module. */
  dark: boolean[];
}

/**
 * Level H by default: labels live on machines that get knocked, wiped and
 * scuffed, and H survives ~30 % damage (QR codes spec §6).
 */
export function qrMatrix(text: string, level: QrErrorLevel = "H"): QrMatrix {
  const code = create(text, { errorCorrectionLevel: level });
  const { size, data } = code.modules;
  return { size, dark: Array.from(data, (value) => Boolean(value)) };
}

/**
 * SVG path data for the dark modules in module units, starting at
 * (`offset`, `offset`): one `M x y h n v 1 h -n z` per horizontal run, so a
 * 45-module code is a few hundred short commands, not two thousand squares.
 * Filled with the non-zero rule the runs never overlap under.
 */
export function qrPathData(matrix: QrMatrix, offset = 0): string {
  const parts: string[] = [];
  for (let row = 0; row < matrix.size; row++) {
    let col = 0;
    while (col < matrix.size) {
      if (!matrix.dark[row * matrix.size + col]) {
        col++;
        continue;
      }
      let run = 1;
      while (col + run < matrix.size && matrix.dark[row * matrix.size + col + run]) run++;
      parts.push(`M${col + offset} ${row + offset}h${run}v1h-${run}z`);
      col += run;
    }
  }
  return parts.join("");
}

export interface QrSvgOptions {
  level?: QrErrorLevel;
  /** Quiet zone in modules; 4 is the standard's (a code on its own needs it). */
  margin?: number;
  /** Dark module colour. */
  dark?: string;
  /** Background; `null` for transparent. */
  light?: string | null;
  /** Accessible name, written as the SVG's `<title>`. */
  title?: string;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * A standalone code: black on white with a four-module quiet zone, drawn in
 * module units with `shape-rendering="crispEdges"`, so it scales to any size
 * without blurred edges. What `GET /api/qr/<slug>?format=svg` answers.
 */
export function qrSvg(text: string, { level = "H", margin = 4, dark = "#000000", light = "#ffffff", title }: QrSvgOptions = {}): string {
  const matrix = qrMatrix(text, level);
  const side = matrix.size + margin * 2;
  const background = light ? `<rect width="${side}" height="${side}" fill="${light}"/>` : "";
  const heading = title ? `<title>${escapeXml(title)}</title>` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" width="${side * 8}" height="${side * 8}" shape-rendering="crispEdges">` +
    `${heading}${background}<path fill="${dark}" d="${qrPathData(matrix, margin)}"/></svg>`
  );
}

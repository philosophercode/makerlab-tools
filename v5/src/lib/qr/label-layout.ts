import type { QrErrorLevel } from "./matrix.ts";

/**
 * Label geometry (QR labels, admin print sheets). Pure numbers, millimetres
 * throughout with the origin at the top-left, so one layout is drawn three
 * ways — the admin preview and the label SVG (`label-svg.ts`) and the PDF
 * sheets (`label-pdf.ts`) — and a label printed at 100 % measures what the
 * styler said.
 *
 * Client-safe and dependency-free.
 */

export const MM_PER_IN = 25.4;
export const PT_PER_MM = 72 / MM_PER_IN;

/**
 * The spec's floor for a code (QR codes spec §6): smaller than this stops
 * reading once it has been wiped down a few times. The styler warns under it
 * rather than refusing — a 1" sticker on a hand tool is still worth having.
 */
export const MIN_QR_MM = 25;

/** Square presets, the sizes sticker stock comes in. */
export const LABEL_PRESETS = [
  { id: "1in", widthMm: 25.4, heightMm: 25.4 },
  { id: "1.5in", widthMm: 38.1, heightMm: 38.1 },
  { id: "2in", widthMm: 50.8, heightMm: 50.8 },
  { id: "3in", widthMm: 76.2, heightMm: 76.2 },
] as const;
export type LabelPresetId = (typeof LABEL_PRESETS)[number]["id"];

/** The bounds a custom size is clamped to: a code still fits, and a label still fits on A4. */
export const LABEL_MIN_MM = 15;
export const LABEL_MAX_MM = 200;

export interface LabelStyle {
  widthMm: number;
  heightMm: number;
  showName: boolean;
  showLocation: boolean;
  /** One optional line of the lab's own words ("Scan for manual & help"); empty for none. */
  extraText: string;
  /** The MakerLAB wordmark. */
  showBrand: boolean;
  /** The short address under the code, for a camera that will not scan. */
  showUrl: boolean;
}

export const DEFAULT_LABEL_STYLE: LabelStyle = {
  widthMm: 50.8,
  heightMm: 50.8,
  showName: true,
  showLocation: false,
  extraText: "Scan for manual & help",
  showBrand: true,
  showUrl: true,
};

export const EXTRA_TEXT_MAX = 60;

/** What one label says. */
export interface LabelContent {
  name: string;
  /** "Room / Zone", or "" when the tool has none. */
  location: string;
  /** What the code encodes (`toolQrTargetUrl`). */
  url: string;
  /** The address as printed under the code (`displayUrl`). */
  shortUrl: string;
}

export type LineKind = "name" | "location" | "extra" | "url";
/** What can be left off a label that is too small for it, in the order it is dropped. */
export type DroppableKind = LineKind | "brand";

export interface LayoutLine {
  kind: LineKind;
  text: string;
  /** The anchor: the centre for `middle`, the left edge for `start`. */
  x: number;
  /** Baseline. */
  y: number;
  sizePt: number;
  bold: boolean;
  anchor: "middle" | "start";
}

export interface LabelLayout {
  widthMm: number;
  heightMm: number;
  orientation: "stacked" | "side";
  /** The code's box; its quiet zone is inside it ({@link QR_QUIET_MODULES}). */
  qr: { x: number; y: number; size: number };
  level: QrErrorLevel;
  brand: { x: number; y: number; width: number; height: number } | null;
  lines: LayoutLine[];
  /** What would not fit and was left off. */
  dropped: DroppableKind[];
  /** The code is under {@link MIN_QR_MM}. */
  qrSmall: boolean;
}

/** Quiet zone drawn inside the code's box, in modules; the label's padding adds to it. */
export const QR_QUIET_MODULES = 2;

/** The wordmark's aspect ratio (`public/makerlab-wordmark.png`, 475 × 79). */
export const WORDMARK_ASPECT = 475 / 79;

/**
 * Text width in points. The PDF passes Helvetica's real metrics; the browser
 * preview draws in Helvetica/Arial (metric-compatible), so the estimate here
 * is only the fallback before those load.
 */
export type MeasureText = (text: string, sizePt: number, bold: boolean) => number;

export const estimateTextWidth: MeasureText = (text, sizePt, bold) => {
  let em = 0;
  for (const char of text) {
    if (char === " ") em += 0.278;
    else if (/[A-Z0-9]/.test(char)) em += bold ? 0.7 : 0.64;
    else if (/[a-z]/.test(char)) em += bold ? 0.58 : 0.52;
    else if (/[.,:;'!|il]/.test(char)) em += 0.28;
    else em += 0.6;
  }
  return em * sizePt;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const ptToMm = (pt: number) => pt / PT_PER_MM;

/**
 * Words into at most `maxLines` lines no wider than `maxWidthPt`; a word too
 * long for a line is broken, and text that still does not fit ends in "…".
 */
export function wrapText(text: string, maxWidthPt: number, sizePt: number, bold: boolean, maxLines: number, measure: MeasureText): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || maxLines < 1) return [];
  const fits = (candidate: string) => measure(candidate, sizePt, bold) <= maxWidthPt;
  const lines: string[] = [];
  let current = "";
  let index = 0;
  while (index < words.length) {
    const word = words[index];
    const candidate = current ? `${current} ${word}` : word;
    if (fits(candidate)) {
      current = candidate;
      index++;
      continue;
    }
    if (!current) {
      // One word wider than the line: break it where it stops fitting.
      let cut = word.length - 1;
      while (cut > 1 && !fits(word.slice(0, cut))) cut--;
      lines.push(word.slice(0, cut));
      words[index] = word.slice(cut);
    } else {
      lines.push(current);
      current = "";
    }
    if (lines.length === maxLines) break;
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
    current = "";
  }
  const leftOver = index < words.length || current !== "";
  if (leftOver && lines.length > 0) lines[lines.length - 1] = ellipsize(lines[lines.length - 1], maxWidthPt, sizePt, bold, measure, true);
  return lines;
}

/** Shortens `text` until it fits with "…" after it (or always adds one when `force`). */
export function ellipsize(text: string, maxWidthPt: number, sizePt: number, bold: boolean, measure: MeasureText, force = false): string {
  if (!force && measure(text, sizePt, bold) <= maxWidthPt) return text;
  let cut = text.length;
  while (cut > 0 && measure(`${text.slice(0, cut).trimEnd()}…`, sizePt, bold) > maxWidthPt) cut--;
  return `${text.slice(0, cut).trimEnd()}…`;
}

interface Block {
  kind: LineKind;
  lines: string[];
  sizePt: number;
  bold: boolean;
  /**
   * Lines the block takes even when its text needs fewer — the name keeps
   * room for two, so every code on a sheet is the same size whether a
   * tool's name wraps or not.
   */
  reserveLines?: number;
}

function lineHeightMm(sizePt: number): number {
  return ptToMm(sizePt * 1.18);
}

function blockHeight(block: Block, reserve = false): number {
  const lines = reserve ? Math.max(block.lines.length, block.reserveLines ?? 0) : block.lines.length;
  return lines * lineHeightMm(block.sizePt);
}

/** Type sizes for a label whose short side is `shortMm`. */
export function typeScale(shortMm: number) {
  const namePt = clamp(2.6 + 0.13 * shortMm, 5, 14);
  return {
    namePt,
    smallPt: clamp(namePt * 0.7, 4.2, 10),
    brandHeightMm: clamp(shortMm * 0.07, 1.8, 5.5),
    padMm: clamp(shortMm * 0.06, 1.2, 4),
  };
}

const DROP_ORDER: DroppableKind[] = ["url", "location", "extra", "brand"];

/**
 * Lay out one label. The code gets whatever the text leaves; when that is
 * under 45 % of the label's short side, the least important text is dropped
 * (the address, then the location, the extra line, the wordmark — never the
 * name) and the caller says so. A label at least 1.4 times as wide as it is
 * tall puts the text beside the code.
 */
export function layoutLabel(style: LabelStyle, content: LabelContent, measure: MeasureText = estimateTextWidth): LabelLayout {
  const widthMm = style.widthMm;
  const heightMm = style.heightMm;
  if (widthMm / heightMm >= 1.4) {
    const side = layoutSide(style, content, measure);
    if (side) return side;
  }
  return layoutStacked(style, content, measure);
}

function blocksFor(style: LabelStyle, content: LabelContent, widthPt: number, namePt: number, smallPt: number, measure: MeasureText, dropped: Set<DroppableKind>): Block[] {
  const blocks: Block[] = [];
  const name = content.name.trim().toUpperCase();
  if (style.showName && name) blocks.push({ kind: "name", lines: wrapText(name, widthPt, namePt, true, 2, measure), sizePt: namePt, bold: true, reserveLines: 2 });
  if (style.showLocation && content.location.trim() && !dropped.has("location")) {
    blocks.push({ kind: "location", lines: [ellipsize(content.location.trim(), widthPt, smallPt, false, measure)], sizePt: smallPt, bold: false });
  }
  const extra = style.extraText.trim().slice(0, EXTRA_TEXT_MAX);
  if (extra && !dropped.has("extra")) blocks.push({ kind: "extra", lines: wrapText(extra, widthPt, smallPt, false, 2, measure), sizePt: smallPt, bold: false });
  if (style.showUrl && content.shortUrl && !dropped.has("url")) {
    // An address is not wrapped: shrink it to fit, then shorten it.
    let size = smallPt;
    while (size > 4 && measure(content.shortUrl, size, false) > widthPt) size -= 0.25;
    blocks.push({ kind: "url", lines: [ellipsize(content.shortUrl, widthPt, size, false, measure)], sizePt: size, bold: false });
  }
  return blocks.filter((block) => block.lines.length > 0);
}

function droppable(style: LabelStyle, content: LabelContent, dropped: Set<DroppableKind>): DroppableKind | null {
  const present: Record<DroppableKind, boolean> = {
    url: style.showUrl && Boolean(content.shortUrl),
    location: style.showLocation && Boolean(content.location.trim()),
    extra: Boolean(style.extraText.trim()),
    brand: style.showBrand,
    name: false,
  };
  return DROP_ORDER.find((kind) => present[kind] && !dropped.has(kind)) ?? null;
}

function levelFor(qrMm: number): QrErrorLevel {
  // A small code gets fewer, larger modules (M); from the spec's floor up, H.
  return qrMm < MIN_QR_MM ? "M" : "H";
}

function layoutStacked(style: LabelStyle, content: LabelContent, measure: MeasureText): LabelLayout {
  const { widthMm, heightMm } = style;
  const short = Math.min(widthMm, heightMm);
  const { namePt, smallPt, brandHeightMm, padMm } = typeScale(short);
  const innerW = widthMm - padMm * 2;
  const gap = padMm * 0.45;
  const dropped = new Set<DroppableKind>();

  for (;;) {
    const blocks = blocksFor(style, content, innerW * PT_PER_MM, namePt, smallPt, measure, dropped);
    const showBrand = style.showBrand && !dropped.has("brand");
    const brandH = showBrand ? Math.min(brandHeightMm, (innerW * 0.8) / WORDMARK_ASPECT) : 0;
    const textH = blocks.reduce((sum, block) => sum + blockHeight(block, true), 0);
    const fixed = (showBrand ? brandH + gap : 0) + (blocks.length ? gap + textH : 0);
    const qrSize = Math.min(innerW, heightMm - padMm * 2 - fixed);
    const next = droppable(style, content, dropped);
    if (qrSize < short * 0.45 && next) {
      dropped.add(next);
      continue;
    }

    const total = (showBrand ? brandH + gap : 0) + qrSize + (blocks.length ? gap + textH : 0);
    let y = (heightMm - total) / 2;
    const cx = widthMm / 2;
    const brand = showBrand ? { x: cx - (brandH * WORDMARK_ASPECT) / 2, y, width: brandH * WORDMARK_ASPECT, height: brandH } : null;
    if (showBrand) y += brandH + gap;
    const qr = { x: cx - qrSize / 2, y, size: qrSize };
    y += qrSize + gap;
    const lines: LayoutLine[] = [];
    for (const block of blocks) {
      const lh = lineHeightMm(block.sizePt);
      // A one-line name sits in the middle of the two lines kept for it.
      const spare = blockHeight(block, true) - blockHeight(block);
      y += spare / 2;
      for (const text of block.lines) {
        // Baseline sits ~80 % down the line box (cap height + a little).
        lines.push({ kind: block.kind, text, x: cx, y: y + lh * 0.8, sizePt: block.sizePt, bold: block.bold, anchor: "middle" });
        y += lh;
      }
      y += spare / 2;
    }
    return { widthMm, heightMm, orientation: "stacked", qr, level: levelFor(qrSize), brand, lines, dropped: [...dropped], qrSmall: qrSize < MIN_QR_MM };
  }
}

function layoutSide(style: LabelStyle, content: LabelContent, measure: MeasureText): LabelLayout | null {
  const { widthMm, heightMm } = style;
  const { namePt, smallPt, brandHeightMm, padMm } = typeScale(heightMm);
  const qrSize = heightMm - padMm * 2;
  const textX = padMm + qrSize + padMm;
  const textW = widthMm - textX - padMm;
  if (textW < 12) return null;
  const gap = padMm * 0.5;
  const dropped = new Set<DroppableKind>();

  for (;;) {
    const blocks = blocksFor(style, content, textW * PT_PER_MM, namePt, smallPt, measure, dropped);
    const showBrand = style.showBrand && !dropped.has("brand");
    const brandH = showBrand ? Math.min(brandHeightMm, (textW * 0.9) / WORDMARK_ASPECT) : 0;
    const textH = blocks.reduce((sum, block) => sum + blockHeight(block), 0) + Math.max(0, blocks.length - 1) * gap * 0.5;
    const total = (showBrand ? brandH + gap : 0) + textH;
    const next = droppable(style, content, dropped);
    if (total > qrSize && next) {
      dropped.add(next);
      continue;
    }
    let y = (heightMm - total) / 2;
    const brand = showBrand ? { x: textX, y, width: brandH * WORDMARK_ASPECT, height: brandH } : null;
    if (showBrand) y += brandH + gap;
    const lines: LayoutLine[] = [];
    blocks.forEach((block, index) => {
      if (index > 0) y += gap * 0.5;
      const lh = lineHeightMm(block.sizePt);
      for (const text of block.lines) {
        lines.push({ kind: block.kind, text, x: textX, y: y + lh * 0.8, sizePt: block.sizePt, bold: block.bold, anchor: "start" });
        y += lh;
      }
    });
    return {
      widthMm,
      heightMm,
      orientation: "side",
      qr: { x: padMm, y: padMm, size: qrSize },
      level: levelFor(qrSize),
      brand,
      lines,
      dropped: [...dropped],
      qrSmall: qrSize < MIN_QR_MM,
    };
  }
}

// ── Sheets ─────────────────────────────────────────────────────────

export const PAPER_SIZES = {
  letter: { widthMm: 215.9, heightMm: 279.4 },
  a4: { widthMm: 210, heightMm: 297 },
} as const;

/** `label` is one label per page at the label's own size — for a label printer. */
export const PAPER_IDS = ["letter", "a4", "label"] as const;
export type PaperId = (typeof PAPER_IDS)[number];

export interface SheetSetup {
  paper: PaperId;
  /** Page margin; most office printers cannot print the outer ~6 mm. */
  marginMm: number;
  /** Space between labels, so a cut never clips a neighbour. */
  gapMm: number;
  /** Light dashed outlines to cut along. */
  cutGuides: boolean;
}

export const DEFAULT_SHEET: SheetSetup = { paper: "letter", marginMm: 10, gapMm: 4, cutGuides: true };
export const SHEET_MARGIN_MAX_MM = 40;
export const SHEET_GAP_MAX_MM = 20;

export interface SheetGrid {
  pageWidthMm: number;
  pageHeightMm: number;
  cols: number;
  rows: number;
  perPage: number;
  /** Each label's top-left, row by row. */
  cells: { x: number; y: number }[];
}

/**
 * How many labels fit on a page, and where: as many columns and rows as the
 * printable area holds with `gapMm` between them, the grid centred so the
 * margins come out even. Zero when a label is larger than the printable area.
 */
export function packSheet(setup: SheetSetup, labelWidthMm: number, labelHeightMm: number): SheetGrid {
  if (setup.paper === "label") {
    return { pageWidthMm: labelWidthMm, pageHeightMm: labelHeightMm, cols: 1, rows: 1, perPage: 1, cells: [{ x: 0, y: 0 }] };
  }
  const paper = PAPER_SIZES[setup.paper];
  const usableW = paper.widthMm - setup.marginMm * 2;
  const usableH = paper.heightMm - setup.marginMm * 2;
  // A hair of tolerance, so 4 × 50.8 mm + gaps is not refused over a rounding error.
  const epsilon = 1e-6;
  const cols = Math.max(0, Math.floor((usableW + setup.gapMm + epsilon) / (labelWidthMm + setup.gapMm)));
  const rows = Math.max(0, Math.floor((usableH + setup.gapMm + epsilon) / (labelHeightMm + setup.gapMm)));
  const gridW = cols * labelWidthMm + Math.max(0, cols - 1) * setup.gapMm;
  const gridH = rows * labelHeightMm + Math.max(0, rows - 1) * setup.gapMm;
  const left = setup.marginMm + (usableW - gridW) / 2;
  const top = setup.marginMm + (usableH - gridH) / 2;
  const cells: { x: number; y: number }[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      cells.push({ x: left + col * (labelWidthMm + setup.gapMm), y: top + row * (labelHeightMm + setup.gapMm) });
    }
  }
  return { pageWidthMm: paper.widthMm, pageHeightMm: paper.heightMm, cols, rows, perPage: cols * rows, cells };
}

/** Pages needed for `count` labels. */
export function pageCount(count: number, perPage: number): number {
  return perPage > 0 ? Math.ceil(count / perPage) : 0;
}

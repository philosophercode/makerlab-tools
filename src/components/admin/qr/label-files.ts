"use client";

import type { LabelContent, LabelLayout, MeasureText } from "../../../lib/qr/label-layout";
import type { QrLabelSettings } from "../../../lib/qr/settings";
import { labelSvg } from "../../../lib/qr/label-svg";

/**
 * What the QR label page does with a finished layout, in the browser: build
 * the PDF (`pdf-lib`, loaded on the first click — no admin who never prints
 * pays for it), print it in one click, save it, and turn one label into an
 * SVG or PNG file. No round trip: the page already has every tool's label
 * content, and the published catalogue is public anyway.
 */

let brandBytes: Promise<Uint8Array | null> | null = null;

/** The brand image's bytes (the logo's PNG), fetched once. Null when it cannot be read: the lab's name is written instead. */
export function loadBrandImage(href: string): Promise<Uint8Array | null> {
  brandBytes ??= fetch(href)
    .then(async (response) => (response.ok ? new Uint8Array(await response.arrayBuffer()) : null))
    .catch(() => null);
  return brandBytes;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

/** The brand image as a data: URI, so a downloaded SVG (and the canvas a PNG is drawn on) carries it. */
export async function brandDataUri(href: string): Promise<string | null> {
  const bytes = await loadBrandImage(href);
  return bytes ? `data:image/png;base64,${toBase64(bytes)}` : null;
}

/** Helvetica's metrics for the preview, loaded with `pdf-lib`. */
export async function loadMeasure(): Promise<MeasureText> {
  const { loadHelveticaMeasure } = await import("../../../lib/qr/label-pdf");
  return loadHelveticaMeasure();
}

export async function buildPdf(labels: LabelContent[], settings: QrLabelSettings, brandHref: string, title: string): Promise<Uint8Array> {
  const [{ buildLabelSheetPdf }, brandPng] = await Promise.all([import("../../../lib/qr/label-pdf"), loadBrandImage(brandHref)]);
  return buildLabelSheetPdf({ labels, style: settings.style, sheet: settings.sheet, brandPng, title });
}

function pdfBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}

/** Saves a blob under `name`. */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function savePdf(bytes: Uint8Array, name: string): void {
  saveBlob(pdfBlob(bytes), name);
}

/**
 * One click to the print dialog: the PDF in a hidden frame, printed from
 * there — the browser's own PDF viewer prints it at the size it says, so the
 * labels measure what the styler said. Where a browser will not print a
 * framed PDF (it throws), the PDF opens in a new tab to print from.
 */
export function printPdf(bytes: Uint8Array): void {
  const url = URL.createObjectURL(pdfBlob(bytes));
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  Object.assign(frame.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
  frame.addEventListener("load", () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      window.open(url, "_blank", "noopener");
    }
  });
  frame.src = url;
  document.body.appendChild(frame);
  // Long enough for the dialog to have taken its copy.
  window.setTimeout(() => {
    frame.remove();
    URL.revokeObjectURL(url);
  }, 120_000);
}

/** One label as a standalone SVG file, the logo inlined. */
export async function labelSvgFile(layout: LabelLayout, label: LabelContent, brandHref: string): Promise<Blob> {
  const svg = labelSvg(layout, label.url, { brandHref: await brandDataUri(brandHref), title: label.name });
  return new Blob([svg], { type: "image/svg+xml" });
}

/** One label as a PNG at `dpi` (300 by default: a printer's resolution at the label's real size). */
export async function labelPngFile(layout: LabelLayout, label: LabelContent, brandHref: string, dpi = 300): Promise<Blob> {
  const svgBlob = await labelSvgFile(layout, label, brandHref);
  const url = URL.createObjectURL(svgBlob);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.round((layout.widthMm / 25.4) * dpi);
    canvas.height = Math.round((layout.heightMm / 25.4) * dpi);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no_canvas");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("no_png"))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

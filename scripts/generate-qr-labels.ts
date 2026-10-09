/**
 * Generates a printable sheet of QR labels for the published catalog.
 *
 *   npm run qr:labels -- --base-url https://tools.example.edu
 *   npm run qr:labels -- --locale ja --qr-mm 45 --out big-labels.html
 *   npm run qr:labels -- --pdf --size 2in --paper letter --out labels.pdf
 *
 * `--pdf` writes the same print sheets `/admin/inventory/qr` makes (the
 * shared `src/lib/qr/*` layout, `pdf-lib`), with the default label style;
 * the admin page is where the style is chosen. The HTML sheet is kept for
 * anybody who prints from a browser.
 *
 * Each label encodes `<site>/tools/<slug>?src=qr` — a normal tool URL every
 * phone camera opens natively, so there is no in-app scanner and no runtime
 * dependency. The QR image is generated at error-correction level H because
 * these stickers live on machines that get knocked, wiped, and scuffed.
 *
 * The URL format and the location line are `src/lib/qr/urls.ts` and
 * `labels.ts`, shared with the tool page, the admin sheets and the assistant,
 * so a label printed from any of them resolves the same way.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDirection, isSupportedLocale, DEFAULT_LOCALE } from "../src/i18n/config.ts";
import { getDb } from "../src/lib/db/client.ts";
import { locations, tools } from "../src/lib/db/schema/index.ts";
import { QR_SOURCE_PARAM, QR_SOURCE_VALUE, toolQrTargetUrl } from "../src/lib/qr/urls.ts";
import { formatLabelLocation as formatRoomZone, labelContentFor } from "../src/lib/qr/labels.ts";
import { DEFAULT_SETTINGS, withSizeDefaults } from "../src/lib/qr/settings.ts";
import { siteConfig } from "../src/lib/site-config.ts";
import {
  DEFAULT_LABEL_STYLE,
  DEFAULT_SHEET,
  LABEL_PRESETS,
  PAPER_IDS,
  type LabelStyle,
  type PaperId,
} from "../src/lib/qr/label-layout.ts";

/**
 * The minimum a label needs: something to route to, something to print. Both
 * the resolved catalog (`MakerLabTool`) and a raw Postgres `tools` row (joined
 * to its location) satisfy it.
 */
export interface QrLabelSource {
  id: string;
  /** Route segment for `/tools/<slug>`. Falls back to `id`. */
  slug?: string;
  name: string;
  /** Room. */
  location?: string | null;
  /** Zone within the room. */
  zone?: string | null;
  /** Draft records are never labelled (Article 5). Absent means published. */
  published?: boolean;
}

export interface QrLabel {
  id: string;
  name: string;
  /** "Room / Zone", or "" when the catalog has no location for this tool. */
  location: string;
  url: string;
}

/** A label with its QR image inlined as SVG markup. */
export interface RenderedQrLabel extends QrLabel {
  svg: string;
}

/** User-facing sheet copy, read from `messages/<locale>.json` (Article 6). */
export interface LabelSheetStrings {
  sheetTitle: string;
  sheetSubtitle: string;
  labelCta: string;
  sheetEmpty: string;
}

/** Encodes a URL as standalone SVG markup. Injected so tests stay offline. */
export type QrEncoder = (url: string) => Promise<string>;

/** Marks traffic as arriving from a machine, and nothing else (spec §8). */
export { QR_SOURCE_PARAM, QR_SOURCE_VALUE };

/**
 * The URL a label encodes. Deliberately the real tool page — no redirect
 * service to keep running, and no short link to expire (spec §2).
 */
export function toolPageUrl(baseUrl: string, slug: string): string {
  return toolQrTargetUrl(baseUrl, slug);
}

/**
 * Room + zone as one human line. A tool with neither degrades to an empty
 * string (the label simply omits the line) rather than printing "undefined".
 */
export function formatLabelLocation(source: QrLabelSource): string {
  // Notion fills both room and zone with the same sentinel when a tool has no
  // location relation; printing it twice is noise (handled in the shared lib).
  return formatRoomZone(source.location, source.zone);
}

/**
 * Turns catalog records into label data. Unpublished records are dropped, and
 * so is anything with no routing key — a label whose code does not resolve is
 * worse than a missing label.
 */
export function deriveLabels(sources: QrLabelSource[], baseUrl: string): QrLabel[] {
  const labels: QrLabel[] = [];

  for (const source of sources) {
    if (source.published === false) continue;
    const slug = (source.slug || source.id || "").trim();
    if (!slug) continue;

    labels.push({
      id: source.id,
      name: (source.name || "").trim(),
      location: formatLabelLocation(source),
      url: toolPageUrl(baseUrl, slug),
    });
  }

  return labels;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Spec §6 floor. A code smaller than this stops reading once it has been wiped
 * down a few times, and the failure only shows up after a hundred are printed.
 */
export const MIN_QR_MM = 25;
/**
 * Default QR edge. Roughly a 35 cm scanning distance on a current phone, which
 * is how far away you stand at a machine. Sticker stock is still an open
 * question (spec §11.2), so `--qr-mm` exists rather than a guess baked in.
 */
export const DEFAULT_QR_MM = 34;

function sheetCss(qrMm: number): string {
  // Padding + the three text lines under the code.
  const labelMm = qrMm + 16;

  return `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 12mm;
    background: #ffffff;
    color: #000000;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .sheet-head { margin: 0 0 10mm; }
  .sheet-head h1 { margin: 0; font-size: 18px; letter-spacing: 0.04em; text-transform: uppercase; }
  .sheet-head p { margin: 4px 0 0; font-size: 12px; color: #444; }
  .sheet {
    display: grid;
    grid-template-columns: repeat(auto-fill, ${labelMm}mm);
    gap: 6mm;
    justify-content: start;
  }
  .qr-label {
    width: ${labelMm}mm;
    padding: 3mm;
    border: 0.3mm solid #000000;
    border-radius: 2mm;
    text-align: center;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .qr-label svg { width: ${qrMm}mm; height: ${qrMm}mm; display: block; margin: 0 auto; }
  .qr-name {
    margin: 2mm 0 0;
    font-size: 9pt;
    font-weight: 700;
    line-height: 1.15;
    text-transform: uppercase;
    overflow-wrap: anywhere;
  }
  .qr-location { margin: 1mm 0 0; font-size: 7.5pt; line-height: 1.2; overflow-wrap: anywhere; }
  .qr-cta { margin: 1.5mm 0 0; font-size: 7pt; letter-spacing: 0.06em; text-transform: uppercase; }
  .qr-empty { font-size: 12px; }
  @page { margin: 10mm; }
  @media print {
    body { padding: 0; }
    .sheet-head { display: none; }
  }
`;
}

export interface SheetLayout {
  locale?: string;
  /** QR edge length in millimetres. Clamped to `MIN_QR_MM`. */
  qrMm?: number;
}

/**
 * Renders the printable sheet. Black on white, no color, no external assets —
 * it has to survive being opened on whatever machine is wired to the printer.
 */
export function renderLabelSheet(
  labels: RenderedQrLabel[],
  strings: LabelSheetStrings,
  { locale = DEFAULT_LOCALE, qrMm = DEFAULT_QR_MM }: SheetLayout = {}
): string {
  const size = Math.max(MIN_QR_MM, qrMm);
  const body =
    labels.length > 0
      ? `<main class="sheet">\n${labels
          .map(
            (label) => `      <article class="qr-label">
        ${label.svg}
        <p class="qr-name">${escapeHtml(label.name)}</p>
        ${label.location ? `<p class="qr-location">${escapeHtml(label.location)}</p>` : ""}
        <p class="qr-cta">${escapeHtml(strings.labelCta)}</p>
      </article>`
          )
          .join("\n")}\n    </main>`
      : `<p class="qr-empty">${escapeHtml(strings.sheetEmpty)}</p>`;

  return `<!doctype html>
<html lang="${escapeHtml(locale)}" dir="${getDirection(locale)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(strings.sheetTitle)}</title>
    <style>${sheetCss(size)}</style>
  </head>
  <body>
    <header class="sheet-head">
      <h1>${escapeHtml(strings.sheetTitle)}</h1>
      <p>${escapeHtml(strings.sheetSubtitle)}</p>
    </header>
    ${body}
  </body>
</html>
`;
}

/** Loads `qrcode` lazily so importing this module stays cheap and offline. */
export async function encodeQrSvg(url: string): Promise<string> {
  const { toString: toQrString } = await import("qrcode");
  return toQrString(url, {
    type: "svg",
    // Level H tolerates ~30% damage — these live on machines (spec §6).
    errorCorrectionLevel: "H",
    // Quiet zone, in modules.
    margin: 4,
  });
}

export interface BuildLabelSheetOptions extends SheetLayout {
  baseUrl: string;
  strings: LabelSheetStrings;
  encodeQr?: QrEncoder;
}

/**
 * Derives labels, encodes each code, and renders the sheet. Encoding runs one
 * at a time — a hundred labels is instant and an unbounded fan-out over a
 * catalog of unknown size is never worth it.
 */
export async function buildLabelSheet(
  sources: QrLabelSource[],
  { baseUrl, strings, locale, qrMm, encodeQr = encodeQrSvg }: BuildLabelSheetOptions
): Promise<string> {
  const rendered: RenderedQrLabel[] = [];

  for (const label of deriveLabels(sources, baseUrl)) {
    rendered.push({ ...label, svg: await encodeQr(label.url) });
  }

  return renderLabelSheet(rendered, strings, { locale, qrMm });
}

/**
 * Pulls the `qr` namespace out of a locale catalog. The English fallbacks only
 * fire if a locale file is missing keys — the sheet still prints.
 */
export function pickSheetStrings(messages: {
  qr?: Partial<LabelSheetStrings>;
}): LabelSheetStrings {
  const qr = messages.qr || {};

  return {
    sheetTitle: qr.sheetTitle || "QR labels",
    sheetSubtitle: qr.sheetSubtitle || "",
    labelCta: qr.labelCta || "Scan for help",
    sheetEmpty: qr.sheetEmpty || "No published tools to label.",
  };
}

/** Where `messages/*.json` lives, relative to this script. */
export function defaultMessagesDir(): string {
  try {
    return fileURLToPath(new URL("../messages/", import.meta.url));
  } catch {
    // Test runners can hand this module a non-`file:` `import.meta.url`; the
    // app root is the working directory `npm run` sets, so it is a safe floor.
    return join(process.cwd(), "messages");
  }
}

/** Reads the `qr` namespace out of a locale catalog on disk. */
export async function loadSheetStrings(
  locale: string,
  messagesDir: string = defaultMessagesDir()
): Promise<LabelSheetStrings> {
  const text = await readFile(join(messagesDir, `${locale}.json`), "utf8");
  return pickSheetStrings(JSON.parse(text));
}

// ── CLI ────────────────────────────────────────────────────────────

interface CliOptions {
  baseUrl: string | null;
  locale: string;
  out: string;
  qrMm: number;
  /** Write the admin page's PDF sheets instead of the HTML sheet. */
  pdf: boolean;
  /** `--size 2in` (a preset) or `--size 60x40` (millimetres). */
  size: { widthMm: number; heightMm: number };
  paper: PaperId;
}

const SIZE_PATTERN = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/;

/** A preset id (`1in` … `3in`) or `<w>x<h>` in millimetres; anything else is the default. */
export function parseLabelSize(value: string | undefined): { widthMm: number; heightMm: number } {
  const preset = LABEL_PRESETS.find((entry) => entry.id === value);
  if (preset) return { widthMm: preset.widthMm, heightMm: preset.heightMm };
  const match = SIZE_PATTERN.exec(value ?? "");
  if (match) return { widthMm: Number(match[1]), heightMm: Number(match[2]) };
  return { widthMm: DEFAULT_LABEL_STYLE.widthMm, heightMm: DEFAULT_LABEL_STYLE.heightMm };
}

export function parseArgs(argv: string[]): CliOptions {
  const flags = new Map<string, string>();

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq > -1) flags.set(arg.slice(2, eq), arg.slice(eq + 1));
    else flags.set(arg.slice(2), argv[i + 1] ?? "");
  }

  const locale = flags.get("locale") || DEFAULT_LOCALE;
  const qrMm = Number(flags.get("qr-mm"));
  // `--pdf` takes no value (the loop above would hand it the next flag), so read its presence.
  const pdf = argv.includes("--pdf");
  const paper = flags.get("paper");

  return {
    baseUrl:
      flags.get("base-url") ||
      process.env.QR_LABEL_BASE_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      null,
    locale: isSupportedLocale(locale) ? locale : DEFAULT_LOCALE,
    out: flags.get("out") || (pdf ? "qr-labels.pdf" : "qr-labels.html"),
    qrMm: Number.isFinite(qrMm) && qrMm > 0 ? Math.max(MIN_QR_MM, qrMm) : DEFAULT_QR_MM,
    pdf,
    size: parseLabelSize(flags.get("size")),
    paper: (PAPER_IDS as readonly string[]).includes(paper ?? "") ? (paper as PaperId) : DEFAULT_SHEET.paper,
  };
}

/**
 * The admin page's PDF sheets for every published tool, in the default style
 * with the location line on (`/admin/inventory/qr` is where a style is chosen).
 */
export async function buildPdfSheet(
  sources: QrLabelSource[],
  options: { baseUrl: string; size: { widthMm: number; heightMm: number }; paper: PaperId },
  // The lab's official logo as a PNG, as the admin page draws it.
  brandPath: string = join(process.cwd(), "public", siteConfig.logoPng)
): Promise<Uint8Array> {
  const { buildLabelSheetPdf } = await import("../src/lib/qr/label-pdf.ts");
  const preset = LABEL_PRESETS.find((entry) => entry.widthMm === options.size.widthMm && entry.heightMm === options.size.heightMm);
  // The admin page's size defaults: a small code drops the logo and extra line.
  const { style } = withSizeDefaults({
    ...DEFAULT_SETTINGS,
    preset: preset?.id ?? "custom",
    style: { ...DEFAULT_LABEL_STYLE, ...options.size, showLocation: true } satisfies LabelStyle,
  });
  const labels = sources
    .filter((source) => source.published !== false && (source.slug || source.id || "").trim())
    .map((source) =>
      labelContentFor({ slug: (source.slug || source.id).trim(), name: source.name, room: source.location, zone: source.zone }, options.baseUrl)
    );
  const brandPng = await readFile(brandPath).catch(() => null);
  return buildLabelSheetPdf({ labels, style, sheet: { ...DEFAULT_SHEET, paper: options.paper }, brandPng });
}

/**
 * Catalog source: published, non-archived tools straight from Postgres
 * (spec §3.10 — old labels still resolve because `notion_page_id` isn't
 * touched here, and new ones are printed from `slug`). `getDb()` resolves to
 * the PGlite demo seed when `DATABASE_URL` is unset, so staff can dry-run the
 * layout before a real database is wired up.
 */
export async function loadSources(): Promise<QrLabelSource[]> {
  const db = await getDb();

  const rows = await db
    .select({
      id: tools.id,
      slug: tools.slug,
      name: tools.name,
      room: locations.room,
      zone: locations.zone,
    })
    .from(tools)
    .leftJoin(locations, eq(tools.locationId, locations.id))
    .where(and(eq(tools.published, true), isNull(tools.archivedAt)))
    .orderBy(asc(tools.name));

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    location: row.room,
    zone: row.zone,
    // The query already filters to published tools; the flag stays true so
    // `deriveLabels` remains the single place that decides.
    published: true,
  }));
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (!options.baseUrl) {
    console.error(
      "No site URL. Pass --base-url https://your-site, or set NEXT_PUBLIC_SITE_URL / QR_LABEL_BASE_URL."
    );
    console.error("Labels encode absolute URLs — a wrong origin prints a hundred dead codes.");
    process.exitCode = 1;
    return;
  }

  const sources = await loadSources();

  if (options.pdf) {
    const bytes = await buildPdfSheet(sources, { baseUrl: options.baseUrl, size: options.size, paper: options.paper });
    await writeFile(options.out, bytes);
    const count = deriveLabels(sources, options.baseUrl).length;
    console.log(`Wrote ${count} label(s) to ${options.out} (${options.size.widthMm} × ${options.size.heightMm} mm, ${options.paper}).`);
    console.log('Print at 100 % ("Actual size"), never "Fit to page", and scan one in the lab before cutting the rest.');
    return;
  }

  const strings = await loadSheetStrings(options.locale);
  const html = await buildLabelSheet(sources, {
    baseUrl: options.baseUrl,
    strings,
    locale: options.locale,
    qrMm: options.qrMm,
  });

  await writeFile(options.out, html, "utf8");

  const count = deriveLabels(sources, options.baseUrl).length;
  console.log(`Wrote ${count} label(s) to ${options.out} at ${options.qrMm}mm.`);
  console.log(
    "Print one test sheet and scan it in the lab's own lighting, from the distance you actually stand at the machine, before printing the rest. Scale with --qr-mm if it misses."
  );
}

// Only run when invoked directly, so tests can import the pure pieces.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}

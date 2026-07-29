/**
 * Generates a printable sheet of QR labels for the published catalog.
 *
 *   npm run qr:labels -- --base-url https://tools.example.edu
 *   npm run qr:labels -- --locale ja --qr-mm 45 --out big-labels.html
 *
 * Each label encodes `<site>/tools/<slug>?src=qr` — a normal tool URL every
 * phone camera opens natively, so there is no in-app scanner and no runtime
 * dependency. The QR image is generated at error-correction level H because
 * these stickers live on machines that get knocked, wiped, and scuffed.
 *
 * `qrcode` is a devDependency and is imported lazily, so it never reaches the
 * browser bundle.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getDirection, isSupportedLocale, DEFAULT_LOCALE } from "../src/i18n/config.ts";

/**
 * The minimum a label needs: something to route to, something to print. Both
 * the resolved catalog (`MakerLabTool`) and raw Notion metadata satisfy it.
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
export const QR_SOURCE_PARAM = "src";
export const QR_SOURCE_VALUE = "qr";

/**
 * The URL a label encodes. Deliberately the real tool page — no redirect
 * service to keep running, and no short link to expire (spec §2).
 */
export function toolPageUrl(baseUrl: string, slug: string): string {
  const origin = baseUrl.replace(/\/+$/, "");
  return `${origin}/tools/${encodeURIComponent(slug)}?${QR_SOURCE_PARAM}=${QR_SOURCE_VALUE}`;
}

/**
 * Room + zone as one human line. A tool with neither degrades to an empty
 * string (the label simply omits the line) rather than printing "undefined".
 */
export function formatLabelLocation(source: QrLabelSource): string {
  const parts = [source.location, source.zone]
    .map((part) => (part || "").trim())
    .filter((part) => part.length > 0);
  // Notion fills both room and zone with the same sentinel when a tool has no
  // location relation; printing it twice is noise.
  return Array.from(new Set(parts)).join(" / ");
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

  return {
    baseUrl:
      flags.get("base-url") ||
      process.env.QR_LABEL_BASE_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      null,
    locale: isSupportedLocale(locale) ? locale : DEFAULT_LOCALE,
    out: flags.get("out") || "qr-labels.html",
    qrMm: Number.isFinite(qrMm) && qrMm > 0 ? Math.max(MIN_QR_MM, qrMm) : DEFAULT_QR_MM,
  };
}

/**
 * Catalog source. With Notion configured we read the published Tools DB
 * directly — `src/lib/catalog.ts` caches through `next/cache`, which only
 * works inside a Next runtime. Without credentials we fall back to the mock
 * catalog, so staff can dry-run the layout before wiring anything up.
 */
async function loadSources(): Promise<QrLabelSource[]> {
  const { getNotionEnvContract, fetchAllTools, fetchAllLocations, resolveTools } =
    await import("../src/lib/notion.ts");

  if (!getNotionEnvContract().every((key) => Boolean(process.env[key]))) {
    console.warn("Notion env not configured — generating labels from the mock catalog.");
    const { mockTools } = await import("../src/components/mock-catalog.ts");
    return mockTools;
  }

  const [tools, locations] = await Promise.all([fetchAllTools(), fetchAllLocations()]);
  // `fetchAllTools` already filters to published records; keep the flag so
  // `deriveLabels` stays the single place that decides.
  const publishedById = new Map(tools.map((tool) => [tool.id, tool.fields.published]));

  return resolveTools(tools, [], locations).map((tool) => ({
    id: tool.id,
    // Notion-backed tool pages route by page id (catalog.ts sets slug = id).
    slug: tool.id,
    name: tool.name,
    location: tool.location_room,
    zone: tool.location_zone,
    published: publishedById.get(tool.id),
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

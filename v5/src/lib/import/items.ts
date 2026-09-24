import type { ColumnMap } from "./columns.ts";
import { IMPORT_MAX_LINKS_PER_ITEM, IMPORT_MAX_QUANTITY } from "./limits.ts";
import type { ParsedTable } from "./table.ts";
import type { ImportItem, ImportLink, LabDoc, RawImportItem, SkippedRow } from "./types.ts";

/**
 * From a parsed row, a list line or the extractor's answer to an item a
 * pending row can be made from (bulk intake spec §3.2 "Validation", §3.4).
 *
 * - **Every item needs a name.** A row with none — after the brand and model
 *   are considered — is skipped and reported, never invented.
 * - **URLs are checked to be http(s).** Anything else in a link column is text,
 *   and goes into the notes.
 * - **Quantity is 1–50**, and never fewer than the serials given: three
 *   serials are three units.
 * - **Serials are one a line** (or separated by `;` or `,` in one cell).
 * - **The lab's own documents are told apart by where they live**: a Google
 *   Doc or Drive, Notion, SharePoint or OneDrive link is a lab document even
 *   in a "Links" column, because it is exactly the private material research
 *   must never open (§3.4, §10 "A private Google Doc link is fetched…").
 * - **Likely consumables** ("10 boxes of screws") are marked `consumable?` in
 *   the notes, so the review table can filter them out before research (§5).
 *
 * Pure and client-safe.
 */

const MAX_TEXT = 200;
const MAX_NOTES = 2000;
const MAX_SERIALS = IMPORT_MAX_QUANTITY;

/** Hosts whose links are the lab's own documents, never product pages. */
const LAB_DOC_HOSTS = [
  "docs.google.com",
  "drive.google.com",
  "notion.so",
  "notion.site",
  "sharepoint.com",
  "onedrive.live.com",
  "1drv.ms",
  "dropbox.com",
  "box.com",
];

/** The note a likely consumable carries — the review table's filter reads it. */
export const CONSUMABLE_NOTE = "consumable?";

/** Headers too generic to title a lab document with. */
const GENERIC_DOC_HEADERS = new Set(["doc", "docs", "document", "documents", "lab doc", "lab docs", "lab document", "lab documents", "link", "links", "url", "urls", "google doc", "google docs", "gdoc"]);

/** One item, validated — or why it could not be one. */
export function normalizeImportItem(raw: RawImportItem): { ok: true; item: ImportItem } | { ok: false; skipped: SkippedRow } {
  const sourceRow = typeof raw.sourceRow === "number" && Number.isFinite(raw.sourceRow) ? raw.sourceRow : null;
  const brand = clean(raw.brand);
  const model = clean(raw.model);
  const name = composeName(clean(raw.name), brand, model);
  if (!name) return { ok: false, skipped: { sourceRow, reason: "no_name" } };

  const notes: string[] = [];
  const rawNotes = cleanMultiline(raw.notes);
  if (rawNotes) notes.push(rawNotes);

  const links: ImportLink[] = [];
  const labDocs: LabDoc[] = [];
  for (const entry of splitList(raw.links)) {
    const url = httpUrl(entry);
    if (!url) {
      notes.push(entry);
      continue;
    }
    if (isLabDocUrl(url)) labDocs.push({ title: defaultLabDocTitle(url), url });
    else links.push({ url });
  }
  for (const entry of labDocEntries(raw.labDocs)) {
    const url = httpUrl(entry.url);
    if (!url) {
      if (entry.url) notes.push(entry.title ? `${entry.title}: ${entry.url}` : entry.url);
      continue;
    }
    labDocs.push({ title: labDocTitle(entry.title, url), url });
  }

  const serials = splitSerials(raw.serials);
  const quantity = Math.min(IMPORT_MAX_QUANTITY, Math.max(parseQuantity(raw.quantity), serials.length, 1));
  if (looksConsumable(name)) notes.push(CONSUMABLE_NOTE);

  return {
    ok: true,
    item: {
      name,
      brand,
      categoryHint: clean(raw.category),
      locationHint: clean(raw.location),
      quantity,
      serials,
      notes: notes.length > 0 ? notes.join("\n").slice(0, MAX_NOTES) : null,
      links: uniqueBy(links, (link) => link.url).slice(0, IMPORT_MAX_LINKS_PER_ITEM),
      labDocs: uniqueBy(labDocs, (doc) => doc.url).slice(0, IMPORT_MAX_LINKS_PER_ITEM),
      sourceRow,
    },
  };
}

/** Every item, validated, with the skipped rows beside them. */
export function normalizeImportItems(raws: RawImportItem[]): { items: ImportItem[]; skipped: SkippedRow[] } {
  const items: ImportItem[] = [];
  const skipped: SkippedRow[] = [];
  for (const raw of raws) {
    const result = normalizeImportItem(raw);
    if (result.ok) items.push(result.item);
    else skipped.push(result.skipped);
  }
  return { items, skipped };
}

/**
 * A table's rows as raw items, through the confirmed column map. A column
 * mapped to `notes` more than once keeps its header ("Condition: worn"); a
 * lab-document column titles its links with its header ("SOP") unless the
 * header is a generic "Docs".
 */
export function tableToRawItems(table: ParsedTable, map: ColumnMap): RawImportItem[] {
  const noteColumns = map.filter((field) => field === "notes").length;
  return table.rows.map((row, index) => {
    const raw: RawImportItem = { sourceRow: table.rowNumbers[index] ?? index + 1 };
    const notes: string[] = [];
    const links: string[] = [];
    const labDocs: { title: string | null; url: string }[] = [];
    map.forEach((field, column) => {
      const value = (row[column] ?? "").trim();
      if (!field || !value) return;
      const header = table.hasHeader ? table.headers[column] : null;
      switch (field) {
        case "notes":
          notes.push(noteColumns > 1 && header ? `${header}: ${value}` : value);
          break;
        case "links":
          links.push(...splitList(value));
          break;
        case "labDocs":
          for (const url of splitList(value)) labDocs.push({ title: header, url });
          break;
        case "serial":
          raw.serials = value;
          break;
        default:
          raw[field] = value;
      }
    });
    if (notes.length > 0) raw.notes = notes.join("\n");
    if (links.length > 0) raw.links = links;
    if (labDocs.length > 0) raw.labDocs = labDocs;
    return raw;
  });
}

/**
 * The name a row's name, brand and model make: the name alone when it already
 * carries the model; the brand and model when there is no name; the name and
 * the model otherwise ("Laser cutter" + "Speedy 400" → "Laser cutter Speedy
 * 400"). The brand stays in its own field, where the duplicate check reads it.
 */
export function composeName(name: string | null, brand: string | null, model: string | null): string | null {
  if (!model) return name ? name.slice(0, MAX_TEXT) : null;
  if (!name) return [brand, model].filter(Boolean).join(" ").slice(0, MAX_TEXT) || null;
  if (name.toLowerCase().includes(model.toLowerCase())) return name.slice(0, MAX_TEXT);
  return `${name} ${model}`.slice(0, MAX_TEXT);
}

/** "3", "3 units", "x3", "3x", "three"-free: the first whole number, else 1. */
export function parseQuantity(value: RawImportItem["quantity"]): number {
  if (typeof value === "number") return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1;
  if (typeof value !== "string") return 1;
  const match = value.match(/\d+/);
  const parsed = match ? Number(match[0]) : NaN;
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
}

/** Serials, one a line or `;`/`,`-separated in one cell, de-duplicated and capped. */
export function splitSerials(value: RawImportItem["serials"]): string[] {
  const parts = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\r\n;,]+/) : [];
  const serials = parts.map((part) => (typeof part === "string" ? part.trim().slice(0, MAX_TEXT) : "")).filter(Boolean);
  return [...new Set(serials)].slice(0, MAX_SERIALS);
}

/** The URL if it is an absolute http(s) URL, normalized; otherwise null. */
export function httpUrl(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim().replace(/^<|>$/g, "");
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Whether a link is the lab's own material (a Google Doc, a Notion page, …). */
export function isLabDocUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return LAB_DOC_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
  } catch {
    return false;
  }
}

/** "docs.google.com — Lab document": a lab document with no title of its own. */
export function defaultLabDocTitle(url: string): string {
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    // An unparseable URL never reaches here; `httpUrl` refused it.
  }
  return host ? `${host} — Lab document` : "Lab document";
}

/**
 * A title from the row ("SOP", "Past projects"), or the default. The words
 * that only say "this is a link" are dropped first, so a header "SOP / Doc"
 * titles its links "SOP" and a header "Google Doc" leaves the default.
 */
function labDocTitle(title: string | null | undefined, url: string): string {
  const cleaned = clean(title);
  if (!cleaned || GENERIC_DOC_HEADERS.has(cleaned.toLowerCase())) return defaultLabDocTitle(url);
  const words = cleaned.split(/[^A-Za-z0-9]+/).filter((word) => word && !GENERIC_DOC_WORDS.has(word.toLowerCase()));
  return words.length > 0 ? words.join(" ") : defaultLabDocTitle(url);
}

/** Words in a lab-document header that name the kind of link, not the document. */
const GENERIC_DOC_WORDS = new Set(["doc", "docs", "document", "documents", "link", "links", "url", "urls", "google", "gdoc", "lab"]);

/** Likely a consumable rather than equipment ("10 boxes of screws", "PLA filament"). */
export function looksConsumable(name: string): boolean {
  return /\b(box(es)?|packs?|bags?|rolls?|spools?|sheets?|bottles?|cans?|tubes?|reams?) of\b/i.test(name) ||
    /\b(screws?|nails?|bolts?|nuts|washers?|rivets?|zip ?ties?|sandpaper|glue sticks?|superglue|epoxy|tape|filament|resin bottle|consumables?|batteries|drill bits? set)\b/i.test(name);
}

function labDocEntries(value: RawImportItem["labDocs"]): { title: string | null; url: string }[] {
  if (typeof value === "string") return splitList(value).map((url) => ({ title: null, url }));
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry === "string") return splitList(entry).map((url) => ({ title: null, url }));
    if (entry && typeof entry === "object" && typeof entry.url === "string") {
      return [{ title: typeof entry.title === "string" ? entry.title : null, url: entry.url }];
    }
    return [];
  });
}

/**
 * A cell or list of cells as separate entries: split on newlines and `;`, and
 * every URL taken out as its own entry — whatever text surrounds it stays one
 * entry of its own ("https://… see shelf B" → the link, and "see shelf B").
 */
function splitList(value: string[] | string | null | undefined): string[] {
  const parts = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return parts.flatMap((part) => {
    if (typeof part !== "string") return [];
    return part.split(/[\r\n;]+/).flatMap((piece) => {
      const urls = piece.match(/https?:\/\/[^\s<>"',]+/gi) ?? [];
      const rest = piece.replace(/https?:\/\/[^\s<>"',]+/gi, " ").replace(/[\s,]+/g, " ").trim();
      return [...urls, ...(rest ? [rest] : [])];
    });
  });
}

/** Trimmed, one line, capped; empty becomes null. */
function clean(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, MAX_TEXT) : null;
}

function cleanMultiline(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, MAX_NOTES) : null;
}

function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const k = key(value);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

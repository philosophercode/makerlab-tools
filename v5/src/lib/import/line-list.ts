import { stripBom } from "./table.ts";
import type { RawImportItem } from "./types.ts";

/**
 * A plain list, one item a line (bulk intake spec §3.2, amended: "A plain list
 * is read by code").
 *
 * "3x Prusa MK4", "- Form 2 (2)", "Heat gun x2 — https://…", "Drill press SN:
 * DP-4411". Bullets, numbering and checkboxes are dropped; a count before or
 * after the name is the quantity; a URL on the line is a link; "SN:"/"S/N"
 * introduces a serial; a short line ending in a colon ("3D printers:") is a
 * heading, and becomes the category hint of the lines under it.
 *
 * Anything that is not a plain list — sentences, paragraphs, a PDF's text — is
 * a document, and a model reads it instead ({@link isPlainList}).
 *
 * Pure and client-safe.
 */

/** Lines longer than this are prose, not list entries. */
const MAX_LIST_LINE = 120;

/** Words above which a line is a sentence. */
const MAX_LIST_WORDS = 14;

/**
 * Whether `text` reads as a plain list: at least one line, and at least 90% of
 * its lines are short (≤ 120 characters, ≤ 14 words) and none is a long
 * paragraph. Anything else is a document.
 */
export function isPlainList(text: string): boolean {
  const lines = listLines(text);
  if (lines.length === 0) return false;
  if (lines.some((line) => line.length > 300)) return false;
  const short = lines.filter((line) => withoutUrls(line).length <= MAX_LIST_LINE && wordCount(withoutUrls(line)) <= MAX_LIST_WORDS);
  return short.length / lines.length >= 0.9;
}

/** Every entry of a plain list, with its line number. Headings are not entries. */
export function parseLineList(text: string): RawImportItem[] {
  const items: RawImportItem[] = [];
  let heading: string | null = null;
  stripBom(text)
    .split(/\r\n|\r|\n/)
    .forEach((rawLine, index) => {
      const line = stripMarker(rawLine.trim());
      if (!line) return;
      if (isHeading(line)) {
        heading = line.replace(/:\s*$/, "").trim() || null;
        return;
      }
      const item = parseLine(line);
      if (!item) return;
      items.push({ ...item, category: heading, sourceRow: index + 1 });
    });
  return items;
}

/** One line's name, count, serial and links, or null when nothing is left for a name. */
export function parseLine(line: string): Omit<RawImportItem, "sourceRow" | "category"> | null {
  let rest = line;
  const links: string[] = [];
  rest = rest.replace(/https?:\/\/[^\s<>()"']+/gi, (url) => {
    links.push(url.replace(/[.,;:!?)\]]+$/, ""));
    return " ";
  });

  const serials: string[] = [];
  rest = rest.replace(/\b(?:s\/n|sn|serial(?: number| no)?)\b\s*[:#.]*\s*([A-Za-z0-9][\w\-./]*)/gi, (_, serial: string) => {
    serials.push(serial);
    return " ";
  });

  let quantity: number | null = null;
  const take = (pattern: RegExp) => {
    if (quantity !== null) return;
    rest = rest.replace(pattern, (_match, count: string) => {
      quantity = Number(count);
      return " ";
    });
  };
  // "3x Name", "3 x Name", "3 × Name"
  take(/^\s*(\d{1,3})\s*[x×]\s+/i);
  // "Name x3", "Name × 3", "Name (x3)"
  take(/\s*\(?\s*[x×]\s*(\d{1,3})\s*\)?\s*$/i);
  // "Name (3)", "Name - 3 units", "Name, qty 3", "Name: 3 pcs"
  take(/\s*[(\[]\s*(\d{1,3})\s*(?:units?|pcs?|pieces?)?\s*[)\]]\s*$/i);
  take(/\s*(?:[-–—,:]\s*)?(?:qty|quantity|count)\s*[:=]?\s*(\d{1,3})\s*$/i);
  take(/\s*[-–—,:]\s*(\d{1,3})\s*(?:units?|pcs?|pieces?)\s*$/i);
  // "3 Name" only when a unit word says so: "3 units of Name"
  take(/^\s*(\d{1,3})\s+(?:units?|pcs?|pieces?)\s+(?:of\s+)?/i);

  const name = rest
    .replace(/\s+[-–—|:]\s*$/, "")
    .replace(/^\s*[-–—|:]\s+/, "")
    .replace(/\s{2,}/g, " ")
    .replace(/[\s,;:–—-]+$/, "")
    .trim();
  if (!name) return null;
  return {
    name,
    ...(quantity !== null ? { quantity } : {}),
    ...(serials.length > 0 ? { serials } : {}),
    ...(links.length > 0 ? { links } : {}),
  };
}

/** The non-blank lines, markers stripped — what {@link isPlainList} measures. */
function listLines(text: string): string[] {
  return stripBom(text)
    .split(/\r\n|\r|\n/)
    .map((line) => stripMarker(line.trim()))
    .filter(Boolean);
}

/** "- ", "* ", "• ", "1. ", "2) ", "[ ] ", "[x] " at the start of a line. */
function stripMarker(line: string): string {
  return line.replace(/^(?:[-*•·◦▪–—]\s+|\d{1,3}[.)]\s+|\[[ xX]?\]\s+)+/, "").trim();
}

/** "3D printers:", "Wood shop:" — a short line that ends in a colon and carries no link. */
function isHeading(line: string): boolean {
  return /:\s*$/.test(line) && wordCount(line) <= 5 && !/https?:\/\//i.test(line);
}

function withoutUrls(line: string): string {
  return line.replace(/https?:\/\/\S+/gi, "").trim();
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

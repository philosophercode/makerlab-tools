/**
 * Which column holds what (bulk intake spec §3.2 "Header matching").
 *
 * A header is matched to a field by synonym — "Item", "Tool", "Equipment" are
 * the name; "Make", "Manufacturer" the brand; "Qty", "Count" the quantity;
 * "SOP", "Doc", "Google Doc" the lab documents — and the person confirms or
 * changes the match once, in the mapping step, before any row is created.
 *
 * Pure and client-safe: the mapping step suggests in the browser with the same
 * rules the server applies.
 */

export const IMPORT_FIELDS = [
  "name",
  "brand",
  "model",
  "serial",
  "category",
  "location",
  "quantity",
  "notes",
  "links",
  "labDocs",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

/**
 * Column index → field, or null for a column that is not imported. As long as
 * the table is wide; a field appears at most once, except `notes`, `links` and
 * `labDocs`, which gather from every column mapped to them.
 */
export type ColumnMap = (ImportField | null)[];

/** Fields several columns may feed. */
export const MULTI_COLUMN_FIELDS: readonly ImportField[] = ["notes", "links", "labDocs"];

/**
 * Header spellings, normalized (lower case, letters and digits, single spaces).
 * Order matters only within a header: the first field whose list contains it wins.
 */
const SYNONYMS: Record<ImportField, readonly string[]> = {
  name: [
    "name",
    "item",
    "item name",
    "tool",
    "tool name",
    "equipment",
    "equipment name",
    "machine",
    "machine name",
    "asset",
    "asset name",
    "product",
    "product name",
  ],
  brand: ["brand", "make", "manufacturer", "mfr", "mfg", "maker", "vendor"],
  model: ["model", "model number", "model no", "model name", "part number", "part no", "sku"],
  serial: ["serial", "serial number", "serial no", "serial numbers", "serials", "sn", "s n", "asset tag", "asset number"],
  category: ["category", "type", "kind", "group", "class", "department"],
  location: ["location", "room", "zone", "area", "where", "shelf", "bench", "place"],
  quantity: ["quantity", "qty", "count", "units", "amount", "how many", "number of units", "on hand", "qty on hand"],
  notes: ["notes", "note", "comments", "comment", "remarks", "details", "description", "condition", "status"],
  links: ["link", "links", "url", "urls", "website", "product page", "product link", "manual", "manual link", "manual url", "webpage", "web page"],
  labDocs: [
    "sop",
    "sops",
    "doc",
    "docs",
    "google doc",
    "google docs",
    "gdoc",
    "lab doc",
    "lab docs",
    "lab document",
    "lab documents",
    "document",
    "documents",
    "training doc",
    "past projects",
    "procedure",
    "instructions",
  ],
};

/** "Serial #", "SERIAL_NO." → "serial no". */
export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/#/g, " number ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** The field a header names, or null. Exact synonyms first, then a synonym as a whole word. */
export function fieldForHeader(header: string): ImportField | null {
  const normalized = normalizeHeader(header);
  if (!normalized) return null;
  for (const field of IMPORT_FIELDS) {
    if (SYNONYMS[field].includes(normalized)) return field;
  }
  // "Equipment (make & model)", "Qty on hand", "Serial # (if any)".
  const words = ` ${normalized} `;
  for (const field of IMPORT_FIELDS) {
    if (SYNONYMS[field].some((synonym) => synonym.length >= 3 && words.includes(` ${synonym} `))) return field;
  }
  return null;
}

/**
 * Whether a row reads as a header: one cell is exactly a known header
 * ("Item", "Qty"), or two cells without digits contain one ("Qty on hand",
 * "Equipment (make & model)"). A data row like "Prusa MK4, 3 units" is not a
 * header just because "units" appears in it.
 */
export function looksLikeHeader(cells: string[]): boolean {
  if (cells.some((cell) => exactField(cell) !== null)) return true;
  return cells.filter((cell) => !/\d/.test(cell) && fieldForHeader(cell) !== null).length >= 2;
}

function exactField(header: string): ImportField | null {
  const normalized = normalizeHeader(header);
  return IMPORT_FIELDS.find((field) => SYNONYMS[field].includes(normalized)) ?? null;
}

/**
 * The suggested match for each header. Each single-column field goes to the
 * first header that names it; a later header naming it too is left unmatched
 * for the person to decide.
 *
 * With no header row (`hasHeader` false) nothing can be read from the names,
 * so the first column whose sample values look like words is suggested as the
 * name and everything else is left for the person.
 */
export function suggestColumnMap(headers: string[], sampleRows: string[][] = [], hasHeader = true): ColumnMap {
  const map: ColumnMap = headers.map(() => null);
  if (!hasHeader) {
    const nameColumn = headers.findIndex((_, index) => sampleRows.some((row) => looksLikeName(row[index] ?? "")));
    if (nameColumn >= 0) map[nameColumn] = "name";
    return map;
  }
  const taken = new Set<ImportField>();
  headers.forEach((header, index) => {
    const field = fieldForHeader(header);
    if (!field) return;
    if (taken.has(field) && !MULTI_COLUMN_FIELDS.includes(field)) return;
    map[index] = field;
    taken.add(field);
  });
  return map;
}

/** Whether the map names a column for the item's name — what every import needs. */
export function hasNameColumn(map: ColumnMap): boolean {
  return map.includes("name") || map.includes("model");
}

export type ColumnMapProblem = "no_name" | "duplicate_field" | "wrong_width";

/** Why a submitted map cannot be used for a table `width` columns wide, or null. */
export function columnMapProblem(map: readonly unknown[], width: number): ColumnMapProblem | null {
  if (map.length !== width) return "wrong_width";
  const seen = new Set<string>();
  for (const value of map) {
    if (value === null) continue;
    if (typeof value !== "string" || !(IMPORT_FIELDS as readonly string[]).includes(value)) return "wrong_width";
    if (seen.has(value) && !MULTI_COLUMN_FIELDS.includes(value as ImportField)) return "duplicate_field";
    seen.add(value);
  }
  if (!hasNameColumn(map as ColumnMap)) return "no_name";
  return null;
}

/** A value that reads as a name: has letters, is not a URL, not only a number. */
function looksLikeName(value: string): boolean {
  const trimmed = value.trim();
  if (!/[a-z]/i.test(trimmed)) return false;
  if (/^https?:\/\//i.test(trimmed)) return false;
  return true;
}

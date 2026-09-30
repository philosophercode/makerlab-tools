import { toCsv, type CsvValue } from "./csv.ts";

/**
 * The tools CSV (super admins' export on `/admin/inventory`): one flat row per
 * tool with its catalogue fields, and nothing else — no tickets, unit history,
 * corrections or usage. It is for carrying the catalogue somewhere else, so
 * every column is a value the lab entered or approved, never a display
 * fallback: an uncategorised tool has an empty Category, not "Uncategorized",
 * and a tool with no PPE recorded has none, not "Check posted lab guidance".
 *
 * Lists are `; `-joined inside their one cell. **Links are public only**: the
 * photos are the tool's public attachments and the resources are the ones a
 * visitor sees on the tool page (hidden resources and private files are left
 * out by the read, `lib/data/tool-export.ts`). A relative URL — a bundled
 * `/tool-images/…` photo — is made absolute against the deployment's origin,
 * so the file still means something once it has left the site, and a
 * placeholder link (`#`) is left out ({@link portableUrl}).
 *
 * Pure: the read is done elsewhere and handed in.
 */

/** Published, still a draft, or archived — archived wins, as on the review table. */
export type ToolExportStatus = "published" | "draft" | "archived";

/** One tool as the read hands it over: stored values, not display strings. */
export interface ToolExportRecord {
  id: string;
  slug: string;
  name: string;
  officialName: string | null;
  status: ToolExportStatus;
  itemKind: string;
  /** The slug of the tool this one is an accessory of. */
  accessoryOf: string | null;
  /** The top-level category (taxonomy v2), or a pre-v2 row's group. */
  category: string | null;
  /** The second-level category, when the tool's category sits under another. */
  subcategory: string | null;
  description: string | null;
  room: string | null;
  zone: string | null;
  mapTag: string | null;
  trainingRequired: boolean;
  ppe: string[];
  useRestrictions: string | null;
  emergencyStop: string | null;
  materials: string[];
  tags: string[];
  notes: string | null;
  unitLabels: string[];
  /** Public photo URLs, cover first. */
  photoUrls: string[];
  /** Public resource links (manuals, guides, videos), in the tool page's order. */
  resourceUrls: string[];
  lastReviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Joins a list into one cell. */
const LIST_SEPARATOR = "; ";

/** A column: its header, and the cell a record gives it. `origin` is the deployment's, for absolute URLs. */
interface ToolExportColumn {
  header: string;
  cell: (record: ToolExportRecord, origin: string) => CsvValue;
}

/** Every column, in file order. The headers are the file's contract with whoever imports it. */
export const TOOL_EXPORT_COLUMNS: readonly ToolExportColumn[] = [
  { header: "ID", cell: (r) => r.id },
  { header: "Slug", cell: (r) => r.slug },
  { header: "Name", cell: (r) => r.name },
  { header: "Official name", cell: (r) => r.officialName },
  { header: "Status", cell: (r) => r.status },
  { header: "Item kind", cell: (r) => r.itemKind },
  { header: "Accessory of", cell: (r) => r.accessoryOf },
  { header: "Category", cell: (r) => r.category },
  { header: "Subcategory", cell: (r) => r.subcategory },
  { header: "Description", cell: (r) => r.description },
  { header: "Room", cell: (r) => r.room },
  { header: "Zone", cell: (r) => r.zone },
  { header: "Map tag", cell: (r) => r.mapTag },
  { header: "Training required", cell: (r) => (r.trainingRequired ? "Yes" : "No") },
  { header: "PPE required", cell: (r) => list(r.ppe) },
  { header: "Use restrictions", cell: (r) => r.useRestrictions },
  { header: "Emergency stop", cell: (r) => r.emergencyStop },
  { header: "Materials", cell: (r) => list(r.materials) },
  { header: "Tags", cell: (r) => list(r.tags) },
  { header: "Notes", cell: (r) => r.notes },
  { header: "Unit count", cell: (r) => r.unitLabels.length },
  { header: "Unit labels", cell: (r) => list(r.unitLabels) },
  { header: "Photo URLs", cell: (r, origin) => urls(r.photoUrls, origin) },
  { header: "Resource URLs", cell: (r, origin) => urls(r.resourceUrls, origin) },
  { header: "Tool page URL", cell: (r, origin) => `${trimOrigin(origin)}/tools/${encodeURIComponent(r.slug)}` },
  { header: "Last reviewed", cell: (r) => r.lastReviewedAt?.toISOString() ?? "" },
  { header: "Created", cell: (r) => r.createdAt.toISOString() },
  { header: "Updated", cell: (r) => r.updatedAt.toISOString() },
];

/** The header record. */
export const TOOL_EXPORT_HEADERS: readonly string[] = TOOL_EXPORT_COLUMNS.map((column) => column.header);

/** One record's cells, in {@link TOOL_EXPORT_COLUMNS} order. */
export function toolExportRow(record: ToolExportRecord, origin: string): CsvValue[] {
  return TOOL_EXPORT_COLUMNS.map((column) => column.cell(record, origin));
}

/** The whole file. */
export function toolsCsv(records: readonly ToolExportRecord[], origin: string): string {
  return toCsv(
    TOOL_EXPORT_HEADERS,
    records.map((record) => toolExportRow(record, origin))
  );
}

/** `makerlab-tools-2026-09-29.csv`, the day in UTC. */
export function toolsCsvFilename(now: Date = new Date()): string {
  return `makerlab-tools-${now.toISOString().slice(0, 10)}.csv`;
}

function list(values: readonly string[]): string {
  return values
    .map((value) => value.trim())
    .filter(Boolean)
    .join(LIST_SEPARATOR);
}

/**
 * A link as it should leave the site: an `http(s)` URL normalised (a space
 * percent-encoded), a root-relative one resolved against `origin`, and
 * anything else — a placeholder `#`, a `javascript:` or `data:` URL — dropped,
 * because it means nothing (or something unwanted) outside the app.
 */
export function portableUrl(url: string, origin: string): string | null {
  const value = url.trim();
  if (!/^https?:\/\//i.test(value) && !/^\/(?!\/)/.test(value)) return null;
  try {
    const resolved = new URL(value, `${trimOrigin(origin)}/`);
    return resolved.protocol === "http:" || resolved.protocol === "https:" ? resolved.href : null;
  } catch {
    return null;
  }
}

function urls(values: readonly string[], origin: string): string {
  return list(values.flatMap((url) => portableUrl(url, origin) ?? []));
}

function trimOrigin(origin: string): string {
  return origin.replace(/\/+$/, "");
}

// Raw NotionPage fixtures.
//
// These mirror the *exact* shape that the `pageToX` parsers in
// `src/lib/notion.ts` read: each property carries a `type` discriminator
// (`title` | `rich_text` | `select` | `multi_select` | `relation` |
// `checkbox` | `url` | `date` | `files`) and the matching payload key. The
// parsers use `prop(page, names)` which picks the first present property from
// a list of candidate keys (snake_case first, then header-case fallbacks like
// `["name", "Name"]`).
//
// Pair these with the MSW handlers (test/msw/handlers.ts), which return them
// wrapped in `notionQueryResponse(...)`.

// ── Property builders (keep fixtures readable + correct) ────────────

export const titleProp = (text: string) => ({
  type: "title" as const,
  title: text ? [{ plain_text: text }] : [],
});

export const richTextProp = (text: string) => ({
  type: "rich_text" as const,
  rich_text: text ? [{ plain_text: text }] : [],
});

export const selectProp = (name: string | null) => ({
  type: "select" as const,
  select: name ? { name } : null,
});

export const multiSelectProp = (names: string[]) => ({
  type: "multi_select" as const,
  multi_select: names.map((name) => ({ name })),
});

export const relationProp = (ids: string[]) => ({
  type: "relation" as const,
  relation: ids.map((id) => ({ id })),
});

export const checkboxProp = (value: boolean) => ({
  type: "checkbox" as const,
  checkbox: value,
});

export const urlProp = (url: string | null) => ({
  type: "url" as const,
  url,
});

export const dateProp = (start: string | null) => ({
  type: "date" as const,
  date: start ? { start } : null,
});

/** External file (URL-hosted, e.g. a manufacturer link). */
export const externalFile = (name: string, url: string) => ({
  name,
  type: "external" as const,
  external: { url },
});

/** Notion-hosted file (the `file.url` form). */
export const hostedFile = (name: string, url: string) => ({
  name,
  type: "file" as const,
  file: { url },
});

export const filesProp = (
  files: ReturnType<typeof externalFile | typeof hostedFile>[]
) => ({
  type: "files" as const,
  files,
});

// A raw Notion page envelope. Properties are intentionally loosely typed
// (`Record<string, unknown>`) so the builders above can populate them; the
// parsers in notion.ts narrow each property via its `type` field at runtime.
export interface NotionPageFixture {
  object: "page";
  id: string;
  created_time: string;
  last_edited_time: string;
  properties: Record<string, unknown>;
}

const TS = "2024-08-12T10:00:00.000Z";

function page(
  id: string,
  properties: Record<string, unknown>
): NotionPageFixture {
  return {
    object: "page",
    id,
    created_time: TS,
    last_edited_time: TS,
    properties,
  };
}

// ── Image attachment URLs ──────────────────────────────────────────
//
// `pickFreshImageUrl` drops any URL containing a stale host
// (`airtableusercontent.com`). The tool fixture's `image_attachments` includes
// BOTH a stale URL and a fresh one so tests can exercise the filtering.
export const STALE_IMAGE_URL =
  "https://v5.airtableusercontent.com/stale/form4.png";
export const FRESH_IMAGE_URL =
  "https://files.notion.so/fresh/form4.png";

// ── Fixtures ────────────────────────────────────────────────────────

export const toolsPage: NotionPageFixture = page("tool-1", {
  name: titleProp("Form 4"),
  description: richTextProp("A production-grade resin printer."),
  category: relationProp(["cat-1"]),
  location: relationProp(["loc-1"]),
  materials: multiSelectProp(["Standard resin", "Tough resin"]),
  ppe_required: multiSelectProp(["Nitrile gloves", "Safety glasses"]),
  tags: multiSelectProp(["Resin", "SLA"]),
  training_required: checkboxProp(true),
  use_restrictions: richTextProp("Resin handling training required."),
  emergency_stop: richTextProp("Lift the lid to halt the print."),
  // First file is stale (airtableusercontent.com), second is fresh — exercises
  // pickFreshImageUrl. fileAttachments reads `external.url` for external files.
  image_attachments: filesProp([
    externalFile("stale.png", STALE_IMAGE_URL),
    externalFile("fresh.png", FRESH_IMAGE_URL),
  ]),
  notes: richTextProp("Always wear nitrile gloves."),
  published: checkboxProp(true),
});

export const categoriesPage: NotionPageFixture = page("cat-1", {
  name: titleProp("Resin"),
  group: selectProp("3D Printing"),
});

export const locationsPage: NotionPageFixture = page("loc-1", {
  // pageToLocation reads the title via ["id","ID","Name"] — the human-readable
  // location id lives in the title.
  id: titleProp("ML-RESIN-01"),
  zone: selectProp("Resin Bench"),
  room: selectProp("MakerLab"),
});

export const unitsPage: NotionPageFixture = page("unit-1", {
  unit_label: titleProp("Form 4 #1"),
  tool: relationProp(["tool-1"]),
  serial_number: richTextProp("ML-F4-001"),
  asset_tag: richTextProp("AT-0001"),
  status: selectProp("Available"),
  condition: selectProp("Excellent"),
  date_acquired: richTextProp("2024-08-12"),
  notes: richTextProp("Primary resin unit."),
});

// Resource with BOTH a url AND a files entry (one external, one hosted) so the
// resourceLinks / pickPdfUrl logic can be exercised. One PDF file is included.
export const resourcesPage: NotionPageFixture = page("res-1", {
  title: titleProp("Form 4 SOP"),
  tool: relationProp(["tool-1"]),
  type: selectProp("SOP"),
  url: urlProp("https://example.com/form4-sop"),
  files: filesProp([
    externalFile("form4-manual.pdf", "https://example.com/form4-manual.pdf"),
    hostedFile("safety.png", "https://files.notion.so/safety.png"),
  ]),
  notes: richTextProp("Standard operating procedure."),
  published: checkboxProp(true),
});

export const maintenanceLogsPage: NotionPageFixture = page("log-1", {
  title: titleProp("Resin tank cloudy"),
  unit: relationProp(["unit-1"]),
  type: selectProp("Issue Report"),
  priority: selectProp("Medium"),
  status: selectProp("Open"),
  reported_by: richTextProp("Ada Lovelace"),
  assigned_to: richTextProp("Lab Staff"),
  description: richTextProp("The resin tank looks cloudy after the last print."),
  resolution: richTextProp(""),
  date_reported: dateProp("2024-09-01"),
  date_resolved: dateProp(null),
  photo_attachments: filesProp([
    externalFile("photo.jpg", "https://example.com/photo.jpg"),
  ]),
});

// ── Query response helper ───────────────────────────────────────────

export interface NotionQueryResponse {
  object: "list";
  results: NotionPageFixture[];
  has_more: boolean;
  next_cursor: string | null;
}

/**
 * Wrap fixture pages in a Notion `databases/:id/query` response envelope.
 *
 * @param pages   the page fixtures to return as `results`
 * @param opts.hasMore     sets `has_more` (drives pagination loops in notion.ts)
 * @param opts.nextCursor  sets `next_cursor` (the cursor the client sends next)
 */
export function notionQueryResponse(
  pages: NotionPageFixture[],
  opts: { hasMore?: boolean; nextCursor?: string } = {}
): NotionQueryResponse {
  return {
    object: "list",
    results: pages,
    has_more: opts.hasMore ?? false,
    next_cursor: opts.nextCursor ?? null,
  };
}

/** All single-record fixtures keyed by id — handy for `GET /pages/:id`. */
export const pagesById: Record<string, NotionPageFixture> = {
  [toolsPage.id]: toolsPage,
  [categoriesPage.id]: categoriesPage,
  [locationsPage.id]: locationsPage,
  [unitsPage.id]: unitsPage,
  [resourcesPage.id]: resourcesPage,
  [maintenanceLogsPage.id]: maintenanceLogsPage,
};

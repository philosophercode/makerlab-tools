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

export const emailProp = (email: string | null) => ({
  type: "email" as const,
  email,
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

// A Flags row, with the property names `capabilities/flags.ts` writes. Not in
// the default query handler (the flags DB returns [] by default); the import
// tests serve it with `server.use(...)`.
export const flagsPage: NotionPageFixture = page("flag-1", {
  title: titleProp("Form 4 — description"),
  tool: relationProp(["tool-1"]),
  field_flagged: selectProp("description"),
  issue_description: richTextProp("The description says 80W but the label says 60W."),
  suggested_fix: richTextProp("Change 80W to 60W."),
  reporter: richTextProp("Ada Lovelace"),
  reporter_email: emailProp("ada@cornell.edu"),
  status: selectProp("New"),
});

// A published project with one photo, built with the Form 4.
export const projectsPage: NotionPageFixture = page("project-1", {
  title: titleProp("Laser-cut lamp"),
  author: richTextProp("Ada Lovelace"),
  body: richTextProp("A lamp cut from plywood."),
  photos: filesProp([hostedFile("lamp.jpg", "https://files.notion.so/lamp.jpg")]),
  tools_used: relationProp(["tool-1"]),
  link: urlProp("https://example.com/lamp"),
  materials: multiSelectProp(["Plywood"]),
  published: checkboxProp(true),
});

/** All single-record fixtures keyed by id — handy for `GET /pages/:id`. */
export const pagesById: Record<string, NotionPageFixture> = {
  [toolsPage.id]: toolsPage,
  [categoriesPage.id]: categoriesPage,
  [locationsPage.id]: locationsPage,
  [unitsPage.id]: unitsPage,
  [resourcesPage.id]: resourcesPage,
  [maintenanceLogsPage.id]: maintenanceLogsPage,
  [flagsPage.id]: flagsPage,
  [projectsPage.id]: projectsPage,
};

// ── Database schemas (GET /databases/:id) ───────────────────────────
//
// What the import pre-flight reads: each property's type and, for selects,
// the *defined* options. These are the option sets the live workspace defines
// (2026-08-14 audit), including `New` and `Closed`, which are defined but unused.

export interface DatabaseSchemaFixture {
  object: "database";
  id: string;
  properties: Record<
    string,
    {
      type: string;
      select?: { options: { name: string }[] };
      multi_select?: { options: { name: string }[] };
    }
  >;
}

export type SchemaTable =
  | "tools"
  | "categories"
  | "locations"
  | "units"
  | "resources"
  | "maintenance_logs"
  | "flags"
  | "projects";

const SELECT_OPTIONS: Record<SchemaTable, Record<string, string[]>> = {
  tools: {},
  categories: { group: ["3D Printing", "Laser"] },
  locations: { room: ["MakerLab", "Laser Room"], zone: ["Resin Bench", "Laser Bay"] },
  units: {
    status: ["Available", "In Use", "Under Maintenance", "Out of Service", "Retired"],
    condition: ["Excellent", "Good", "Fair", "Needs Repair", "New"],
  },
  resources: { type: ["SOP", "Manual", "Video", "Other"] },
  maintenance_logs: {
    type: ["Issue Report", "Preventive Maintenance", "Repair", "Inspection", "Calibration"],
    priority: ["Critical", "High", "Medium", "Low"],
    status: ["Open", "In Progress", "Resolved", "Closed"],
  },
  flags: {
    field_flagged: ["description", "image", "name", "category", "location", "materials", "safety_info"],
    status: ["New", "Reviewed", "Fixed", "Dismissed"],
  },
  projects: {},
};

/** A fresh, mutable schema fixture for `table` (tests may edit the options). */
export function databaseSchema(table: SchemaTable): DatabaseSchemaFixture {
  const properties: DatabaseSchemaFixture["properties"] = {};
  for (const [name, options] of Object.entries(SELECT_OPTIONS[table])) {
    properties[name] = { type: "select", select: { options: options.map((option) => ({ name: option })) } };
  }
  return { object: "database", id: `db-${table.replace("_logs", "")}`, properties };
}

/**
 * Stored vocabularies (data platform design spec 2026-09-14 §4.1).
 *
 * Every value here is a machine identifier: lower-case, snake_case, stable.
 * Display text comes from `next-intl` (constitution Article 6), never from the
 * database. Each list backs a named CHECK constraint on a `text` column rather
 * than a `pgEnum`, because adding a value to an enum cannot run inside the
 * transaction a migration uses and adding one to a CHECK can.
 *
 * The lists come from Notion's *defined* option sets, not the values in use —
 * the 2026-08-14 audit found `New` (unit condition) and `Closed` (maintenance
 * status) defined but unused, and a constraint that omitted them would have
 * refused a legitimate write in production. The import's pre-flight compares
 * Notion's option sets against these lists and stops on anything unmapped.
 */

export const ROLES = ["user", "admin", "super_admin"] as const;
export type Role = (typeof ROLES)[number];

export const UNIT_STATUS = [
  "available",
  "in_use",
  "under_maintenance",
  "out_of_service",
  "retired",
] as const;
export type UnitStatus = (typeof UNIT_STATUS)[number];

export const UNIT_CONDITION = ["excellent", "good", "fair", "needs_repair", "new"] as const;
export type UnitCondition = (typeof UNIT_CONDITION)[number];

export const MAINTENANCE_TYPE = [
  "issue_report",
  "preventive_maintenance",
  "repair",
  "inspection",
  "calibration",
] as const;
export type MaintenanceType = (typeof MAINTENANCE_TYPE)[number];

export const MAINTENANCE_PRIORITY = ["low", "medium", "high", "critical"] as const;
export type MaintenancePriority = (typeof MAINTENANCE_PRIORITY)[number];

export const MAINTENANCE_STATUS = ["open", "in_progress", "resolved", "closed"] as const;
export type MaintenanceStatus = (typeof MAINTENANCE_STATUS)[number];

export const FEEDBACK_STATUS = ["new", "reviewed", "fixed", "dismissed"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUS)[number];

export const FLAG_FIELDS = [
  "description",
  "image",
  "name",
  "category",
  "location",
  "materials",
  "safety_info",
] as const;
export type FlagField = (typeof FLAG_FIELDS)[number];

/**
 * Where a pending tool is in the two-step add-tool flow (spec §4.10, §5.4).
 * Declared in the order an item moves through it: identified in the chat,
 * queued and researched in the background, then approved or discarded by a
 * person. `failed` sits beside `researched` because both are the end of one
 * research run and both can be researched again.
 */
export const PENDING_STATUS = [
  "identified",
  "queued",
  "researching",
  "researched",
  "failed",
  "approved",
  "discarded",
] as const;
export type PendingStatus = (typeof PENDING_STATUS)[number];

/**
 * What the person decided about a pending item the duplicate check matched
 * (spec §5.4 step 5): a second unit of the matched tool, a different tool after
 * all, or not worth keeping.
 */
export const DUPLICATE_RESOLUTION = ["new_tool", "add_unit", "discard"] as const;
export type DuplicateResolution = (typeof DUPLICATE_RESOLUTION)[number];

export const ATTACHMENT_OWNER = [
  "tool",
  "resource",
  "maintenance_log",
  "project",
  "pending_tool",
  // The file a bulk import was read from (bulk intake spec §4.1): private, kept as the source.
  "bulk_import",
] as const;
export type AttachmentOwner = (typeof ATTACHMENT_OWNER)[number];

export const ATTACHMENT_ACCESS = ["public", "private"] as const;
export type AttachmentAccess = (typeof ATTACHMENT_ACCESS)[number];

/**
 * How a file came to be stored (gateway spec §4.2): a person's upload, the
 * Notion import, the manual archiver's copy of a manufacturer PDF, a product
 * image an admin chose at approval, or the background-removed copy research
 * made of one. Null on rows written before migration `0008`.
 *
 * It is what tells a cleaned candidate from a person's own photo when both are
 * owned by the same pending item — "an uploaded photo" is `origin` null or
 * `upload`, never a `research_image*` row.
 */
export const ATTACHMENT_ORIGIN = [
  "upload",
  "import",
  "manual_archive",
  "research_image",
  "research_image_cleaned",
] as const;
export type AttachmentOrigin = (typeof ATTACHMENT_ORIGIN)[number];

/**
 * What a Notion mirror pushes, one Notion database each (spec §3.8, §4.12).
 *
 * **Declared in dependency order, and that order is the push order**: a tool
 * page relates to its category and location, a unit to its tool, and so on, so
 * a page is only ever created after the pages it points at. `maintenance` is
 * `maintenance_logs` in Postgres; the short name is what the admin page shows
 * and what `mirror_pages.entity` stores.
 */
export const MIRROR_ENTITY = [
  "categories",
  "locations",
  "tools",
  "units",
  "resources",
  "maintenance",
  "projects",
] as const;
export type MirrorEntity = (typeof MIRROR_ENTITY)[number];

/**
 * The result of a mirror's last push (spec §3.8 "Status"): everything pushed,
 * some rows failed (`last_synced_at` does not advance, so they are retried), or
 * nothing could be pushed at all.
 */
export const MIRROR_STATUS = ["ok", "partial", "failed"] as const;
export type MirrorStatus = (typeof MIRROR_STATUS)[number];

/**
 * What processing a stored manual PDF came to (manual text spec §3.2, §4;
 * migration `0010`): its text is stored page by page (`ready`), it has no text
 * layer worth storing — a scan (`no_text`) — or it could not be read at all
 * (`failed`: encrypted, corrupt, or over the size, page or time limits).
 * "Processing" is not a stored state: it is a PDF with no document row yet.
 */
export const MANUAL_DOCUMENT_STATUS = ["ready", "no_text", "failed"] as const;
export type ManualDocumentStatus = (typeof MANUAL_DOCUMENT_STATUS)[number];

/**
 * Where a manual's outline came from (§3.2): the PDF's own bookmarks,
 * headings inferred from font size, or neither.
 */
export const MANUAL_OUTLINE_SOURCE = ["pdf", "inferred", "none"] as const;
export type ManualOutlineSource = (typeof MANUAL_OUTLINE_SOURCE)[number];

/**
 * Where a refresh of an existing tool is (refresh research spec §4.1; migration
 * `0012`): queued by an admin, researched in the background, then waiting with
 * its proposals — or failed — until a person has decided every one.
 */
export const REFRESH_STATUS = ["queued", "researching", "proposed", "failed", "decided"] as const;
export type RefreshStatus = (typeof REFRESH_STATUS)[number];

/** The refresh statuses that count as "open": at most one per tool (the partial unique index). */
export const OPEN_REFRESH_STATUS = ["queued", "researching", "proposed"] as const satisfies readonly RefreshStatus[];

/**
 * What a chat proposal is about (spec §12.2): a catalogue tool, or a pending
 * item on its preliminary page.
 */
export const PROPOSAL_SUBJECT_KIND = ["tool", "pending"] as const;
export type ProposalSubjectKind = (typeof PROPOSAL_SUBJECT_KIND)[number];

/**
 * Where a bulk import's list came from (bulk intake spec §4.1; migration
 * `0013`): a CSV or TSV file, text pasted on `/admin/intake`, a document
 * (plain text, Markdown or a PDF's text) read by a model, or the chat's
 * `start_import` hand-off.
 */
export const IMPORT_SOURCE_KIND = ["csv", "tsv", "paste", "document", "chat"] as const;
export type ImportSourceKind = (typeof IMPORT_SOURCE_KIND)[number];

/**
 * How an import's text is read (§3.2): a table with a header row (CSV, TSV or
 * pasted spreadsheet cells), a plain list one item a line, or a free-form
 * document a model extracts items from.
 */
export const IMPORT_FORMAT = ["table", "list", "document"] as const;
export type ImportFormat = (typeof IMPORT_FORMAT)[number];

/**
 * Where an import is (§4.1, amended): a table waiting for its column matches to
 * be confirmed (`mapping`), a document a model is reading (`parsing`), its rows
 * created as pending items (`ready`), or nothing usable found (`failed`).
 */
export const IMPORT_STATUS = ["mapping", "parsing", "ready", "failed"] as const;
export type ImportStatus = (typeof IMPORT_STATUS)[number];

/**
 * How a resource came to be (bulk intake spec §3.4): null for every ordinary
 * link, `lab_document` for the lab's own material an import carried through —
 * a Google Doc, an SOP. A lab document is **never fetched**: no link check, no
 * archive, nothing passed to research or the chat's `read_page`.
 */
export const RESOURCE_ORIGIN = ["lab_document"] as const;
export type ResourceOrigin = (typeof RESOURCE_ORIGIN)[number];

/** True when `value` is one of `list`; narrows the type. */
export function isOneOf<const T extends readonly string[]>(
  list: T,
  value: string | null | undefined
): value is T[number] {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

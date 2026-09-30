import { sql } from "drizzle-orm";
import { boolean, foreignKey, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { actorColumns, inListCheck, notionPageId, timestamps, userReference } from "./helpers.ts";
import { TOOL_ITEM_KIND } from "./vocabulary.ts";
import { categories, locations } from "./taxonomy.ts";

/**
 * Tools (data platform design spec 2026-09-14 §4.4).
 *
 * - `slug` is derived from the name once, at creation, and never changes on a
 *   rename, so `/tools/<slug>` links stay valid.
 * - `notion_page_id` keeps the legacy URL key: printed QR labels and old links
 *   of the form `/tools/<notion-page-id>` redirect through it (spec Goal 2).
 * - Tools are archived (`archived_at`), never deleted, because maintenance
 *   history refers to them.
 * - The trigram index backs the duplicate check when equipment is added.
 */
export const tools = pgTable(
  "tools",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    /**
     * The **display name** (tool display names spec 2026-09-24): short, what
     * people say, ≤ 40 characters, no part numbers — what every surface shows.
     */
    name: text("name").notNull(),
    /**
     * The **official name**: the full product name with brand and model or part
     * number, for search, manuals, research and MCP. Null means not recorded;
     * readers fall back to `name`.
     */
    officialName: text("official_name"),
    description: text("description"),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),
    materials: text("materials").array().notNull().default(sql`'{}'::text[]`),
    ppeRequired: text("ppe_required").array().notNull().default(sql`'{}'::text[]`),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    trainingRequired: boolean("training_required").notNull().default(false),
    useRestrictions: text("use_restrictions"),
    emergencyStop: text("emergency_stop"),
    notes: text("notes"),
    /**
     * What to write down from the machine's nameplate when refresh research
     * could not identify it (refresh research spec §4.1): set by accepting a
     * `floor_check` proposal, cleared in the editor. Null means no check owed.
     */
    floorCheck: text("floor_check"),
    /**
     * Up to three questions the assistant offers as starter chips on this
     * tool's page (spec amendment "Tool-specific starter questions"). Written
     * by approval from research, or by staff in the editor; empty means the
     * generic chips.
     */
    starterQuestions: text("starter_questions").array().notNull().default(sql`'{}'::text[]`),
    /**
     * What the record is (taxonomy v2 spec §3 facets): a piece of `equipment`,
     * an `accessory` of one (a plunge base, an air manager), a `consumable`
     * (sanding sheets, masks) or a `fixture` (benches, carts). A facet, not a
     * category, so an accessory stays beside the tool it fits.
     */
    itemKind: text("item_kind").notNull().default("equipment"),
    /** The tool an accessory belongs to (plunge base → router). Null for everything else. */
    parentToolId: uuid("parent_tool_id"),
    published: boolean("published").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
    lastReviewedBy: userReference("last_reviewed_by"),
    notionPageId: notionPageId(),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    index("tools_name_trgm_idx").using("gin", sql`${t.name} gin_trgm_ops`),
    index("tools_category_idx").on(t.categoryId),
    index("tools_location_idx").on(t.locationId),
    inListCheck("tools_item_kind_check", "item_kind", TOOL_ITEM_KIND),
    foreignKey({ columns: [t.parentToolId], foreignColumns: [t.id], name: "tools_parent_tool_id_fk" }).onDelete("set null"),
  ]
);

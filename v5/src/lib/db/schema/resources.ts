import { boolean, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { actorColumns, notionPageId, timestamps } from "./helpers.ts";
import { tools } from "./tools.ts";

/**
 * Resources — manuals, SOPs, videos and other links attached to a tool
 * (spec §4.6).
 *
 * `type` is free text with no CHECK: the workspace defines about a dozen
 * options and intake narrows them to three, so a constraint built from either
 * list would reject values already stored. A resource's file, if it has one,
 * is an `attachments` row owned by the resource.
 */
export const resources = pgTable(
  "resources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    toolId: uuid("tool_id").references(() => tools.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    type: text("type"),
    url: text("url"),
    notes: text("notes"),
    published: boolean("published").notNull().default(true),
    notionPageId: notionPageId(),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [index("resources_tool_idx").on(t.toolId)]
);

import { sql } from "drizzle-orm";
import { boolean, index, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { actorColumns, notionPageId, timestamps } from "./helpers.ts";
import { tools } from "./tools.ts";

/**
 * Student projects (spec §4.10).
 *
 * `author_user_id` is required on rows the app creates (projects need
 * sign-in) and null only on imported posts, which predate accounts. Photos are
 * `attachments` rows owned by the project; the lowest `position` is the cover.
 */
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    link: text("link"),
    materials: text("materials").array().notNull().default(sql`'{}'::text[]`),
    authorUserId: text("author_user_id"),
    authorName: text("author_name"),
    published: boolean("published").notNull().default(false),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedBy: text("published_by"),
    notionPageId: notionPageId(),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [index("projects_published_idx").on(t.published)]
);

/** Which tools a project was built with; both sides cascade. */
export const projectTools = pgTable(
  "project_tools",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    toolId: uuid("tool_id")
      .notNull()
      .references(() => tools.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.toolId] }), index("project_tools_tool_idx").on(t.toolId)]
);

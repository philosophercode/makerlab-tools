import { doublePrecision, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { inListCheck } from "./checks.ts";
import { tools } from "./tools.ts";
import { TOOL_SKILL_STATUS, TOOL_SKILL_TRIGGER } from "./vocabulary.ts";

/**
 * Tool skills (tool skills spec 2026-10-07; migration `0031`): every operating
 * guide a tool has had, written by job `skillWrite` from the lab's sources —
 * its catalogue record, research, lab notes, linked documents and manual
 * passages — and checked by code before it is stored.
 *
 * - **Versioned per tool**, over every row: 1, 2, 3… (`unique (tool_id,
 *   version)`). A tool's **current skill** is its latest `ready` row; a later
 *   `failed` row never hides it.
 * - `content` is the markdown rendered by code from `sections` and `sources`
 *   (`lib/skills/render.ts`); `sections` is the structured form, kept so the
 *   chat can re-render it compactly; `sources` holds only the sources the skill
 *   cites — a manual by document id and pages, never a file URL, so a row is
 *   the same on every deployment (backed up and pushed, the default).
 * - `input_hash` is a digest of everything the writer was given, the prompt
 *   version and the model (`lib/skills/hash.ts`): an automatic write whose
 *   inputs hash the same as the current skill's is skipped.
 * - `cost_usd` is the Gateway's reported cost (0 when none was reported);
 *   `error` is a failed row's one-line reason, never a prompt.
 * - Cascades with its tool: a skill means nothing without the machine.
 */
export const toolSkills = pgTable(
  "tool_skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    toolId: uuid("tool_id")
      .notNull()
      .references(() => tools.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: text("status").notNull(),
    content: text("content").notNull().default(""),
    sections: jsonb("sections").notNull().default({}),
    sources: jsonb("sources").notNull().default([]),
    inputHash: text("input_hash").notNull(),
    model: text("model").notNull(),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    trigger: text("trigger").notNull(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("tool_skills_tool_version_key").on(t.toolId, t.version),
    inListCheck("tool_skills_status_check", "status", TOOL_SKILL_STATUS),
    inListCheck("tool_skills_trigger_check", "trigger", TOOL_SKILL_TRIGGER),
    index("tool_skills_current_idx").on(t.toolId, t.status, t.version),
    index("tool_skills_created_idx").on(t.createdAt),
  ]
);

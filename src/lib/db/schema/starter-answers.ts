import { boolean, index, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { timestamps } from "./helpers.ts";
import { tools } from "./tools.ts";

/**
 * Pre-run answers to the assistant's starter chips (starter answers, migration
 * `0026`): `npm run starters:refresh` asks every chip's question through the
 * real chat pipeline as an **anonymous** visitor, grades the answer, and keeps
 * it here, so clicking the chip answers at once with no model call.
 *
 * - `tool_id` is the tool whose page shows the chip; **null** for the general
 *   opening chips (operate / debug / create) shown off a tool page.
 * - `question` is the chip's exact text; a chip uses a row only when its text
 *   matches (`unique` on tool, locale, question — nulls not distinct, so the
 *   general chips are unique too). Only `en` is written today.
 * - `message` is the assistant's `UIMessage` as the chat would have streamed
 *   it — text, tool parts with their outputs (the manual passages its
 *   citations resolve against) — minus reasoning and provider metadata, which
 *   belong to the run that made it (`lib/starters/answer.ts`).
 * - `accepted` is the grade's verdict; only accepted rows are served.
 *   `grade` holds the score and the reasons, for the admin view and reports.
 * - `usage_events` is what the answer counted as in Usage Insight when it was
 *   made (tool asked, manual pages cited) — replayed, with the clicker's
 *   audience, when a chip serves it. It names nobody.
 * - `source_hash` is a digest of what the answer depended on — the tool's
 *   revision, its resources and indexed manuals, the pipeline version and the
 *   chat model (`lib/starters/hash.ts`). A row whose hash no longer matches
 *   the current inputs is **stale** and never served; the chip answers live.
 */
export const starterAnswers = pgTable(
  "starter_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    toolId: uuid("tool_id").references(() => tools.id, { onDelete: "cascade" }),
    locale: text("locale").notNull().default("en"),
    question: text("question").notNull(),
    message: jsonb("message").notNull(),
    model: text("model").notNull(),
    accepted: boolean("accepted").notNull(),
    grade: jsonb("grade").notNull(),
    usageEvents: jsonb("usage_events").notNull().default([]),
    sourceHash: text("source_hash").notNull(),
    ...timestamps(),
  },
  (t) => [
    unique("starter_answers_chip_key").on(t.toolId, t.locale, t.question).nullsNotDistinct(),
    index("starter_answers_tool_idx").on(t.toolId),
  ]
);

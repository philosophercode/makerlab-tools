import { doublePrecision, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import { inListCheck } from "./checks.ts";
import { ILLUSTRATION_KIND, ILLUSTRATION_STATUS } from "./vocabulary.ts";

/**
 * Chat illustrations (gateway spec amendment 2026-10-07 "Generated
 * illustrations in the chat"; migration `0030`): one row per illustration a
 * signed-in person asked the assistant for — the ledger the per-person daily
 * cap and the lab-wide daily budget are counted from, and the record of where
 * the picture is.
 *
 * - **Its own table, never `attachments`.** Nothing that claims, promotes or
 *   publishes an attachment can reach an illustration: it can never become a
 *   tool's photo, a ticket's photo or a project's. The picture is a private
 *   blob under `chat/illustrations/`, served only to the person who asked for
 *   it (`/api/chat/illustrations/[id]`).
 * - **No words of the conversation.** The prompt is built from the plan or
 *   idea on the server and sent to the model, never stored; this row holds
 *   only what the caps and the image route need.
 * - **Reserved, then finished.** A row is inserted `pending` with the
 *   estimated cost before the model is called (under an advisory lock, so two
 *   requests cannot both take the last place), then becomes `ready` with the
 *   Gateway's reported cost, or `failed` with cost 0 when no image came back.
 * - `user_id` cascades: the ledger is the person's own, and removing their
 *   account removes it (the private blobs stay unreachable without the row).
 */
export const chatIllustrations = pgTable(
  "chat_illustrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("pending"),
    /** The Gateway model id that drew it (`MODEL_ILLUSTRATION` or the default). */
    model: text("model").notNull(),
    /** Dollars: the estimate while pending, the reported cost once ready (else the estimate), 0 when failed. */
    costUsd: doublePrecision("cost_usd").notNull(),
    /** The private blob, once stored. */
    blobPathname: text("blob_pathname"),
    contentType: text("content_type"),
    width: integer("width"),
    height: integer("height"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    inListCheck("chat_illustrations_kind_check", "kind", ILLUSTRATION_KIND),
    inListCheck("chat_illustrations_status_check", "status", ILLUSTRATION_STATUS),
    index("chat_illustrations_user_idx").on(t.userId, t.createdAt),
    index("chat_illustrations_created_idx").on(t.createdAt),
  ]
);

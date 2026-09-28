import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { inListCheck, timestamps, userReference } from "./helpers.ts";
import { ACTION_PROPOSAL_STATUS, ACTION_PROPOSAL_SURFACE } from "./vocabulary.ts";

/**
 * `action_proposals` — one change the assistant put in front of a person, to
 * be committed only by that person's click (assistant–GUI parity spec §3.5;
 * migration `0020`).
 *
 * - `action_id` names a registered definition (`lib/actions/registry.ts`);
 *   `input` is exactly what `performAction` will be handed at confirm. Nothing
 *   the confirm request carries reaches it — the request names ids only.
 * - `preview` is what the card shows, read from the database when the
 *   proposal was made (a next-intl key, its values, before → after rows, the
 *   subject's name). Never the model's words (§8.4).
 * - One row per subject; a batch card is the rows sharing `group_id`.
 * - `created_by` alone may confirm (§11 answer 11). `result` holds the
 *   outcome — `{ error?, warning? }` — and together with the row it is the
 *   trail of what the assistant did (§11 answer 9).
 * - `expires_at` is 60 minutes after a chat proposal, 7 days after an MCP one
 *   (§11 answer 7). An open row past it is expired.
 * - `subject_id` is text and not a foreign key: subjects are users, tickets,
 *   corrections, projects and addresses, and a proposal outlives none of them
 *   in any way worth enforcing.
 *
 * Relative imports with `.ts` extensions, like every schema module.
 */
export const actionProposals = pgTable(
  "action_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id").notNull(),
    actionId: text("action_id").notNull(),
    input: jsonb("input").$type<unknown>().notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    preview: jsonb("preview").$type<Record<string, unknown>>().notNull(),
    surface: text("surface").notNull(),
    chatId: text("chat_id"),
    status: text("status").notNull().default("open"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    /** Proposed in a turn that read outside text (§8.4); set from phase 6. */
    tainted: boolean("tainted").notNull().default(false),
    createdBy: userReference("created_by"),
    // The proposer's name, written only when their account is removed (as on
    // `chat_proposals`; `data/user-removal.ts`).
    createdByName: text("created_by_name"),
    decidedBy: userReference("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps(),
  },
  (t) => [
    inListCheck("action_proposals_status_check", "status", ACTION_PROPOSAL_STATUS),
    inListCheck("action_proposals_surface_check", "surface", ACTION_PROPOSAL_SURFACE),
    index("action_proposals_creator_status_idx").on(t.createdBy, t.status),
    index("action_proposals_chat_idx").on(t.chatId),
    index("action_proposals_group_idx").on(t.groupId),
  ]
);

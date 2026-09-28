import type { QueueActionResult } from "../../../lib/admin/queue-write";

/**
 * What `/admin/insights`' server actions answer, and where the page lives.
 * Directive-free, like every admin surface's result module: a `"use server"`
 * module may export only async functions, and the island renders these codes.
 */

export const INSIGHTS_PATH = "/admin/insights";

/** Why a gap decision did not land. Each has an `admin.errors.<code>` message. */
export type InsightsWriteError = "not_found" | "invalid_field";

export type InsightsActionResult = QueueActionResult<InsightsWriteError>;

/** The shape the Unanswered queue's island takes for each decision. */
export type GapDecisionAction = (input: { gapId: string }) => Promise<InsightsActionResult>;

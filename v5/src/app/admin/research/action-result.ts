import type { AdminGateError } from "../../../lib/admin/action-result";

/**
 * What the Manuals page's one action answers, and where it lives — its own
 * module because `actions.ts` carries `"use server"` and may export only async
 * functions.
 */
export const MANUALS_PATH = "/admin/research";

export type ReprocessManualError = AdminGateError | "not_found";

export type ReprocessManualResult = { ok: true } | { ok: false; error: ReprocessManualError };

export type ReprocessManualAction = (input: { resourceId: string }) => Promise<ReprocessManualResult>;

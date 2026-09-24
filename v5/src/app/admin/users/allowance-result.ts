import type { AdminActionWarning, AdminGateError } from "../../../lib/admin/action-result";

/**
 * **Grant a setup allowance**'s answer (bulk intake spec §4.2). Apart from the
 * action because a `"use server"` module may export only async functions.
 */
export type GrantAllowanceResult =
  | { ok: true; expiresAt: string; warning?: AdminActionWarning }
  | { ok: false; error: AdminGateError | "invalid_field" | "unknown_user" | "cannot_research" };

export type GrantAllowanceAction = (input: { userId: string; extraItems: number; days: number }) => Promise<GrantAllowanceResult>;

/** A person who may be granted one, and what they hold now. */
export interface AllowanceCandidate {
  id: string;
  name: string;
  email: string;
  /** Extra items still running, summed; 0 for none. */
  activeExtra: number;
  /** When the latest running grant ends, ISO; null for none. */
  activeUntil: string | null;
}

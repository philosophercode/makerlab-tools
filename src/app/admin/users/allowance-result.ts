import type { AdminActionWarning, AdminGateError } from "../../../lib/admin/action-result";

/**
 * Where setup allowances are granted, and the page a grant refreshes: the
 * research budget sits under Settings › AI agents since the admin sections
 * spec (2026-10-07), no longer on the People roster. The action stays here,
 * beside the roster's, because it is a change to a person.
 */
export const AI_AGENTS_PATH = "/admin/settings/ai-agents";

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

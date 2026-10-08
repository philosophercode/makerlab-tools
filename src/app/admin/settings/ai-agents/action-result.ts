import type { AdminGateError } from "../../../../lib/admin/action-result";

/**
 * What Settings › AI agents' skill writer control answers, and where the page
 * lives (tool skills spec 2026-10-07 §6). Directive-free: a `"use server"`
 * module may export only async functions.
 */
export const AI_AGENTS_PATH = "/admin/settings/ai-agents";

export type SkillWritingError = "invalid_field";

export type SkillWritingResult = { ok: true } | { ok: false; error: AdminGateError | SkillWritingError };

export type SetSkillWritingAction = (input: { afterResearch: boolean }) => Promise<SkillWritingResult>;

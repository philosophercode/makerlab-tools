import type { AdminGateError } from "../../../../../lib/admin/action-result";

/**
 * What a tool's skill page's one action answers, and where the page lives
 * (tool skills spec 2026-10-07 §6). Directive-free, like every admin result
 * module: a `"use server"` module may export only async functions.
 */

/** A tool's skill page. */
export function toolSkillPath(slug: string): string {
  return `/admin/inventory/${encodeURIComponent(slug)}/skill`;
}

/**
 * Why Write skill did not start, each an `admin.errors.<code>`: the tool is
 * gone or archived, it has nothing beyond its catalogue record to write from,
 * the lab reached today's cap, or the run could not be started.
 */
export type WriteToolSkillError = "not_found" | "nothing_to_write" | "skill_daily_limit" | "start_failed";

export type WriteToolSkillResult = { ok: true } | { ok: false; error: AdminGateError | WriteToolSkillError };

export type WriteToolSkillAction = (input: { toolId: string }) => Promise<WriteToolSkillResult>;

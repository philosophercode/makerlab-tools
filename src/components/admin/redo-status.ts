import { REDO_HIGHLIGHT_WINDOW_MS } from "../../lib/intake/limits";
import type { ResearchFocusField } from "../../lib/intake/research-focus";
import type { ResearchResult } from "../../lib/research/result";

/**
 * The words a guided redo is shown in (amendment "Guided redo (focus +
 * guidance)"), shared by the preliminary page (a client component) and the
 * item page's status notice (a server component). Directive-free: both import
 * it, each with its own `admin.intake` translator.
 */

/** An `admin.intake` translator, as either side has one. */
export type IntakeTranslate = (key: string, values?: Record<string, string | number>) => string;

/**
 * "Re-researching the specs and links & manuals…", or "Researching everything
 * again…" for no focus. `notice` gives the longer line the status page shows.
 */
export function redoWhat(
  t: IntakeTranslate,
  locale: string,
  focus: readonly ResearchFocusField[] | null | undefined,
  form: "running" | "notice" = "running"
): string {
  if (!focus || focus.length === 0) return t(form === "running" ? "redo.runningEverything" : "redo.noticeEverything");
  const words = focus.map((field) => t(`redo.what.${field}`));
  return t(form === "running" ? "redo.running" : "redo.notice", { what: listOf(words, locale) });
}

/**
 * The sections the last redo changed, when it landed within
 * `REDO_HIGHLIGHT_WINDOW_MS` of `now`; none otherwise — a page opened an hour
 * later has nothing "just now" about it.
 */
export function recentlyUpdatedSections(
  updated: ResearchResult["updated"] | undefined,
  now: number
): ResearchFocusField[] {
  if (!updated || updated.sections.length === 0) return [];
  const at = Date.parse(updated.at);
  if (!Number.isFinite(at) || now - at > REDO_HIGHLIGHT_WINDOW_MS || at - now > REDO_HIGHLIGHT_WINDOW_MS) return [];
  return [...updated.sections];
}

function listOf(words: string[], locale: string): string {
  try {
    return new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(words);
  } catch {
    return words.join(", ");
  }
}

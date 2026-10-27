import labFile from "../../../lab/lab.config.ts";
import type { LabConfig, LocalizedText } from "./schema.ts";

/**
 * The lab config as the app reads it (lab config spec 2026-10-25 §3): the
 * values of `lab/lab.config.ts`, imported directly so a fork's edit reaches
 * server and client alike with no wiring.
 *
 * Fields that have an environment variable today keep it, and it still wins:
 * each reader (`siteConfig`, `allowedEmailDomain`, `labTimezone`,
 * `notificationsConfig`, …) reads its variable at call time as before and
 * falls back to the value here, where it used to fall back to a hardcoded
 * Cornell default (§3.2). Fields with no variable (people, links, About's
 * words, the assistant's lab facts) come from here only.
 *
 * Validation is `labConfigIssues` (`schema.ts`), run by `next.config.ts` at
 * dev and build start, by `npm run lab:check`, and by the tests — not here, so
 * zod never enters a client bundle. No `server-only` and relative `.ts`
 * imports: client components, `next.config.ts` and `scripts/` all load this.
 * The floor plan is deliberately not part of it (`src/lib/map/plan.ts`).
 */
export const lab: LabConfig = labFile;

/**
 * Lab text in one locale: the locale's own words when the config gives them,
 * else the English (Article 6, English underneath).
 */
export function localized(text: LocalizedText, locale: string): string {
  if (typeof text === "string") return text;
  return text[locale] ?? text.en;
}

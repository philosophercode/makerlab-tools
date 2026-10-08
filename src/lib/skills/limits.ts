/**
 * The numbers tool skills run on (tool skills spec 2026-10-07 §5.1, §5.3,
 * §5.6). One client-safe module, so the settings page, the writer, the chat
 * and the script cannot disagree about a limit.
 */

/**
 * Skills written in a rolling 24 hours, lab-wide, every trigger counted
 * (§5.3). Automatic writes past it are skipped and Write skill is refused;
 * the backfill script is not capped by it, but its rows count.
 */
export const SKILL_DAILY_LIMIT = 50;

/**
 * About what one skill costs, in US dollars, at Luna's list price ($0.10 per
 * million input tokens, $0.50 per million output): ≈ 10k tokens in (the
 * manual budget below is most of it) and ≈ 4k out with reasoning. Flex is
 * cheaper. An estimate from the prompt's size, not a measurement: re-measure
 * on the first real run (spec §11 Q5). Shown on Settings › AI agents.
 */
export const SKILL_ESTIMATED_USD = { low: 0.002, high: 0.006 } as const;

/** Characters of manual passages the writer is given (≈ 6k tokens). */
export const SKILL_MANUAL_MAX_CHARS = 24_000;

/** Passages asked for per manual topic; the budget decides how many are kept. */
export const SKILL_PASSAGES_PER_TOPIC = 3;

/** Characters of the research summary the writer is given. */
export const SKILL_RESEARCH_MAX_CHARS = 6_000;

/** Specs and pages of research carried into the summary. */
export const SKILL_RESEARCH_MAX_SPECS = 40;
export const SKILL_RESEARCH_MAX_URLS = 8;

/** Linked documents listed as sources. */
export const SKILL_MAX_LINKS = 12;

/** Characters of a skill the chat puts in its prompt on a tool page (≈ 3k tokens, §5.6). */
export const SKILL_PROMPT_MAX_CHARS = 12_000;

/** The writer's call: how long it may take, and the AI SDK's own retries. */
export const SKILL_WRITE_TIMEOUT_MS = 180_000;
export const SKILL_WRITE_MAX_RETRIES = 2;

/** Workflow step retries after the first attempt, a minute apart (§5.3). */
export const SKILL_STEP_MAX_RETRIES = 2;

/** The admin page polls this often, for this long, after Write skill starts a run. */
export const SKILL_POLL_INTERVAL_MS = 5_000;
export const SKILL_POLL_FOR_MS = 3 * 60_000;

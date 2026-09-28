import type { QuestionKind } from "../db/schema/vocabulary.ts";

/**
 * What kind of question a chat turn asked — **operate**, **debug**, **create**
 * or **other** — by keywords, with no model call (owner, 2026-09-28: classify
 * cheaply). It is a trend line for staff, not a verdict on one question, so a
 * keyword heuristic is enough and costs nothing; only the kind is stored,
 * never the words.
 *
 * - **debug**: something is wrong — an error, a jam, a failed print. Checked
 *   first, because "how do I fix the jam" is a repair, not an operation.
 * - **create**: what to make or which tool fits a project — "I want to build",
 *   "best way to make", "which machine for".
 * - **operate**: how to use, set up, maintain or be allowed on a machine —
 *   settings, steps, training, safety.
 * - **other**: everything else (greetings, opening hours, off-topic).
 *
 * English keywords only; a question in another language is `other` unless it
 * carries an error code. Pure.
 */

const DEBUG = [
  /\berror\b/,
  /\b[ef]-?\d{2,4}\b/, // error codes: E-302, F12
  /\bbroken\b/,
  /\bbroke\b/,
  /\bnot working\b/,
  /\bdoesn'?t work\b/,
  /\bdoes not work\b/,
  /\bwon'?t\b/,
  /\bcan'?t get\b/,
  /\bfail(?:s|ed|ing|ure)?\b/,
  /\bjam(?:med|s)?\b/,
  /\bclog(?:ged|s)?\b/,
  /\bstuck\b/,
  /\bfix\b/,
  /\btroubleshoot/,
  /\bproblem\b/,
  /\bissue\b/,
  /\bwarning\b/,
  /\bwrong\b/,
  /\bwarp(?:ed|ing)?\b/,
  /\bspaghetti\b/,
];

const CREATE = [
  /\bi want to (?:make|build|create|design|cut|print|engrave)\b/,
  /\b(?:how (?:can|could|would|do) (?:i|we) )?(?:make|build|create|design|prototype)\b.*\b(?:a|an|my|some|this)\b/,
  /\bproject\b/,
  /\bidea\b/,
  /\bwhich (?:machine|tool|printer|material)\b/,
  /\bwhat (?:machine|tool|printer|material)\b/,
  /\bbest (?:way|tool|machine|material)\b/,
  /\bwhat should i use\b/,
  /\brecommend\b/,
];

const OPERATE = [
  /\bhow (?:do|can|should) (?:i|we|you)\b/,
  /\bhow to\b/,
  /\buse\b/,
  /\busing\b/,
  /\bset ?up\b/,
  /\bstart\b/,
  /\bturn (?:on|off)\b/,
  /\bsettings?\b/,
  /\bspeed\b/,
  /\bpower\b/,
  /\btemperature\b/,
  /\bcalibrat/,
  /\bload(?:ing)?\b/,
  /\breplac/,
  /\bclean/,
  /\bchange\b/,
  /\btraining\b/,
  /\bsafety\b/,
  /\bppe\b/,
  /\bmaterials?\b/,
  /\bmax(?:imum)?\b/,
  /\bsize\b/,
];

export function classifyQuestion(text: string | null | undefined): QuestionKind {
  const q = String(text ?? "").toLowerCase().replace(/[’‘]/g, "'");
  if (!q.trim()) return "other";
  if (DEBUG.some((re) => re.test(q))) return "debug";
  if (CREATE.some((re) => re.test(q))) return "create";
  if (OPERATE.some((re) => re.test(q))) return "operate";
  return "other";
}

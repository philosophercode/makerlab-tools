/**
 * A tool's assistant starter questions (spec amendment "Tool-specific starter
 * questions"): up to three short questions a student might ask the MakerLab
 * assistant about one tool, shown as the chat's starter chips on that tool's
 * page. Research writes them, approval copies them onto the tool, staff edit
 * them in the tool editor, and a backfill script fills them for tools that
 * were added before any of that existed.
 *
 * Two readers, one rule each:
 *
 * - {@link cleanStarterQuestions} reads a **model's** answer, leniently: it
 *   keeps what is usable and drops the rest, and never refuses the answer.
 * - {@link starterQuestionsFromEditor} reads what **staff** typed: it tidies
 *   the lines but refuses (null) rather than cutting a question somebody wrote.
 *
 * Pure and dependency-free, relative imports only: the research step bundle,
 * `scripts/` under plain Node, and client components all import it.
 */

/** How many starter chips a tool offers. */
export const STARTER_QUESTIONS_MAX = 3;

/** How long one question may be — a chip, not a paragraph. */
export const STARTER_QUESTION_MAX_CHARS = 80;

/**
 * How to write the questions, shared by research's read prompt and the
 * backfill script so the two can't drift. Tuned 2026-09-23 for curious first-
 * time students: plain words a newcomer would use, one "can I make…" question,
 * one "how do I start…" question, one about what makes the machine special —
 * and only questions the record or manual can actually answer.
 */
export const STARTER_QUESTION_GUIDANCE = [
  `Write for a curious student who has never used this machine and may not know its jargon: plain, friendly words they would actually type, starting with "Can I", "How do I", "What can", "What's" or "Which". Keep each under ${STARTER_QUESTION_MAX_CHARS} characters; shorter is better. Don't repeat the full product name — the student is already on its page; "this" or "it" is fine.`,
  `Make the three different kinds: (1) what they could make or which materials it takes ("Can I cut acrylic with this?", "What can I make with it?"); (2) how to get started with a first project or a basic step ("How do I start my first print?", "How do I change the blade?"); (3) the one feature that makes this machine interesting or different ("How is resin printing different from filament?", "What does the tool changer do?").`,
  `Only ask what the tool's record or manual can answer — never about a spec or feature the record doesn't mention. Each is a question ending in "?", never a statement. Do not state a safety rule or protective equipment as a fact inside a question, and do not ask about PPE — safety is the lab's staff's to answer.`,
].join(" ");

/** "1. ", "- ", "• ", "* ", "2) " at the start of a line: list formatting, not part of the question. */
const LIST_MARKER = /^(?:[-*•–]\s+|\d{1,2}[.)]\s+)/;

function tidy(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(LIST_MARKER, "").replace(/^["“']+|["”']+$/g, "").trim();
}

/**
 * A model's starter questions, as far as they are usable: each one a string,
 * tidied to one line, at most {@link STARTER_QUESTION_MAX_CHARS} characters and
 * ending in a question mark — a statement ("Wear gloves when handling resin.")
 * is not a question to ask, and a safety claim phrased as one is exactly what
 * the chips must not carry — once each ignoring case, at most
 * {@link STARTER_QUESTIONS_MAX} of them. An over-long question is dropped, not
 * cut: half a question is worse than none. Anything that is not a list is no
 * questions.
 */
export function cleanStarterQuestions(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    if (typeof raw !== "string") continue;
    const question = tidy(raw);
    if (!question || question.length > STARTER_QUESTION_MAX_CHARS) continue;
    if (!question.endsWith("?")) continue;
    const key = question.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(question);
    if (out.length === STARTER_QUESTIONS_MAX) break;
  }
  return out;
}

/**
 * What staff typed in the editor's three lines, or null when it cannot be
 * saved as typed: more than {@link STARTER_QUESTIONS_MAX} questions, or one
 * longer than {@link STARTER_QUESTION_MAX_CHARS}. Blank lines are dropped and
 * repeats kept once; a question mark is not required — staff may phrase a
 * chip as they like.
 */
export function starterQuestionsFromEditor(values: unknown): string[] | null {
  if (!Array.isArray(values)) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    if (typeof raw !== "string") return null;
    const question = raw.replace(/\s+/g, " ").trim();
    if (!question) continue;
    if (question.length > STARTER_QUESTION_MAX_CHARS) return null;
    const key = question.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(question);
  }
  return out.length > STARTER_QUESTIONS_MAX ? null : out;
}

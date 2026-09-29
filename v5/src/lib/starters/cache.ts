import type { UIMessage } from "ai";
import { CHAT_PROMPT_CACHE_KEY_DEFAULT, modelIdFor } from "../ai/models.ts";
import {
  listStarterAnswers,
  listStarterAnswerSummaries,
  loadGeneralHashInputs,
  loadToolHashInputs,
  type StarterAnswerRow,
} from "../data/starter-answers.ts";
import type { Db } from "../db/types.ts";
import { normalizeQuestion, starterSourceHash, type StarterHashContext, type StarterHashInputs } from "./hash.ts";

/**
 * Which pre-run starter answers may be served now (starter answers,
 * `lib/starters/hash.ts` for the rule). A row is served only when it was
 * accepted by the grader **and** its stored hash equals the hash of what it
 * depends on today; anything else leaves the chip to the live chat.
 */

/** The only locale answers are made in. A chip in another language always answers live. */
export const STARTER_LOCALE = "en";

/** How a chip stands: served from the cache, made but out of date, made but graded down, or never made. */
export type ChipStatus = "cached" | "stale" | "rejected" | "live";

export function starterHashContext(question: string, locale: string = STARTER_LOCALE): StarterHashContext {
  return { question, locale, model: modelIdFor("chat"), promptKey: CHAT_PROMPT_CACHE_KEY_DEFAULT };
}

/** A stored row against the current inputs. Pure. */
export function chipStatus(row: Pick<StarterAnswerRow, "accepted" | "sourceHash" | "question" | "locale"> | undefined, inputs: StarterHashInputs | null): ChipStatus {
  if (!row) return "live";
  if (!inputs || row.sourceHash !== starterSourceHash(inputs, starterHashContext(row.question, row.locale))) return "stale";
  return row.accepted ? "cached" : "rejected";
}

/** One answer a chip may show at once. */
export interface ServedStarterAnswer {
  question: string;
  message: UIMessage;
  usageEvents: unknown;
}

/** A stored message the chat can draw: an assistant message with parts. */
export function asAssistantMessage(value: unknown): UIMessage | null {
  if (!value || typeof value !== "object") return null;
  const message = value as { role?: unknown; parts?: unknown; id?: unknown };
  if (message.role !== "assistant" || !Array.isArray(message.parts) || message.parts.length === 0) return null;
  return { id: typeof message.id === "string" ? message.id : "starter", role: "assistant", parts: message.parts as UIMessage["parts"] };
}

/** The current hash inputs for one chip set, or null when its tool is gone. */
export async function currentHashInputs(db: Db, toolId: string | null): Promise<StarterHashInputs | null> {
  if (toolId === null) return loadGeneralHashInputs(db);
  return (await loadToolHashInputs(db, [toolId])).get(toolId) ?? null;
}

/**
 * The answers a chip set may serve now: accepted, current, drawable. Two to
 * four reads, no model call. `toolId` null is the general chips.
 */
export async function servableStarterAnswers(
  db: Db,
  scope: { toolId: string | null; locale?: string }
): Promise<ServedStarterAnswer[]> {
  const locale = scope.locale ?? STARTER_LOCALE;
  if (locale !== STARTER_LOCALE) return [];
  const rows = (await listStarterAnswers(db, { toolId: scope.toolId, locale })).filter((row) => row.accepted);
  if (rows.length === 0) return [];
  const inputs = await currentHashInputs(db, scope.toolId);
  const out: ServedStarterAnswer[] = [];
  for (const row of rows) {
    if (chipStatus(row, inputs) !== "cached") continue;
    const message = asAssistantMessage(row.message);
    if (message) out.push({ question: row.question, message, usageEvents: row.usageEvents });
  }
  return out;
}

/** One chip as the admin view and the refresh see it. */
export interface ChipState {
  question: string;
  status: ChipStatus;
  score: number | null;
  reasons: string[];
  updatedAt: Date | null;
}

/**
 * Every chip of every chip set asked about — `null` in `sets` is the general
 * chips — with its status. Reads the stored rows once and the hash inputs
 * once per kind.
 */
export async function chipStates(
  db: Db,
  sets: readonly { toolId: string | null; questions: readonly string[] }[]
): Promise<Map<string | null, ChipState[]>> {
  const rows = await listStarterAnswerSummaries(db);
  const toolIds = sets.map((s) => s.toolId).filter((id): id is string => id !== null);
  const [toolInputs, generalInputs] = await Promise.all([
    loadToolHashInputs(db, toolIds),
    sets.some((s) => s.toolId === null) ? loadGeneralHashInputs(db) : Promise.resolve(null),
  ]);
  const out = new Map<string | null, ChipState[]>();
  for (const set of sets) {
    const inputs = set.toolId === null ? generalInputs : (toolInputs.get(set.toolId) ?? null);
    out.set(
      set.toolId,
      set.questions.map((question) => {
        const row = rows.find(
          (r) => r.toolId === set.toolId && r.locale === STARTER_LOCALE && normalizeQuestion(r.question) === normalizeQuestion(question)
        );
        return {
          question,
          status: chipStatus(row, inputs),
          score: row ? Number(row.grade?.score ?? 0) : null,
          reasons: row ? [...(Array.isArray(row.grade?.failures) ? (row.grade.failures as string[]) : []), ...(row.grade?.reasons ?? [])] : [],
          updatedAt: row?.updatedAt ?? null,
        };
      })
    );
  }
  return out;
}

/** The served answer for one chip's exact text, if there is one. */
export function answerForChip(answers: readonly ServedStarterAnswer[], question: string): ServedStarterAnswer | null {
  const wanted = normalizeQuestion(question);
  return answers.find((answer) => normalizeQuestion(answer.question) === wanted) ?? null;
}

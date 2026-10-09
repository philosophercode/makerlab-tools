import { createHash } from "node:crypto";

/**
 * What a pre-run starter answer depended on, as one digest (`starter_answers.
 * source_hash`). A cached answer is served only while the digest of the
 * **current** inputs equals the one stored with it; anything that could make
 * the answer wrong changes the digest, so invalidation needs no hook — the
 * next read simply finds the row stale and the chip answers live.
 *
 * For a tool's chip:
 * - the tool's revision (`tools.updated_at` — every field edit, including the
 *   starter questions themselves, moves it);
 * - its resources (id, last change, published) — a manual added, removed,
 *   hidden or relinked;
 * - its manual documents (id, status, extractor / chunker / embedding / OCR
 *   versions, last change) — a manual re-processed or newly searchable.
 *
 * For a general chip (no tool): the published catalogue's membership and
 * names, and every manual document's state — a general answer names
 * machines and may cite any manual. Units and tickets are deliberately **not**
 * inputs: an answer that depends on live state is rejected by the grader, so
 * availability never needs to invalidate anything.
 *
 * Both also carry the lab-wide notes (identity spec amendment "Lab notes"),
 * when there are any: the answer was made with them in its prompt, so a change
 * to them makes it stale. Left out of the hash while there are none, so the
 * answers made before lab notes existed stay current until staff write some.
 *
 * Both also carry {@link STARTER_ANSWER_VERSION} (bump it when the runner,
 * the grader's bar or the stored message shape changes), the chat prompt's
 * cache key (`CHAT_PROMPT_CACHE_KEY_DEFAULT`, bumped when the stable prompt
 * changes shape), the chat model, the locale and the question.
 *
 * Pure; `node:crypto` only.
 */

/** Bump when what a cached answer is, or how it is made or judged, changes. */
export const STARTER_ANSWER_VERSION = "starter-answers-1";

export interface ResourceHashInput {
  id: string;
  updatedAt: string;
  published: boolean;
}

export interface ManualHashInput {
  id: string;
  status: string;
  extractorVersion: string;
  chunkerVersion: string | null;
  embeddingModel: string | null;
  ocrVersion: string | null;
  updatedAt: string;
}

export interface ToolHashInputs {
  kind: "tool";
  toolId: string;
  /** `tools.updated_at` as epoch text (`data/revision.ts`'s shape). */
  revision: string;
  resources: ResourceHashInput[];
  manuals: ManualHashInput[];
  /** The lab-wide notes' lines joined, or absent/"" when there are none. */
  labNotes?: string;
}

export interface GeneralHashInputs {
  kind: "general";
  /** Published, unarchived tools: id and display name. */
  tools: { id: string; name: string }[];
  manuals: ManualHashInput[];
  /** The lab-wide notes' lines joined, or absent/"" when there are none. */
  labNotes?: string;
}

export type StarterHashInputs = ToolHashInputs | GeneralHashInputs;

export interface StarterHashContext {
  question: string;
  locale: string;
  /** The chat job's model id (`modelIdFor("chat")`). */
  model: string;
  /** The stable chat prompt's version (`CHAT_PROMPT_CACHE_KEY_DEFAULT`). */
  promptKey: string;
}

const byId = <T extends { id: string }>(rows: readonly T[]): T[] => [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** The inputs in one canonical shape: fixed key order, arrays sorted by id. */
export function canonicalInputs(inputs: StarterHashInputs, context: StarterHashContext): string {
  const manuals = byId(inputs.manuals).map((m) => [
    m.id,
    m.status,
    m.extractorVersion,
    m.chunkerVersion,
    m.embeddingModel,
    m.ocrVersion,
    m.updatedAt,
  ]);
  const scope =
    inputs.kind === "tool"
      ? {
          kind: "tool",
          toolId: inputs.toolId,
          revision: inputs.revision,
          resources: byId(inputs.resources).map((r) => [r.id, r.updatedAt, r.published]),
          manuals,
        }
      : { kind: "general", tools: byId(inputs.tools).map((t) => [t.id, t.name]), manuals };
  // Only when there are notes: an empty set leaves every existing hash as it was.
  const withNotes = inputs.labNotes ? { ...scope, labNotes: inputs.labNotes } : scope;
  return JSON.stringify({
    version: STARTER_ANSWER_VERSION,
    promptKey: context.promptKey,
    model: context.model,
    locale: context.locale,
    question: normalizeQuestion(context.question),
    scope: withNotes,
  });
}

/** The stored digest: `sha256:` and the hex of the canonical inputs. */
export function starterSourceHash(inputs: StarterHashInputs, context: StarterHashContext): string {
  return `sha256:${createHash("sha256").update(canonicalInputs(inputs, context)).digest("hex")}`;
}

/** A chip's text as it is matched: spacing collapsed, trimmed. Case is kept — a chip is shown as written. */
export function normalizeQuestion(question: string): string {
  return question.replace(/\s+/g, " ").trim();
}

"use client";

import { useCallback, useEffect, useRef } from "react";
import type { UIMessage } from "ai";

/**
 * The chips' pre-run answers (starter answers): while the chat shows its
 * starter chips, ask `GET /api/chat/starters` once for this chip set's
 * cached answers, so a click can show one at once with no model call.
 *
 * - `scope` null means no cache applies (another language, a tool page
 *   showing the generic chips, a curation chip) — nothing is fetched and
 *   every chip answers live.
 * - `answerFor(question)` resolves the cached answer for a chip's exact text,
 *   waiting at most {@link WAIT_MS} for a fetch still in flight; null means
 *   "ask live". A failed fetch is null too — the cache is an accelerator,
 *   never a gate.
 * - `markServed` tells the server a chip was answered from the cache, for
 *   Usage Insight; fire and forget.
 */

export interface StarterScope {
  /** The page's tool (slug or id), or null for the general chips. */
  toolId: string | null;
  locale: string;
}

type Answers = Map<string, UIMessage>;

const WAIT_MS = 1500;

function keyOf(scope: StarterScope): string {
  return `${scope.toolId ?? ""}|${scope.locale}`;
}

function normalize(question: string): string {
  return question.replace(/\s+/g, " ").trim();
}

async function fetchAnswers(scope: StarterScope): Promise<Answers> {
  const params = new URLSearchParams({ locale: scope.locale });
  if (scope.toolId) params.set("toolId", scope.toolId);
  try {
    const res = await fetch(`/api/chat/starters?${params}`, { headers: { Accept: "application/json" } });
    if (!res.ok) return new Map();
    const body = (await res.json()) as { answers?: { question?: unknown; message?: unknown }[] };
    const out: Answers = new Map();
    for (const answer of body.answers ?? []) {
      const message = answer.message as UIMessage | undefined;
      if (typeof answer.question === "string" && message?.role === "assistant" && Array.isArray(message.parts)) {
        out.set(normalize(answer.question), message);
      }
    }
    return out;
  } catch {
    return new Map();
  }
}

export function useStarterAnswers(scope: StarterScope | null, enabled: boolean) {
  const cache = useRef(new Map<string, Promise<Answers>>());
  const scopeKey = scope ? keyOf(scope) : null;
  const scopeRef = useRef(scope);
  useEffect(() => {
    scopeRef.current = scope;
  });

  const settled = useRef(new Map<string, Answers>());

  useEffect(() => {
    if (!enabled || !scope || !scopeKey || cache.current.has(scopeKey)) return;
    const key = scopeKey;
    const pending = fetchAnswers(scope);
    cache.current.set(key, pending);
    void pending.then((answers) => settled.current.set(key, answers));
    // `scope` is described by `scopeKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, scopeKey]);

  /**
   * The answer for a chip right now, without waiting: the message, null for
   * "ask live", or undefined while this chip set's answers are still loading
   * (then use {@link answerFor}).
   */
  const answerNow = useCallback((question: string): UIMessage | null | undefined => {
    const current = scopeRef.current;
    if (!current) return null;
    const key = keyOf(current);
    if (!cache.current.has(key)) return null;
    const answers = settled.current.get(key);
    return answers ? (answers.get(normalize(question)) ?? null) : undefined;
  }, []);

  const answerFor = useCallback(async (question: string): Promise<UIMessage | null> => {
    const current = scopeRef.current;
    if (!current) return null;
    const pending = cache.current.get(keyOf(current));
    if (!pending) return null;
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), WAIT_MS));
    const answers = await Promise.race([pending, timeout]);
    return answers?.get(normalize(question)) ?? null;
  }, []);

  const markServed = useCallback((question: string) => {
    const current = scopeRef.current;
    if (!current) return;
    try {
      void fetch("/api/chat/starters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, locale: current.locale, ...(current.toolId ? { toolId: current.toolId } : {}) }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      // Counting a served chip is best effort.
    }
  }, []);

  return { answerNow, answerFor, markServed };
}

/** A fresh message id, where the browser can make one. */
export function newMessageId(): string {
  const cryptoRef = typeof globalThis.crypto !== "undefined" ? globalThis.crypto : undefined;
  if (cryptoRef && typeof cryptoRef.randomUUID === "function") return cryptoRef.randomUUID();
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

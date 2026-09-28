"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * Browser dictation for the chat composer (Web Speech API): speech into the
 * draft, in the page's language, interim words shown as they come and
 * appended after whatever was already typed. The button is only offered where
 * the API exists (Chrome, Safari).
 *
 * Moved out of `ChatFab` unchanged in phase 5b. AI Elements' own
 * `PromptInputSpeechButton` is not used: it hard-codes `en-US` and keeps only
 * final results.
 */

// Minimal structural types for the SpeechRecognition API. It is not in the
// standard DOM lib typings and is vendor-prefixed in Chromium (`webkit`). We
// feature-detect at runtime and hide the mic where it is unavailable, so these
// types only describe the shape we actually touch.
interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  readonly length: number;
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionResultListLike {
  readonly length: number;
  [index: number]: SpeechRecognitionResultLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// Whether browser dictation is available. Read via `useSyncExternalStore` so
// the server snapshot is always `false` (no mic on the server-rendered HTML),
// the client snapshot reflects the real API, and React reconciles the
// difference on hydration without a synchronous setState-in-effect.
const SPEECH_STORE = {
  subscribe: () => () => {},
  getSnapshot: () => getSpeechRecognitionCtor() !== null,
  getServerSnapshot: () => false,
};

export interface Dictation {
  supported: boolean;
  listening: boolean;
  toggle: () => void;
  stop: () => void;
}

export function useDictation({
  lang,
  draft,
  setDraft,
}: {
  /** The recognition language (the page's locale). */
  lang: string;
  draft: string;
  setDraft: (next: string) => void;
}): Dictation {
  const supported = useSyncExternalStore(SPEECH_STORE.subscribe, SPEECH_STORE.getSnapshot, SPEECH_STORE.getServerSnapshot);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // Text captured before dictation started, so interim results append rather
  // than overwrite what the user already typed.
  const baseRef = useRef("");

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  function stop() {
    recognitionRef.current?.stop();
  }

  function start() {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    const recognition = new Ctor();
    recognition.lang = lang || "en";
    recognition.continuous = true;
    recognition.interimResults = true;
    baseRef.current = draft;

    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        transcript += event.results[i][0]?.transcript ?? "";
      }
      const base = baseRef.current;
      setDraft(base ? `${base.replace(/\s+$/, "")} ${transcript}` : transcript);
    };
    recognition.onerror = () => {
      setListening(false);
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      recognitionRef.current = null;
      setListening(false);
    }
  }

  return {
    supported,
    listening,
    toggle: () => (listening ? stop() : start()),
    stop,
  };
}

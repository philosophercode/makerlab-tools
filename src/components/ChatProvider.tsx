"use client";

import { createContext, useContext, useCallback, useRef, useSyncExternalStore } from "react";
import type { UIMessage } from "ai";

const STORAGE_KEY = "makerlab-chat";
const MAX_STORAGE_BYTES = 2 * 1024 * 1024; // 2MB

interface ChatStore {
  [conversationId: string]: {
    messages: UIMessage[];
    updatedAt: number;
  };
}

function loadStore(): ChatStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveStore(store: ChatStore) {
  try {
    const json = JSON.stringify(store);
    // Prune oldest conversations if over budget
    if (json.length > MAX_STORAGE_BYTES) {
      const entries = Object.entries(store).sort(
        ([, a], [, b]) => a.updatedAt - b.updatedAt
      );
      while (entries.length > 1) {
        entries.shift();
        const pruned = Object.fromEntries(entries);
        if (JSON.stringify(pruned).length <= MAX_STORAGE_BYTES) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
          return;
        }
      }
    }
    localStorage.setItem(STORAGE_KEY, json);
  } catch {
    // Storage full — clear and continue
    localStorage.removeItem(STORAGE_KEY);
  }
}

// ── Singleton store for useSyncExternalStore ────────────────────────

let currentStore: ChatStore = {};
const listeners = new Set<() => void>();

function initStore() {
  currentStore = loadStore();
}

const emptyStore: ChatStore = {};

function getSnapshot(): ChatStore {
  return currentStore;
}

function getServerSnapshot(): ChatStore {
  return emptyStore;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitChange() {
  listeners.forEach((l) => l());
}

// ── Context ─────────────────────────────────────────────────────────

interface ChatContextValue {
  getMessages: (conversationId: string) => UIMessage[];
  setMessages: (conversationId: string, messages: UIMessage[]) => void;
  clearConversation: (conversationId: string) => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const initialized = useRef(false);
  if (!initialized.current && typeof window !== "undefined") {
    initStore();
    initialized.current = true;
  }

  const store = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const getMessages = useCallback(
    (conversationId: string): UIMessage[] => {
      return store[conversationId]?.messages || [];
    },
    [store]
  );

  const setMessages = useCallback(
    (conversationId: string, messages: UIMessage[]) => {
      currentStore = {
        ...currentStore,
        [conversationId]: { messages, updatedAt: Date.now() },
      };
      saveStore(currentStore);
      emitChange();
    },
    []
  );

  const clearConversation = useCallback((conversationId: string) => {
    const { [conversationId]: _, ...rest } = currentStore;
    currentStore = rest;
    saveStore(currentStore);
    emitChange();
  }, []);

  return (
    <ChatContext.Provider value={{ getMessages, setMessages, clearConversation }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChatStore() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChatStore must be used within ChatProvider");
  return ctx;
}

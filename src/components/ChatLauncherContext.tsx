"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * A one-shot opening message for the chat. By default it is only **put in the
 * composer** (focused, caret at the end) and waits for the person to press
 * Send: a button such as Report or Add equipment must not spend a message —
 * an anonymous visitor's allowance is small — on words the person did not
 * write. `send: true` sends it at once, and is for text the person typed
 * themselves (⌘K's "Ask MakerLAB AI: “…”"). The nonce lets the same text
 * re-trigger on repeat clicks — a plain string wouldn't change, so the
 * consumer's effect wouldn't fire again.
 */
export interface ChatSeed {
  text: string;
  nonce: number;
  send: boolean;
}

export interface OpenChatOptions {
  /** Send the text at once instead of pre-filling the composer. Only for words the person typed. */
  send?: boolean;
}

/**
 * The starter questions of the tool whose page is showing (spec amendment
 * "Tool-specific starter questions"), registered by `ToolChatStarters` on that
 * page. `keys` are the path segments that page answers to — its slug and its
 * id — so `ChatFab` uses them only while the path still names this tool.
 */
export interface ToolStarters {
  keys: string[];
  questions: string[];
}

interface ChatLauncher {
  /** Whether the chat sheet is open. */
  isOpen: boolean;
  /** A pending opening message (pre-filled, or sent with `send`), or null. `ChatPanel` consumes it. */
  pendingSeed: ChatSeed | null;
  /**
   * Open the chat. `seedText` is put in the composer for the person to send;
   * with `{ send: true }` it is sent at once (only for text the person typed).
   */
  open: (seedText?: string, options?: OpenChatOptions) => void;
  /** Close the chat (the conversation is preserved). */
  close: () => void;
  /** Clear the pending seed once it has been used. */
  consumeSeed: () => void;
  /** The showing tool's starter questions, or null off a tool page. */
  toolStarters: ToolStarters | null;
  /** Register (or, with null, clear) the showing tool's starter questions. */
  setToolStarters: (value: ToolStarters | null) => void;
  /**
   * The record the page shows, when the viewer may curate it (refresh research
   * spec §12.3): its keys (slug or id) — `ChatFab` offers "Curate this entry"
   * while its path still names one. Null for everyone else.
   */
  curate: CurateTarget | null;
  setCurate: (value: CurateTarget | null) => void;
}

export interface CurateTarget {
  keys: string[];
}

const ChatLauncherContext = createContext<ChatLauncher | null>(null);

/**
 * Owns just the chat launcher's open state and any one-shot seed message, so
 * that entry points outside `ChatFab` (e.g. the nav "Report" / "Add equipment"
 * buttons) can open the chat with its composer pre-filled. All conversation/message state stays
 * inside `ChatFab`.
 */
export function ChatLauncherProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [pendingSeed, setPendingSeed] = useState<ChatSeed | null>(null);
  const [toolStarters, setToolStarters] = useState<ToolStarters | null>(null);
  const [curate, setCurate] = useState<CurateTarget | null>(null);

  const nonceRef = useRef(0);
  const open = useCallback((seedText?: string, options?: OpenChatOptions) => {
    setIsOpen(true);
    if (seedText) {
      nonceRef.current += 1;
      setPendingSeed({ text: seedText, nonce: nonceRef.current, send: options?.send === true });
    }
  }, []);

  const close = useCallback(() => setIsOpen(false), []);
  const consumeSeed = useCallback(() => setPendingSeed(null), []);

  const value = useMemo(
    () => ({ isOpen, pendingSeed, open, close, consumeSeed, toolStarters, setToolStarters, curate, setCurate }),
    [isOpen, pendingSeed, open, close, consumeSeed, toolStarters, curate]
  );

  return (
    <ChatLauncherContext.Provider value={value}>
      {children}
    </ChatLauncherContext.Provider>
  );
}

/** The launcher, or null outside a provider (a component test). */
export function useOptionalChatLauncher(): ChatLauncher | null {
  return useContext(ChatLauncherContext);
}

export function useChatLauncher(): ChatLauncher {
  const ctx = useContext(ChatLauncherContext);
  if (!ctx) {
    throw new Error("useChatLauncher must be used within a ChatLauncherProvider");
  }
  return ctx;
}

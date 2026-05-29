"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

/**
 * A one-shot message to auto-send into the chat. The nonce lets the same text
 * re-trigger a send on repeat clicks — a plain string wouldn't change, so the
 * consumer's effect wouldn't fire again.
 */
interface ChatSeed {
  text: string;
  nonce: number;
}

interface ChatLauncher {
  /** Whether the chat sheet is open. */
  isOpen: boolean;
  /** A pending message to auto-send, or null. `ChatFab` consumes it. */
  pendingSeed: ChatSeed | null;
  /** Open the chat. Pass `seedText` to also auto-send an opening message. */
  open: (seedText?: string) => void;
  /** Close the chat (the conversation is preserved). */
  close: () => void;
  /** Clear the pending seed once it has been sent. */
  consumeSeed: () => void;
}

const ChatLauncherContext = createContext<ChatLauncher | null>(null);

/**
 * Owns just the chat launcher's open state and any one-shot seed message, so
 * that entry points outside `ChatFab` (e.g. the nav "Report" button) can open
 * and seed the chat. All conversation/message state stays inside `ChatFab`.
 */
export function ChatLauncherProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [pendingSeed, setPendingSeed] = useState<ChatSeed | null>(null);

  const open = useCallback((seedText?: string) => {
    setIsOpen(true);
    if (seedText) {
      setPendingSeed((prev) => ({
        text: seedText,
        nonce: (prev?.nonce ?? 0) + 1,
      }));
    }
  }, []);

  const close = useCallback(() => setIsOpen(false), []);
  const consumeSeed = useCallback(() => setPendingSeed(null), []);

  const value = useMemo(
    () => ({ isOpen, pendingSeed, open, close, consumeSeed }),
    [isOpen, pendingSeed, open, close, consumeSeed]
  );

  return (
    <ChatLauncherContext.Provider value={value}>
      {children}
    </ChatLauncherContext.Provider>
  );
}

export function useChatLauncher(): ChatLauncher {
  const ctx = useContext(ChatLauncherContext);
  if (!ctx) {
    throw new Error("useChatLauncher must be used within a ChatLauncherProvider");
  }
  return ctx;
}

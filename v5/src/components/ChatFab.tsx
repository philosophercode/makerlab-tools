"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useChatLauncher } from "./ChatLauncherContext";

/**
 * The chat's code — the AI SDK (with the whole of zod and its locales), the
 * sheet, the composer, the message cards — is one chunk loaded on demand
 * (performance plan, "Load the chat code only when the chat is opened"). It
 * used to be part of every page's first load: 120–170 KB gzipped of the
 * 390–430 KB each page shipped.
 */
const loadChatPanel = () => import("./chat/ChatPanel");
const ChatPanel = dynamic(() => loadChatPanel().then((module) => module.ChatPanel), { ssr: false });

/** How long after mount the chat's code may start loading on its own. */
const PRELOAD_GRACE_MS = 4000;

/** Start downloading the chat's code without mounting it. */
export function preloadChatPanel(): void {
  void loadChatPanel();
}

/** The admin opens the assistant from its section bar and ⌘K; the floating button is not drawn there. */
function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

interface IdleWindow {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
}

/** A visitor on a metered connection who asked browsers to save data. */
function savesData(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true;
}

/**
 * The MakerLab assistant's launcher (UI system spec §9; phase 5b), mounted
 * once in the root layout.
 *
 * - **Where it opens.** On public pages, the square button at the inline-end
 *   corner; on `/admin/*` that button is not drawn (it collided with bulk
 *   bars) and the section bar's **Ask the assistant** and ⌘K open it instead.
 *   Anything else — Report, Add equipment, the QR notice — opens it through
 *   `ChatLauncherContext`, optionally with a first message.
 * - **The conversation** is `ChatPanel`, loaded the first time the chat opens
 *   or is sent a message, and warmed once the browser is idle or the pointer
 *   reaches the button. Once mounted it stays mounted, so the conversation
 *   survives navigation and closing the sheet.
 */
export function ChatFab() {
  const t = useTranslations("chat");
  const { isOpen, open, pendingSeed } = useChatLauncher();
  const pathname = usePathname() || "/";
  const onAdmin = isAdminPath(pathname);

  // Mounted from the first open (or seeded message) on — kept in state so a
  // closed sheet keeps its conversation. Adjusted during render, React's
  // pattern for state derived from a change, so the panel mounts in the same
  // commit that opened the chat.
  const [mounted, setMounted] = useState(false);
  if (!mounted && (isOpen || pendingSeed)) setMounted(true);

  // Warm the chunk once the page has settled, so the first open is instant —
  // off the critical path, and not at all for a visitor saving data. A few
  // seconds' grace first: parsing the AI SDK while the page is still
  // hydrating would slow exactly what moving it out of the first load saved.
  useEffect(() => {
    if (savesData()) return;
    const idle = window as unknown as IdleWindow;
    let handle: number | undefined;
    const timer = window.setTimeout(() => {
      if (idle.requestIdleCallback) handle = idle.requestIdleCallback(preloadChatPanel, { timeout: 10_000 });
      else preloadChatPanel();
    }, PRELOAD_GRACE_MS);
    return () => {
      window.clearTimeout(timer);
      if (handle !== undefined) idle.cancelIdleCallback?.(handle);
    };
  }, []);

  return (
    <>
      {onAdmin ? null : (
        <button
          type="button"
          data-slot="chat-launcher"
          aria-expanded={isOpen}
          aria-controls="makerlab-chat-sheet"
          aria-label={t("openAria")}
          title={t("openAria")}
          onClick={() => open()}
          onPointerEnter={preloadChatPanel}
          onFocus={preloadChatPanel}
          className="ui fixed end-4 bottom-4 z-40 inline-flex size-12 cursor-pointer items-center justify-center border border-primary bg-primary font-mono text-sm font-bold text-primary-foreground transition-colors duration-150 hover:bg-primary/85 sm:end-6 sm:bottom-6"
        >
          <span aria-hidden="true">&gt;_</span>
        </button>
      )}
      {mounted ? <ChatPanel /> : null}
    </>
  );
}

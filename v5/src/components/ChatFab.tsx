"use client";

import { lazy, Suspense, useEffect, useState, type ComponentType } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { BotMessageSquareIcon } from "lucide-react";
import { useChatLauncher } from "./ChatLauncherContext";
import { isKioskPath } from "./kiosk-path";
import { AssistantIntro } from "./chat/AssistantIntro";
import { useAssistantIntro } from "./chat/assistant-intro-store";

/** The admin opens the assistant from its section bar and ⌘K; the floating button is not drawn there. */
function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

let LoadedPanel: ComponentType | null = null;

/**
 * Fetch the chat panel's code (`ChatPanel`: the AI SDK, the sheet, the
 * composer — the largest part of the app's JavaScript). Called when the chat
 * first opens, and ahead of that when the pointer or focus reaches the button,
 * so the panel is usually there by the time it is clicked.
 */
export function preloadChatPanel(): Promise<ComponentType> {
  return import("./ChatPanel").then((mod) => {
    LoadedPanel = mod.ChatPanel;
    return mod.ChatPanel;
  });
}

/** How long after mount the panel's code may start loading on its own. */
const PRELOAD_GRACE_MS = 4000;

interface IdleWindow {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
}

/** A visitor on a metered connection who asked browsers to save data. */
function savesData(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true;
}

const LazyPanel = lazy(() => preloadChatPanel().then((panel) => ({ default: panel })));

/**
 * The MakerLAB Assistant's floating button (identity spec 2026-09-28), its
 * one-time introduction, and the assistant itself once it has been opened
 * (performance: the panel is not part of any page's first load).
 *
 * The button is drawn on public pages only (see `ChatPanel`), and on `/kiosk`
 * nothing is drawn at all. The panel
 * mounts the first time anything opens the chat — this button, the admin
 * section bar, ⌘K, Report, the QR notice — and then stays mounted, so the
 * conversation survives navigation exactly as before.
 */
export function ChatFab() {
  const t = useTranslations("chat");
  const { isOpen, open } = useChatLauncher();
  const pathname = usePathname() || "/";
  // How the panel is mounted is decided once, at the first open, and never
  // switched: a different element there would remount it and drop the
  // conversation. Already loaded (the pointer got there first) → directly;
  // otherwise through `lazy`. Set during render, not in an effect, so the
  // first open mounts the panel in the same commit that opens it.
  const [mount, setMount] = useState<{ Panel: ComponentType | null } | null>(null);
  if (isOpen && mount === null) setMount({ Panel: LoadedPanel });

  // The first-visit callout (identity spec §3): beside the button, on the
  // first page it can show on and nowhere after, never on /admin (no button
  // there) or /kiosk (returns below). Opening the chat by any route counts as
  // having met the assistant. Showing it does not load the panel; only
  // opening the chat does.
  const introEligible = !isAdminPath(pathname) && !isKioskPath(pathname) && !isOpen;
  const { visible: introVisible, markSeen: markIntroSeen } = useAssistantIntro(pathname, introEligible);
  useEffect(() => {
    if (isOpen) markIntroSeen();
  }, [isOpen, markIntroSeen]);

  // Warm the panel's chunk once the page has settled, so the first open is
  // instant — off the critical path (a few seconds' grace, so parsing the AI
  // SDK never competes with hydration), and not at all for a visitor saving
  // data or on the kiosk (performance plan).
  const onKiosk = isKioskPath(pathname);
  useEffect(() => {
    if (onKiosk || savesData()) return;
    const idle = window as unknown as IdleWindow;
    let handle: number | undefined;
    const warm = () => void preloadChatPanel().catch(() => undefined);
    const timer = window.setTimeout(() => {
      if (idle.requestIdleCallback) handle = idle.requestIdleCallback(warm, { timeout: 10_000 });
      else warm();
    }, PRELOAD_GRACE_MS);
    return () => {
      window.clearTimeout(timer);
      if (handle !== undefined) idle.cancelIdleCallback?.(handle);
    };
  }, [onKiosk]);

  // The kiosk is read-only: the phone is the interactive surface, reached
  // through its QR code (kiosk spec §2). No button and no sheet there.
  if (isKioskPath(pathname)) return null;

  return (
    <>
      {isAdminPath(pathname) ? null : (
        <button
          type="button"
          data-slot="chat-launcher"
          aria-expanded={isOpen}
          aria-controls="makerlab-chat-sheet"
          aria-label={t("openAria")}
          title={t("openAria")}
          onClick={() => open()}
          onPointerEnter={() => void preloadChatPanel()}
          onFocus={() => void preloadChatPanel()}
          className="ui fixed end-4 bottom-4 z-40 inline-flex size-12 cursor-pointer items-center justify-center border border-primary bg-primary text-primary-foreground transition-colors duration-150 hover:bg-primary/85 sm:end-6 sm:bottom-6"
        >
          <BotMessageSquareIcon aria-hidden="true" className="size-6" />
        </button>
      )}
      {introVisible ? (
        <AssistantIntro
          t={t}
          onDismiss={markIntroSeen}
          onOpen={() => {
            markIntroSeen();
            open();
          }}
        />
      ) : null}
      {mount === null ? null : mount.Panel ? (
        <mount.Panel />
      ) : (
        <Suspense fallback={null}>
          <LazyPanel />
        </Suspense>
      )}
    </>
  );
}

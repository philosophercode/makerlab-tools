"use client";

import { lazy, Suspense, useState, type ComponentType } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useChatLauncher } from "./ChatLauncherContext";

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

const LazyPanel = lazy(() => preloadChatPanel().then((panel) => ({ default: panel })));

/**
 * The assistant's floating button, and the assistant itself once it has been
 * opened (performance: the panel is not part of any page's first load).
 *
 * The button is drawn on public pages only (see `ChatPanel`). The panel
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
          className="ui fixed end-4 bottom-4 z-40 inline-flex size-12 cursor-pointer items-center justify-center border border-primary bg-primary font-mono text-sm font-bold text-primary-foreground transition-colors duration-150 hover:bg-primary/85 sm:end-6 sm:bottom-6"
        >
          <span aria-hidden="true">&gt;_</span>
        </button>
      )}
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

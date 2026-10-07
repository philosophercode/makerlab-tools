"use client";

import { lazy, Suspense, useCallback, useEffect, useState, type ComponentType } from "react";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import type { Role } from "../../lib/auth/roles";
import type { PaletteTool } from "./palette-types";
import type { CommandPaletteDialog as DialogComponent } from "./CommandPaletteDialog";
import { cn } from "@/lib/utils";

/**
 * Where `/` puts the cursor: the page's own search — a list's `FilterBar`
 * field, or the home page's smart search (a combobox input).
 */
const PAGE_SEARCH_SELECTOR = '[role="search"] input[type="search"], [role="search"] input[role="combobox"]';

/**
 * The ⌘K palette, on every page (UI system spec §7.5; DESIGN.md §8.12; public
 * polish — it began as the admin's). Jump to a tool by its display name,
 * official name or slug, to a category (the gallery filtered to it), to a
 * page (Tools, Projects, About, MCP) — and, for a viewer whose role opens
 * them, to an admin page or one of the admin actions.
 *
 * - **Tools** arrive from the root layout (the published catalogue, cached)
 *   or, on an admin page, from the admin layout's index with drafts for a
 *   viewer who may see them (`PaletteScope`). `null` means the list could not
 *   be read, and the palette says so.
 * - **Admin pages** are `surfacesFor(role)` — the same `can()` each page
 *   checks — so the palette never offers a refusal; an anonymous visitor or a
 *   student sees none, and no admin action.
 * - **Actions**: Add equipment (`tools.add`) and Refresh catalog (`tools.edit`).
 * - **`onAsk`** opens the assistant (phase 5b; the header passes it on every
 *   page): "Ask MakerLAB AI" with nothing typed (`onAsk("")`), "Ask
 *   MakerLAB AI: “…”" with the query as the first message. It is the last
 *   group, so Enter still opens the first tool or page that matches.
 *
 * The header shows it as a compact field, "Search tools… ⌘K" (an icon button
 * on a phone). ⌘K / Ctrl-K opens and closes it from anywhere; `/` focuses the
 * page's own search (the first `FilterBar`, or the home page's smart search)
 * unless focus is already in a field. Radix's Dialog gives the focus trap, Escape and focus return.
 *
 * **The dialog itself (`CommandPaletteDialog`, with cmdk) loads the first time
 * the palette opens** — or when the pointer or focus reaches a trigger — not
 * with every page (performance). From then on it stays mounted.
 */
export interface CommandPaletteProps {
  role: Role;
  /** Tools to jump to, or null when the list could not be read. */
  tools: readonly PaletteTool[] | null;
  /** Open the assistant; `query` (possibly empty) is what was typed, sent as the first message. */
  onAsk?: (query: string) => void;
  /**
   * The page has its own search box (the home page and `/tools`, student home
   * spec 2026-10-07 §6): the header's field keeps its place but is not
   * shown or reachable, so the page has one box. ⌘K still opens the palette.
   */
  triggerHidden?: boolean;
}

type Dialog = typeof DialogComponent;

let LoadedDialog: Dialog | null = null;

/** Fetch the dialog's code ahead of the first open (hover, focus), or for a test. */
export function preloadPaletteDialog(): Promise<Dialog> {
  return import("./CommandPaletteDialog").then((mod) => {
    LoadedDialog = mod.CommandPaletteDialog;
    return mod.CommandPaletteDialog;
  });
}

const LazyDialog = lazy(() => preloadPaletteDialog().then((dialog) => ({ default: dialog as ComponentType<Parameters<Dialog>[0]> })));

export function CommandPalette({ triggerHidden = false, ...props }: CommandPaletteProps) {
  const t = useTranslations("palette");
  const [open, setOpen] = useState(false);
  // Decided once, at the first open, and never switched (a different element
  // would remount the dialog): directly when already loaded, else via `lazy`.
  const [mount, setMount] = useState<{ Dialog: Dialog | null } | null>(null);
  if (open && mount === null) setMount({ Dialog: LoadedDialog });
  const preload = useCallback(() => void preloadPaletteDialog(), []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
        return;
      }
      if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && !isEditable(event.target)) {
        const search = document.querySelector<HTMLInputElement>(PAGE_SEARCH_SELECTOR);
        if (search) {
          event.preventDefault();
          search.focus();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const dialogProps = { ...props, open, onOpenChange: setOpen };
  // Hidden but in place: the header's boxes stay the same on every page.
  const hiddenProps = triggerHidden ? ({ "aria-hidden": true, tabIndex: -1 } as const) : {};

  return (
    <>
      <button
        type="button"
        aria-keyshortcuts="Meta+K Control+K"
        onClick={() => setOpen(true)}
        onPointerEnter={preload}
        onFocus={preload}
        data-slot="palette-trigger"
        {...hiddenProps}
        className={cn("ui hidden h-8 w-52 cursor-pointer items-center gap-2 border border-input bg-background px-2 text-start text-table text-muted-foreground normal-case transition-colors duration-150 hover:border-foreground/40 hover:text-foreground md:inline-flex lg:w-36 xl:w-60", triggerHidden && "invisible")}
      >
        <Search aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="flex-1 truncate font-sans tracking-normal">{t("trigger")}</span>
        <kbd aria-hidden="true" className="border border-border px-1 font-mono text-micro text-muted-foreground">
          ⌘K
        </kbd>
      </button>
      <button
        type="button"
        aria-keyshortcuts="Meta+K Control+K"
        aria-label={t("open")}
        title={t("open")}
        onClick={() => setOpen(true)}
        onPointerEnter={preload}
        onFocus={preload}
        data-slot="palette-trigger-icon"
        {...hiddenProps}
        className={cn(
          "ui inline-flex size-8 cursor-pointer items-center justify-center border border-input text-muted-foreground transition-colors duration-150 hover:text-foreground md:hidden",
          triggerHidden && "invisible"
        )}
      >
        <Search aria-hidden="true" className="size-4" />
      </button>

      {mount === null ? null : mount.Dialog ? (
        <mount.Dialog {...dialogProps} />
      ) : (
        <Suspense fallback={null}>
          <LazyDialog {...dialogProps} />
        </Suspense>
      )}
    </>
  );
}

/** Focus is in something that takes typing, where `/` is a character. */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

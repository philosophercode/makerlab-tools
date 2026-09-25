"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { LayoutGrid, MessageSquare, PackagePlus, RefreshCw, Search } from "lucide-react";
import { useChatLauncher } from "../ChatLauncherContext";
import { REVALIDATE_ENDPOINT } from "../RefreshCatalogButton";
import { can } from "../../lib/auth/permissions";
import type { Role } from "../../lib/auth/roles";
import { canAddEquipment } from "../../lib/capabilities/access";
import { ADMIN_HOME, surfacesFor } from "../../lib/admin/surfaces";
import type { ToolIndexEntry } from "../../lib/data/tool-index";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { paletteScore } from "./palette-match";
import { RowStatus } from "./RowStatus";

/**
 * The admin ⌘K palette (UI system spec §7.5; DESIGN.md §8.12): jump to any
 * surface the viewer may open, to any tool by its display name, official name
 * or slug, or run one of the few admin actions — without going back to
 * `/admin` first.
 *
 * - **Surfaces** are `surfacesFor(role)`: the section bar's list, filtered by
 *   the same `can()` the pages check, so the palette never offers a refusal.
 * - **Tools** arrive from the layout (`listToolIndex`, drafts only for a
 *   viewer who may see them) and open the tool's own page, where the editor
 *   is. `null` means the list could not be read, and the palette says so.
 * - **Actions**: Add equipment (`tools.add`, opens the assistant with the
 *   same seed the profile menu uses) and Refresh catalog (`tools.edit`, the
 *   revalidate route, confirmed in place).
 * - **`onAsk`** is the assistant's hook (phase 5): given one, the palette
 *   offers "Ask the assistant" with whatever was typed. Nothing passes it yet;
 *   the floating button is still how admins open the chat until phase 5 hides
 *   it on admin pages.
 *
 * ⌘K / Ctrl-K opens and closes it from anywhere on an admin page; `/` focuses
 * the page's own filter search (the first `FilterBar`), unless focus is
 * already in a field. Radix's Dialog gives the focus trap, Escape and focus
 * return. Never mounted for anonymous visitors: the layout renders it only
 * behind the admin gate.
 */
export interface CommandPaletteProps {
  role: Role;
  /** Tools to jump to, or null when the list could not be read. */
  tools: readonly ToolIndexEntry[] | null;
  /** Phase 5: ask the assistant about what was typed. */
  onAsk?: (query: string) => void;
}

type RefreshState = "idle" | "refreshing" | "refreshed" | "failed";

export function CommandPalette({ role, tools, onAsk }: CommandPaletteProps) {
  const t = useTranslations("admin.palette");
  const tNav = useTranslations("admin.nav");
  const tRoot = useTranslations();
  const router = useRouter();
  const { open: openChat } = useChatLauncher();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [refresh, setRefresh] = useState<RefreshState>("idle");

  const surfaces = useMemo(() => surfacesFor({ role }), [role]);
  const canAdd = canAddEquipment({ role });
  const canRefresh = can({ role }, "tools.edit");

  const setOpenAndReset = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
        return;
      }
      if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && !isEditable(event.target)) {
        const search = document.querySelector<HTMLInputElement>('[role="search"] input[type="search"]');
        if (search) {
          event.preventDefault();
          search.focus();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  function go(href: string) {
    setOpenAndReset(false);
    router.push(href);
  }

  async function refreshCatalog() {
    if (refresh === "refreshing") return;
    setRefresh("refreshing");
    try {
      const res = await fetch(REVALIDATE_ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      setRefresh(res.ok ? "refreshed" : "failed");
    } catch {
      setRefresh("failed");
    }
  }

  const asking = onAsk && query.trim() ? query.trim() : null;

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        aria-keyshortcuts="Meta+K Control+K"
        aria-label={t("open")}
        onClick={() => setOpenAndReset(true)}
        className="gap-2"
      >
        <Search aria-hidden="true" />
        <span className="hidden sm:inline">{t("trigger")}</span>
        <kbd className="hidden border border-border px-1 font-mono text-micro text-muted-foreground sm:inline">⌘K</kbd>
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={setOpenAndReset}
        title={t("title")}
        description={t("description")}
        commandProps={{ filter: (_value, search, keywords) => paletteScore(search, keywords ?? []), loop: true }}
      >
        <CommandInput value={query} onValueChange={setQuery} placeholder={t("placeholder")} aria-label={t("placeholder")} />
        <CommandList>
          <CommandEmpty>{t("empty", { query })}</CommandEmpty>

          {asking ? (
            <CommandGroup heading={t("assistant")} forceMount>
              <CommandItem
                value="ask"
                forceMount
                onSelect={() => {
                  setOpenAndReset(false);
                  onAsk?.(asking);
                }}
              >
                <MessageSquare aria-hidden="true" />
                {t("ask", { query: asking })}
              </CommandItem>
            </CommandGroup>
          ) : null}

          <CommandGroup heading={t("surfaces")}>
            <CommandItem value="surface:overview" keywords={[tNav("overview"), t("home")]} onSelect={() => go(ADMIN_HOME)}>
              <LayoutGrid aria-hidden="true" />
              {tNav("overview")}
            </CommandItem>
            {surfaces.map((surface) => {
              const Icon = surface.icon;
              const title = tNav(`surface.${surface.key}`);
              return (
                <CommandItem
                  key={surface.key}
                  value={`surface:${surface.key}`}
                  keywords={[title, tNav(`group.${surface.group}`)]}
                  onSelect={() => go(surface.href)}
                >
                  <Icon aria-hidden="true" />
                  <span>{title}</span>
                  <CommandShortcut>{tNav(`group.${surface.group}`)}</CommandShortcut>
                </CommandItem>
              );
            })}
          </CommandGroup>

          {canAdd || canRefresh ? (
            <CommandGroup heading={t("actions")}>
              {canAdd ? (
                <CommandItem
                  value="action:add"
                  keywords={[t("addEquipment")]}
                  onSelect={() => {
                    setOpenAndReset(false);
                    openChat(tRoot("nav.addSeed"));
                  }}
                >
                  <PackagePlus aria-hidden="true" />
                  {t("addEquipment")}
                </CommandItem>
              ) : null}
              {canRefresh ? (
                <CommandItem value="action:refresh" keywords={[t("refreshCatalog")]} onSelect={() => void refreshCatalog()}>
                  <RefreshCw aria-hidden="true" />
                  {t("refreshCatalog")}
                </CommandItem>
              ) : null}
            </CommandGroup>
          ) : null}

          {tools && tools.length > 0 ? (
            <CommandGroup heading={t("tools")}>
              {tools.map((tool) => (
                <CommandItem
                  key={tool.id}
                  value={`tool:${tool.id}`}
                  keywords={[tool.name, tool.officialName ?? "", tool.slug]}
                  onSelect={() => go(`/tools/${tool.slug}`)}
                >
                  <span className="truncate">{tool.name}</span>
                  {tool.officialName && tool.officialName !== tool.name ? (
                    <span className="truncate text-xs text-muted-foreground">{tool.officialName}</span>
                  ) : null}
                  {tool.published ? null : <CommandShortcut>{t("draft")}</CommandShortcut>}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>

        <div className="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-3 py-2 font-mono text-micro tracking-[0.06em] text-muted-foreground uppercase">
          <span>{t("hint")}</span>
          {tools === null ? <RowStatus tone="warn" className="basis-auto normal-case">{t("toolsUnavailable")}</RowStatus> : null}
          <RowStatus tone={refresh === "failed" ? "bad" : "muted"} className="basis-auto normal-case">
            {refresh === "idle" ? null : tRoot(`catalogRefresh.${refresh}`)}
          </RowStatus>
        </div>
      </CommandDialog>
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

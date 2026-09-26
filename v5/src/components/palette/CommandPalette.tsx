"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Folder, Info, LayoutGrid, MessageSquare, PackagePlus, Plug, RefreshCw, Search, Wrench } from "lucide-react";
import { useChatLauncher } from "../ChatLauncherContext";
import { REVALIDATE_ENDPOINT } from "../RefreshCatalogButton";
import { can } from "../../lib/auth/permissions";
import type { Role } from "../../lib/auth/roles";
import { canAddEquipment } from "../../lib/capabilities/access";
import { ADMIN_HOME, surfacesFor } from "../../lib/admin/surfaces";
import type { PaletteTool } from "./palette-types";
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
import { RowStatus } from "../admin/RowStatus";
import { FROSTED } from "../system/frosted";
import { cn } from "@/lib/utils";

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
 * - **`onAsk`** is the assistant's hook (phase 5b): given one, the palette
 *   offers "Ask the assistant" with whatever was typed.
 *
 * The header shows it as a compact field, "Search tools… ⌘K" (an icon button
 * on a phone). ⌘K / Ctrl-K opens and closes it from anywhere; `/` focuses the
 * page's own filter search (the first `FilterBar`) unless focus is already in
 * a field. Radix's Dialog gives the focus trap, Escape and focus return.
 */
export interface CommandPaletteProps {
  role: Role;
  /** Tools to jump to, or null when the list could not be read. */
  tools: readonly PaletteTool[] | null;
  /** Phase 5b: ask the assistant about what was typed. */
  onAsk?: (query: string) => void;
}

const PAGES = [
  { key: "tools", href: "/", icon: Wrench },
  { key: "projects", href: "/projects", icon: Folder },
  { key: "about", href: "/about", icon: Info },
  { key: "mcp", href: "/mcp", icon: Plug },
] as const;

type RefreshState = "idle" | "refreshing" | "refreshed" | "failed";

export function CommandPalette({ role, tools, onAsk }: CommandPaletteProps) {
  const t = useTranslations("palette");
  const tNav = useTranslations("admin.nav");
  const tRoot = useTranslations();
  const router = useRouter();
  const { open: openChat } = useChatLauncher();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [refresh, setRefresh] = useState<RefreshState>("idle");

  const surfaces = useMemo(() => surfacesFor({ role }), [role]);
  const staff = surfaces.length > 0;
  // The category groups the tools fall in, each with its count — a link to the gallery filtered to it.
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tool of tools ?? []) if (tool.category) counts.set(tool.category, (counts.get(tool.category) ?? 0) + 1);
    return Array.from(counts.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [tools]);
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
      <button
        type="button"
        aria-keyshortcuts="Meta+K Control+K"
        onClick={() => setOpenAndReset(true)}
        data-slot="palette-trigger"
        className="ui hidden h-8 w-52 cursor-pointer items-center gap-2 border border-input bg-background px-2 text-start text-table text-muted-foreground normal-case transition-colors duration-150 hover:border-foreground/40 hover:text-foreground md:inline-flex xl:w-60"
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
        onClick={() => setOpenAndReset(true)}
        className="ui inline-flex size-8 cursor-pointer items-center justify-center border border-input text-muted-foreground transition-colors duration-150 hover:text-foreground md:hidden"
      >
        <Search aria-hidden="true" className="size-4" />
      </button>

      <CommandDialog
        open={open}
        onOpenChange={setOpenAndReset}
        title={t("title")}
        description={t(staff ? "descriptionStaff" : "description")}
        className={cn(FROSTED, "bg-card")}
        commandProps={{ className: "bg-transparent", filter: (_value, search, keywords) => paletteScore(search, keywords ?? []), loop: true }}
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

          <CommandGroup heading={t("pages")}>
            {PAGES.map((page) => {
              const Icon = page.icon;
              const title = t(`page.${page.key}`);
              return (
                <CommandItem key={page.key} value={`page:${page.key}`} keywords={[title]} onSelect={() => go(page.href)}>
                  <Icon aria-hidden="true" />
                  {title}
                </CommandItem>
              );
            })}
          </CommandGroup>

          {categories.length > 0 ? (
            <CommandGroup heading={t("categories")}>
              {categories.map(([category, count]) => (
                <CommandItem
                  key={category}
                  value={`category:${category}`}
                  keywords={[category]}
                  onSelect={() => go(`/?${new URLSearchParams({ category }).toString()}`)}
                >
                  <LayoutGrid aria-hidden="true" />
                  <span>{category}</span>
                  <CommandShortcut>{t("categoryCount", { count })}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {staff ? (
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
          ) : null}

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
                  {tool.published ? (
                    tool.category ? <CommandShortcut>{tool.category}</CommandShortcut> : null
                  ) : (
                    <CommandShortcut>{t("draft")}</CommandShortcut>
                  )}
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

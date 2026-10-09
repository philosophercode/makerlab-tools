"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Folder, Info, LayoutGrid, MessageSquare, PackagePlus, Plug, RefreshCw, Wrench } from "lucide-react";
import { useChatLauncher } from "../ChatLauncherContext";
import { openClientQueryPage } from "../use-url-state";
import { REVALIDATE_ENDPOINT } from "../RefreshCatalogButton";
import { can } from "../../lib/auth/permissions";
import { canAddEquipment } from "../../lib/capabilities/access";
import { ADMIN_HOME, surfacesFor } from "../../lib/admin/surfaces";
import type { CommandPaletteProps } from "./CommandPalette";
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
import { categoryEntries, categoryKeywords, toolKeywords } from "./palette-search";
import { RowStatus } from "../admin/RowStatus";
import { FROSTED } from "../system/frosted";
import { cn } from "@/lib/utils";
import { ALL_TOOLS_PATH, categoryHref } from "../../lib/gallery-links";

/**
 * The ⌘K palette's dialog — everything but its triggers and shortcut, which
 * are `CommandPalette`'s. Loaded the first time the palette opens (it carries
 * cmdk and the dialog), then kept mounted.
 */
const PAGES = [
  // The tool list is the home page (student home spec, amendment "One page: the list at rest").
  { key: "tools", href: ALL_TOOLS_PATH, icon: Wrench },
  { key: "projects", href: "/projects", icon: Folder },
  { key: "about", href: "/about", icon: Info },
  { key: "mcp", href: "/mcp", icon: Plug },
] as const;

type RefreshState = "idle" | "refreshing" | "refreshed" | "failed";

export function CommandPaletteDialog({
  role,
  tools,
  onAsk,
  open,
  onOpenChange,
}: CommandPaletteProps & { open: boolean; onOpenChange: (next: boolean) => void }) {
  const t = useTranslations("palette");
  const tNav = useTranslations("admin.nav");
  const tRoot = useTranslations();
  const router = useRouter();
  const { open: openChat } = useChatLauncher();
  const [query, setQuery] = useState("");
  const [refresh, setRefresh] = useState<RefreshState>("idle");

  const surfaces = useMemo(() => surfacesFor({ role }), [role]);
  const staff = surfaces.length > 0;
  // The category groups the tools fall in, each with its count — a link to the full list filtered to it.
  const categories = useMemo(() => categoryEntries(tools ?? []), [tools]);
  const canAdd = canAddEquipment({ role });
  const canRefresh = can({ role }, "tools.edit");

  const setOpenAndReset = useCallback(
    (next: boolean) => {
      onOpenChange(next);
      if (!next) setQuery("");
    },
    [onOpenChange]
  );

  function go(href: string) {
    setOpenAndReset(false);
    router.push(href);
  }

  /** A link to the tool list (a category): on the home page itself, the list reads it in place. */
  function goToList(href: string) {
    setOpenAndReset(false);
    openClientQueryPage(href, (target) => router.push(target));
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
              {categories.map((category) => (
                <CommandItem
                  key={category.name}
                  value={`category:${category.name}`}
                  keywords={categoryKeywords(category)}
                  onSelect={() => goToList(categoryHref(category.name))}
                >
                  <LayoutGrid aria-hidden="true" />
                  <span>{category.name}</span>
                  <CommandShortcut>{t("categoryCount", { count: category.count })}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {staff ? (
          <CommandGroup heading={t("surfaces")}>
            <CommandItem value="surface:overview" keywords={[tNav("section.overview"), t("home")]} onSelect={() => go(ADMIN_HOME)}>
              <LayoutGrid aria-hidden="true" />
              {tNav("section.overview")}
            </CommandItem>
            {surfaces.map((surface) => {
              const Icon = surface.icon;
              const title = tNav(`surface.${surface.key}`);
              return (
                <CommandItem
                  key={surface.key}
                  value={`surface:${surface.key}`}
                  keywords={[title, tNav(`section.${surface.section}`)]}
                  onSelect={() => go(surface.href)}
                >
                  <Icon aria-hidden="true" />
                  <span>{title}</span>
                  <CommandShortcut>{tNav(`section.${surface.section}`)}</CommandShortcut>
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
                  keywords={toolKeywords(tool)}
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

          {/* Last, so Enter still opens the first tool or page that matches;
              with a query it is always there, even when nothing else matches. */}
          {onAsk ? (
            <CommandGroup heading={t("assistant")} forceMount={asking !== null}>
              {asking ? (
                <CommandItem
                  value="ask"
                  forceMount
                  onSelect={() => {
                    setOpenAndReset(false);
                    onAsk(asking);
                  }}
                >
                  <MessageSquare aria-hidden="true" />
                  {t("ask", { query: asking })}
                </CommandItem>
              ) : (
                <CommandItem
                  value="ask:open"
                  keywords={[t("askEmpty")]}
                  onSelect={() => {
                    setOpenAndReset(false);
                    onAsk("");
                  }}
                >
                  <MessageSquare aria-hidden="true" />
                  {t("askEmpty")}
                </CommandItem>
              )}
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
  );
}

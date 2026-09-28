"use client";

import { useId, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import type { QueueRefreshAction, QueueRefreshResult } from "../../app/admin/refresh/action-result";
import { RESEARCH_MAX_ITEMS_PER_REQUEST } from "../../lib/intake/limits";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DataTable } from "../system/data-table/DataTable";
import { EmptyState } from "../system/EmptyState";
import { Field } from "../system/Field";
import { RowStatus } from "./RowStatus";
import {
  NO_PICKER_FILTERS,
  PICKER_PRESETS,
  STALE_AFTER_DAYS,
  matchesPicker,
  pickerCategories,
  type PickerFilters,
  type PickerPreset,
  type PickerTool,
} from "./refresh-picker-filters";

/**
 * **Refresh research…** on `/admin/refresh` (amendment 2026-09-25 "Admin
 * polish"): start refresh research from the page that shows its results,
 * instead of only from the inventory's selection.
 *
 * A dialog — a decision, not a form that belongs to the page (DESIGN.md §8.8).
 * Presets name the reasons a tool is worth researching again (never reviewed,
 * no manual, not refreshed in 90 days), a category narrows them, and the
 * matching tools are a `DataTable` with boxes. **Select the first 25** fills
 * the press. The start goes through `queueToolRefresh`, the inventory's own
 * action: `tools.edit`, 25 a press, the shared daily allowance, a tool with a
 * refresh already open skipped — so the limits are the server's, said here in
 * its words. A tool whose refresh is open cannot be ticked.
 */

export interface RefreshPickerProps {
  tools: readonly PickerTool[];
  action: QueueRefreshAction;
  /** "now" for the 90-day preset: the server's clock, so both renders agree. */
  now: string;
}

export function RefreshPicker({ tools, action, now }: RefreshPickerProps) {
  const t = useTranslations("admin.refresh.picker");
  const tr = useTranslations("admin.refresh");
  const te = useTranslations("admin.errors");
  const [open, setOpen] = useState(false);
  const [filters, setFilters] = useState<PickerFilters>(NO_PICKER_FILTERS);
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [descriptions, setDescriptions] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<QueueRefreshResult | null>(null);
  const searchId = useId();
  const categoryId = useId();
  const descriptionsId = useId();
  const clock = useMemo(() => new Date(now), [now]);
  const categories = useMemo(() => pickerCategories(tools), [tools]);

  const shown = useMemo(() => tools.filter((tool) => matchesPicker(tool, filters, clock)), [tools, filters, clock]);
  const selectedIds = Object.keys(selection).filter((id) => selection[id]);
  const count = selectedIds.length;
  const tooMany = count > RESEARCH_MAX_ITEMS_PER_REQUEST;

  function togglePreset(preset: PickerPreset) {
    setFilters((current) => ({
      ...current,
      presets: current.presets.includes(preset) ? current.presets.filter((p) => p !== preset) : [...current.presets, preset],
    }));
  }

  function selectFirst() {
    const ids = shown.filter((tool) => !tool.refreshOpen).slice(0, RESEARCH_MAX_ITEMS_PER_REQUEST).map((tool) => tool.id);
    setSelection(Object.fromEntries(ids.map((id) => [id, true])));
  }

  function reset(next: boolean) {
    setOpen(next);
    if (!next) {
      // Closing forgets the press, so the next opening starts clean.
      setResult(null);
      setSelection({});
      setFilters(NO_PICKER_FILTERS);
      setDescriptions(false);
    }
  }

  async function start() {
    setPending(true);
    setResult(null);
    try {
      const outcome = await action({ toolIds: selectedIds, includeDescription: descriptions, note: null });
      setResult(outcome);
      if (outcome.ok && outcome.queued > 0) setSelection({});
    } catch {
      setResult({ ok: false, error: "failed" });
    } finally {
      setPending(false);
    }
  }

  const columns: ColumnDef<PickerTool, unknown>[] = [
    {
      id: "name",
      accessorFn: (tool) => tool.name,
      header: t("columnTool"),
      meta: { rowHeader: true, className: "whitespace-normal" },
      cell: ({ row }) => (
        <span className="flex flex-col">
          <span>{row.original.name}</span>
          {row.original.refreshOpen ? (
            <span id={`${row.original.id}-open`} className="font-mono text-micro tracking-[0.06em] text-muted-foreground uppercase">
              {t("refreshOpen")}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: "category",
      accessorFn: (tool) => tool.categoryName ?? "",
      header: t("columnCategory"),
      cell: ({ row }) => row.original.categoryName ?? "—",
    },
    {
      id: "lastRefreshed",
      accessorFn: (tool) => tool.lastRefreshedAt ?? "",
      header: t("columnLastRefreshed"),
      meta: { className: "text-end", cellClassName: "text-end font-mono tabular-nums" },
      cell: ({ row }) => (row.original.lastRefreshedAt ? row.original.lastRefreshedAt.slice(0, 10) : t("never")),
    },
  ];

  const filterWords = [
    ...filters.presets.map((preset) => t(`preset.${preset}`, { days: STALE_AFTER_DAYS })),
    ...(filters.category ? [filters.category] : []),
    ...(filters.query.trim() ? [`“${filters.query.trim()}”`] : []),
  ];

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button variant="default">{t("open")}</Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("close")} className="max-h-[90vh] grid-rows-[auto_auto_minmax(0,1fr)_auto] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{tr("dialogTitle")}</DialogTitle>
          <DialogDescription>{t("lede", { max: RESEARCH_MAX_ITEMS_PER_REQUEST })}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div role="group" aria-label={t("presetsLabel")} className="flex flex-wrap gap-2">
            {PICKER_PRESETS.map((preset) => (
              <Button
                key={preset}
                size="sm"
                variant={filters.presets.includes(preset) ? "outline" : "quiet"}
                aria-pressed={filters.presets.includes(preset)}
                onClick={() => togglePreset(preset)}
              >
                {t(`preset.${preset}`, { days: STALE_AFTER_DAYS })}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Field id={searchId} label={t("search")} className="min-w-[12rem] flex-1">
              <Input
                id={searchId}
                type="search"
                value={filters.query}
                onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
              />
            </Field>
            <Field id={categoryId} label={t("category")}>
              <NativeSelect
                id={categoryId}
                size="sm"
                value={filters.category ?? ""}
                onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value || null }))}
              >
                <option value="">{t("anyCategory")}</option>
                {categories.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Button size="sm" disabled={shown.every((tool) => tool.refreshOpen)} onClick={selectFirst}>
              {t("selectFirst", { max: RESEARCH_MAX_ITEMS_PER_REQUEST })}
            </Button>
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto border-y border-rule">
          <DataTable
            data={shown}
            columns={columns}
            getRowId={(tool) => tool.id}
            getRowName={(tool) => tool.name}
            labels={{ table: t("tableLabel"), selected: (n) => t("selected", { count: n }) }}
            selectable
            canSelectRow={(tool) => !tool.refreshOpen}
            selectDescribedBy={(tool) => (tool.refreshOpen ? `${tool.id}-open` : undefined)}
            selection={selection}
            onSelectionChange={setSelection}
            stickyHeader={false}
            keyboardHint={false}
            empty={
              <EmptyState
                action={
                  <Button size="sm" variant="ghost" onClick={() => setFilters(NO_PICKER_FILTERS)}>
                    {t("clear")}
                  </Button>
                }
              >
                {tools.length === 0 ? t("noTools") : t("noMatch", { filters: filterWords.join(" · ") })}
              </EmptyState>
            }
          />
        </div>

        <DialogFooter className="flex-col items-stretch gap-3 sm:flex-col sm:items-stretch">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Checkbox id={descriptionsId} checked={descriptions} onCheckedChange={(value) => setDescriptions(value === true)} />
            <label htmlFor={descriptionsId}>{tr("dialogDescriptions")}</label>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-label tracking-[0.06em] text-muted-foreground uppercase tabular-nums" aria-live="polite">
              {t("counts", { shown: shown.length, selected: count })}
            </span>
            <span className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => reset(false)} disabled={pending}>
                {tr("cancel")}
              </Button>
              <Button variant="default" disabled={pending || count === 0 || tooMany} onClick={() => void start()}>
                {pending ? tr("saving") : t("start", { count })}
              </Button>
            </span>
          </div>
          {tooMany ? (
            <RowStatus tone="bad" as="p">
              {te("too_many_tools")}
            </RowStatus>
          ) : null}
          {result ? (
            result.ok ? (
              <RowStatus tone={result.queued > 0 ? "ok" : "warn"} as="p" className="text-sm">
                {result.queued > 0 ? tr("dialogStarted", { count: result.queued }) : t("nothingStarted")}{" "}
                {result.skipped > 0 ? tr("dialogSkipped", { count: result.skipped }) : null}
              </RowStatus>
            ) : (
              <RowStatus tone="bad" role="alert" as="p" className="text-sm">
                {result.error === "daily_limit" ? tr("dialogLimit", { remaining: result.remaining ?? 0 }) : te(result.error)}
              </RowStatus>
            )
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

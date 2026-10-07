"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Download, Printer } from "lucide-react";
import { useTranslations } from "next-intl";
import { matchSorter } from "match-sorter";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable } from "../../system/data-table/DataTable";
import { FilterBar } from "../../system/data-table/FilterBar";
import { FacetFilter } from "../../system/data-table/FacetFilter";
import { facetOptions, uniqueValues } from "../../system/data-table/facet-options";
import { EmptyState } from "../../system/EmptyState";
import { RowStatus } from "../RowStatus";
import { useHydrated } from "../use-hydrated";
import { QrLabelStyler } from "./QrLabelStyler";
import { buildPdf, labelPngFile, labelSvgFile, loadMeasure, printPdf, saveBlob, savePdf } from "./label-files";
import {
  MIN_QR_MM,
  estimateTextWidth,
  layoutLabel,
  packSheet,
  pageCount,
  type LabelContent,
  type MeasureText,
} from "../../../lib/qr/label-layout";
import { labelSvgBody } from "../../../lib/qr/label-svg";
import { labelContentFor } from "../../../lib/qr/labels";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type QrLabelSettings } from "../../../lib/qr/settings";
import { QR_UNIT_PARAM, qrFileName, unitQrToken } from "../../../lib/qr/urls";

/** One physical unit of a tool (retired ones are not listed). */
export interface QrLabelUnit {
  id: string;
  name: string;
}

/** One published tool, as the label page lists it. */
export interface QrLabelRow {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  room: string | null;
  zone: string | null;
  /** Its units, for unit labels (QR codes spec amendment 2026-10-06). */
  units?: QrLabelUnit[];
}

/** What the list prints labels for: each tool, or each unit of each tool. */
export type QrLabelKind = "tools" | "units";

/**
 * One row of the list: a tool, or one unit of a tool. `key` is the tool's
 * slug or the unit's id, which is what the selection and the preview hold.
 */
interface LabelEntry {
  key: string;
  slug: string;
  /** What the row is called: the tool's name, or the unit's. */
  name: string;
  toolName: string;
  unit: QrLabelUnit | null;
  category: string | null;
  room: string | null;
  zone: string | null;
}

function entriesFor(rows: QrLabelRow[], kind: QrLabelKind): LabelEntry[] {
  if (kind === "tools") {
    return rows.map((row) => ({ key: row.slug, slug: row.slug, name: row.name, toolName: row.name, unit: null, category: row.category, room: row.room, zone: row.zone }));
  }
  return rows.flatMap((row) =>
    (row.units ?? []).map((unit) => ({
      key: unit.id,
      slug: row.slug,
      name: unit.name,
      toolName: row.name,
      unit,
      category: row.category,
      room: row.room,
      zone: row.zone,
    }))
  );
}

export interface QrLabelStudioProps {
  rows: QrLabelRow[];
  /** The public origin every code points at (`qrSiteUrl`). */
  origin: string;
  /** The wordmark image's path (`siteConfig.wordmark`). */
  wordmarkHref: string;
}

type Busy = null | "print" | "pdf" | "svg" | "png";
type Outcome = null | { tone: "ok" | "bad"; text: string };

/**
 * `/admin/inventory/qr` — print QR labels for the published catalogue (QR
 * labels). The list (search and a category facet over the shared `FilterBar`
 * + `DataTable`; the header box selects every row the filter shows), the
 * styler and a live preview of one label, drawn from the same layout the
 * PDF uses; **Print selected**, **Print all** and **Print this one** build
 * the PDF in the browser and open the print dialog in one click.
 *
 * **Tools or units.** By default the list is the tools; **Units** lists
 * every unit of every published tool instead, and each label then carries
 * the unit's name under the tool's and a code that names the unit
 * (`unitQrTargetUrl`). Scanning one opens the tool page with that unit named
 * and **Report a problem with this unit** first. The style is the same for both.
 *
 * The style is remembered per browser (`lib/qr/settings.ts`). It is read after
 * mount, so the server's first paint is the defaults and nothing mismatches.
 */
export function QrLabelStudio({ rows, origin, wordmarkHref }: QrLabelStudioProps) {
  const t = useTranslations("admin.qrLabels");
  // The stored style is read once the page has hydrated (the server paints
  // the defaults); an edit replaces it and is saved on the change itself.
  const hydrated = useHydrated();
  const stored = useMemo(() => (hydrated ? loadSettings() : DEFAULT_SETTINGS), [hydrated]);
  const [edited, setEdited] = useState<QrLabelSettings | null>(null);
  const settings = edited ?? stored;
  const setSettings = (next: QrLabelSettings) => {
    setEdited(next);
    saveSettings(next);
  };
  const [measure, setMeasure] = useState<MeasureText>(() => estimateTextWidth);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [kind, setKind] = useState<QrLabelKind>("tools");
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [previewKey, setPreviewKey] = useState<string | null>(rows[0]?.slug ?? null);
  const [busy, setBusy] = useState<Busy>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);

  useEffect(() => {
    // Helvetica's real widths, so the preview wraps exactly as the PDF will.
    loadMeasure()
      .then((real) => setMeasure(() => real))
      .catch(() => undefined);
  }, []);

  const unitCount = useMemo(() => rows.reduce((sum, row) => sum + (row.units?.length ?? 0), 0), [rows]);
  const entries = useMemo(() => entriesFor(rows, kind), [rows, kind]);
  const byKey = useMemo(() => new Map(entries.map((entry) => [entry.key, entry])), [entries]);
  const content = (entry: LabelEntry): LabelContent =>
    labelContentFor({ slug: entry.slug, name: entry.toolName, room: entry.room, zone: entry.zone, unit: entry.unit }, origin);

  const searched = useMemo(
    () =>
      query.trim()
        ? matchSorter(entries, query.trim(), { keys: ["name", "toolName", "category", "room", "zone"], threshold: matchSorter.rankings.CONTAINS })
        : entries,
    [entries, query]
  );
  const visible = useMemo(() => (category ? searched.filter((entry) => entry.category === category) : searched), [searched, category]);
  const categoryOptions = useMemo(
    () => facetOptions(searched, uniqueValues(entries.map((entry) => entry.category)), (entry, value) => entry.category === value),
    [entries, searched]
  );

  const selectedKeys = entries.filter((entry) => selection[entry.key]).map((entry) => entry.key);
  const grid = packSheet(settings.sheet, settings.style.widthMm, settings.style.heightMm);
  const preview = (previewKey && byKey.get(previewKey)) || entries[0] || null;
  const previewContent = preview ? content(preview) : null;

  /** Tools or units: the selection and the preview belong to one list, so both start over. */
  function chooseKind(next: QrLabelKind) {
    if (next === kind) return;
    setKind(next);
    setSelection({});
    setPreviewKey(entriesFor(rows, next)[0]?.key ?? null);
  }

  /** `form-4-label.svg`, or `prusa-mk4-adf75899-label.svg` for a unit. */
  const fileStem = (entry: LabelEntry) => (entry.unit ? `${entry.slug}-${unitQrToken(entry.unit.id)}` : entry.slug);
  /** Where a row's name links: the page its code opens, without the `src=qr` marker. */
  const pageHref = (entry: LabelEntry) =>
    entry.unit ? `/tools/${entry.slug}?${QR_UNIT_PARAM}=${unitQrToken(entry.unit.id)}` : `/tools/${entry.slug}`;
  const layout = previewContent ? layoutLabel(settings.style, previewContent, measure) : null;

  async function run(kind: Busy, work: () => Promise<void>) {
    setBusy(kind);
    setOutcome(null);
    try {
      await work();
    } catch (error) {
      setOutcome({ tone: "bad", text: (error as Error)?.message === "label_too_large" ? t("tooLarge") : t("failed") });
    } finally {
      setBusy(null);
    }
  }

  function labelsFor(keys: string[]): LabelContent[] {
    return keys.map((key) => byKey.get(key)).filter((entry): entry is LabelEntry => Boolean(entry)).map(content);
  }

  const printLabels = (keys: string[]) =>
    run("print", async () => {
      printPdf(await buildPdf(labelsFor(keys), settings, wordmarkHref, t("pdfTitle")));
    });

  const downloadPdf = (keys: string[]) =>
    run("pdf", async () => {
      savePdf(await buildPdf(labelsFor(keys), settings, wordmarkHref, t("pdfTitle")), kind === "units" ? "qr-unit-labels.pdf" : "qr-labels.pdf");
    });

  const nameHeader = kind === "units" ? t("columnUnit") : t("columnTool");
  const columns = useMemo<ColumnDef<LabelEntry, unknown>[]>(
    () => [
      {
        id: "name",
        accessorFn: (row) => row.name,
        header: nameHeader,
        sortingFn: "text",
        meta: { label: nameHeader, rowHeader: true },
        cell: ({ row }) => (
          <Link href={pageHref(row.original)} className="font-medium hover:underline">
            {row.original.name}
          </Link>
        ),
      },
      // A unit's row names its tool where a tool's row names its category:
      // the same width, and the category facet still filters either list.
      kind === "units"
        ? {
            id: "tool",
            accessorFn: (row) => row.toolName,
            header: t("columnTool"),
            sortingFn: "text",
            meta: { label: t("columnTool") },
          }
        : {
            id: "category",
            accessorFn: (row) => row.category ?? "",
            header: t("columnCategory"),
            sortingFn: "text",
            meta: { label: t("columnCategory") },
            cell: ({ row }) => row.original.category ?? <span className="text-muted-foreground">—</span>,
          },
      {
        id: "location",
        accessorFn: (row) => row.room ?? "",
        header: t("columnLocation"),
        sortingFn: "text",
        meta: { label: t("columnLocation") },
        cell: ({ row }) => content(row.original).location || <span className="text-muted-foreground">—</span>,
      },
      {
        id: "actions",
        header: () => <span className="sr-only">{t("columnActions")}</span>,
        enableSorting: false,
        meta: { className: "w-40 text-end" },
        cell: ({ row }) => (
          <span className="inline-flex gap-1">
            <Button variant="ghost" size="xs" aria-pressed={preview?.key === row.original.key} onClick={() => setPreviewKey(row.original.key)}>
              {t("previewRow")}
            </Button>
            <Button variant="ghost" size="xs" disabled={busy !== null || grid.perPage === 0} onClick={() => printLabels([row.original.key])}>
              <Printer aria-hidden="true" />
              {t("printRow")}
            </Button>
          </span>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the row actions read the current settings through closures rebuilt with them
    [t, preview?.key, busy, grid.perPage, settings, origin, kind, nameHeader]
  );

  const labelCount = (count: number) => t("labelsAndPages", { count, pages: pageCount(count, grid.perPage) });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
      <div className="flex min-w-0 flex-col gap-3">
        {/* Tools or units: a row of pressed/unpressed buttons, words rather than icons (as the styler's sizes). */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div role="group" aria-label={t("kindLabel")} className="flex flex-wrap gap-1">
            <Button size="sm" variant={kind === "tools" ? "default" : "quiet"} aria-pressed={kind === "tools"} onClick={() => chooseKind("tools")}>
              {t("kindTools", { count: rows.length })}
            </Button>
            <Button size="sm" variant={kind === "units" ? "default" : "quiet"} aria-pressed={kind === "units"} onClick={() => chooseKind("units")}>
              {t("kindUnits", { count: unitCount })}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{kind === "units" ? t("kindUnitsHint") : t("kindToolsHint")}</p>
        </div>
        <FilterBar
          label={t("filtersLabel")}
          search={{ value: query, onChange: setQuery, label: t("search"), placeholder: t("searchPlaceholder") }}
          facets={<FacetFilter label={t("filterCategory")} value={category} options={categoryOptions} onChange={setCategory} />}
          shown={visible.length}
          total={entries.length}
          onClear={query || category ? () => (setQuery(""), setCategory(null)) : null}
          activeCount={category ? 1 : 0}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={entries.length === 0} onClick={() => setSelection(Object.fromEntries(entries.map((entry) => [entry.key, true])))}>
            {t("selectAll", { count: entries.length })}
          </Button>
          <Button
            size="sm"
            disabled={visible.length === entries.length}
            onClick={() => setSelection((current) => ({ ...current, ...Object.fromEntries(visible.map((entry) => [entry.key, true])) }))}
          >
            {t("selectFiltered", { count: visible.length })}
          </Button>
          <Button size="sm" variant="ghost" disabled={selectedKeys.length === 0} onClick={() => setSelection({})}>
            {t("clearSelection")}
          </Button>
        </div>
        <DataTable
          data={visible}
          columns={columns}
          getRowId={(row) => row.key}
          getRowName={(row) => (row.unit ? `${row.name} (${row.toolName})` : row.name)}
          labels={{
            table: kind === "units" ? t("tableLabelUnits") : t("tableLabel"),
            selected: (count) => (kind === "units" ? t("selectedUnitsCount", { count }) : t("selectedCount", { count })),
            selectAll: t("selectShown"),
          }}
          empty={<EmptyState>{entries.length === 0 ? (kind === "units" ? t("emptyUnits") : t("emptyCatalogue")) : t("emptyFiltered")}</EmptyState>}
          selectable
          selection={selection}
          onSelectionChange={setSelection}
          onActivate={(row) => setPreviewKey(row.key)}
          initialSorting={[{ id: "name", desc: false }]}
          bulkActions={(ids) => (
            <Button variant="default" size="sm" disabled={busy !== null || grid.perPage === 0} onClick={() => printLabels(ids)}>
              <Printer aria-hidden="true" />
              {t("printSelected", { count: ids.length })}
            </Button>
          )}
          mobileRow={(row, { selected, toggle }) => (
            <div className="flex items-center gap-3 px-1 py-2.5">
              <Checkbox checked={selected} onCheckedChange={toggle} aria-label={t("selectRow", { name: row.name })} />
              <button type="button" className="min-w-0 flex-1 text-start" onClick={() => setPreviewKey(row.key)}>
                <span className="block truncate text-sm font-medium">{row.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {[row.unit ? row.toolName : null, row.category, content(row).location].filter(Boolean).join(" · ")}
                </span>
              </button>
              <Button variant="quiet" size="xs" disabled={busy !== null || grid.perPage === 0} onClick={() => printLabels([row.key])}>
                {t("printRow")}
              </Button>
            </div>
          )}
        />
      </div>

      {/* Sticky beside a long list, so it scrolls itself: taller than the window, its lower half was out of reach until the list ended. */}
      <aside
        aria-label={t("stylerLabel")}
        className="flex min-w-0 flex-col gap-5 border border-border bg-card p-4 lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:self-start lg:overflow-y-auto lg:overscroll-contain"
      >
        <section aria-labelledby="qr-preview-heading" className="flex flex-col gap-3">
          <h3 id="qr-preview-heading" className="font-mono text-label tracking-[0.08em] uppercase">
            {preview ? t("previewHeading", { tool: preview.name }) : t("previewEmpty")}
          </h3>
          {layout && previewContent ? (
            <>
              <div className="grid place-items-center bg-muted p-4">
                <svg
                  role="img"
                  aria-label={t("previewAlt", { tool: preview?.name ?? previewContent.name })}
                  viewBox={`0 0 ${layout.widthMm} ${layout.heightMm}`}
                  className="h-auto w-full max-w-60 shadow-sm"
                  style={{ aspectRatio: `${layout.widthMm} / ${layout.heightMm}` }}
                  data-qr-preview={previewContent.url}
                  dangerouslySetInnerHTML={{ __html: labelSvgBody(layout, previewContent.url, { wordmarkHref, outline: true }) }}
                />
              </div>
              <p className="font-mono text-label text-muted-foreground">
                {t("previewFacts", {
                  width: round1(settings.style.widthMm),
                  height: round1(settings.style.heightMm),
                  qr: round1(layout.qr.size),
                })}
              </p>
              {layout.qrSmall ? <RowStatus tone="warn">{t("qrSmall", { qr: round1(layout.qr.size), min: MIN_QR_MM })}</RowStatus> : null}
              {layout.dropped.length > 0 ? (
                <RowStatus tone="warn">{t("dropped", { items: layout.dropped.map((kind) => t(`droppable.${kind}`)).join(", ") })}</RowStatus>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button variant="default" size="sm" disabled={busy !== null || grid.perPage === 0} onClick={() => printLabels([preview!.key])}>
                  <Printer aria-hidden="true" />
                  {t("printThis")}
                </Button>
                <Button
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => run("svg", async () => saveBlob(await labelSvgFile(layout, previewContent, wordmarkHref), qrFileName(fileStem(preview!), "svg", "label")))}
                >
                  <Download aria-hidden="true" />
                  {t("downloadSvg")}
                </Button>
                <Button
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => run("png", async () => saveBlob(await labelPngFile(layout, previewContent, wordmarkHref), qrFileName(fileStem(preview!), "png", "label")))}
                >
                  <Download aria-hidden="true" />
                  {t("downloadPng")}
                </Button>
              </div>
            </>
          ) : (
            <EmptyState>{kind === "units" ? t("emptyUnits") : t("emptyCatalogue")}</EmptyState>
          )}
        </section>

        <section aria-labelledby="qr-sheet-heading" className="flex flex-col gap-2 border-t border-border pt-4">
          <h3 id="qr-sheet-heading" className="font-mono text-label tracking-[0.08em] uppercase">
            {t("sheetHeading")}
          </h3>
          <p className="text-sm">
            {grid.perPage === 0
              ? t("tooLarge")
              : settings.sheet.paper === "label"
                ? t("perPageLabel")
                : t("perPage", { count: grid.perPage, cols: grid.cols, rows: grid.rows, paper: t(`paperOption.${settings.sheet.paper}`) })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="default" size="sm" disabled={busy !== null || grid.perPage === 0 || selectedKeys.length === 0} onClick={() => printLabels(selectedKeys)}>
              <Printer aria-hidden="true" />
              {t("printSelected", { count: selectedKeys.length })}
            </Button>
            <Button size="sm" disabled={busy !== null || grid.perPage === 0 || entries.length === 0} onClick={() => printLabels(entries.map((entry) => entry.key))}>
              <Printer aria-hidden="true" />
              {t("printAll", { count: entries.length })}
            </Button>
            <Button
              size="sm"
              disabled={busy !== null || grid.perPage === 0 || entries.length === 0}
              onClick={() => downloadPdf(selectedKeys.length > 0 ? selectedKeys : entries.map((entry) => entry.key))}
            >
              <Download aria-hidden="true" />
              {t("downloadPdf")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {labelCount(selectedKeys.length > 0 ? selectedKeys.length : entries.length)} · {t("printHint")}
          </p>
          {busy ? <RowStatus tone="muted">{t(`busy.${busy}`)}</RowStatus> : null}
          {outcome ? (
            <RowStatus tone={outcome.tone} role={outcome.tone === "bad" ? "alert" : "status"}>
              {outcome.text}
            </RowStatus>
          ) : null}
        </section>

        <section className="border-t border-border pt-4">
          <QrLabelStyler settings={settings} onChange={setSettings} />
        </section>
      </aside>
    </div>
  );
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

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
import { qrFileName } from "../../../lib/qr/urls";

/** One published tool, as the label page lists it. */
export interface QrLabelRow {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  room: string | null;
  zone: string | null;
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
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [previewSlug, setPreviewSlug] = useState<string | null>(rows[0]?.slug ?? null);
  const [busy, setBusy] = useState<Busy>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);

  useEffect(() => {
    // Helvetica's real widths, so the preview wraps exactly as the PDF will.
    loadMeasure()
      .then((real) => setMeasure(() => real))
      .catch(() => undefined);
  }, []);

  const bySlug = useMemo(() => new Map(rows.map((row) => [row.slug, row])), [rows]);
  const content = (row: QrLabelRow): LabelContent => labelContentFor(row, origin);

  const searched = useMemo(
    () => (query.trim() ? matchSorter(rows, query.trim(), { keys: ["name", "category", "room", "zone"], threshold: matchSorter.rankings.CONTAINS }) : rows),
    [rows, query]
  );
  const visible = useMemo(() => (category ? searched.filter((row) => row.category === category) : searched), [searched, category]);
  const categoryOptions = useMemo(
    () => facetOptions(searched, uniqueValues(rows.map((row) => row.category)), (row, value) => row.category === value),
    [rows, searched]
  );

  const selectedSlugs = rows.filter((row) => selection[row.slug]).map((row) => row.slug);
  const grid = packSheet(settings.sheet, settings.style.widthMm, settings.style.heightMm);
  const preview = (previewSlug && bySlug.get(previewSlug)) || rows[0] || null;
  const previewContent = preview ? content(preview) : null;
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

  function labelsFor(slugs: string[]): LabelContent[] {
    return slugs.map((slug) => bySlug.get(slug)).filter((row): row is QrLabelRow => Boolean(row)).map(content);
  }

  const printLabels = (slugs: string[]) =>
    run("print", async () => {
      printPdf(await buildPdf(labelsFor(slugs), settings, wordmarkHref, t("pdfTitle")));
    });

  const downloadPdf = (slugs: string[]) =>
    run("pdf", async () => {
      savePdf(await buildPdf(labelsFor(slugs), settings, wordmarkHref, t("pdfTitle")), "qr-labels.pdf");
    });

  const columns = useMemo<ColumnDef<QrLabelRow, unknown>[]>(
    () => [
      {
        id: "name",
        accessorFn: (row) => row.name,
        header: t("columnTool"),
        sortingFn: "text",
        meta: { label: t("columnTool"), rowHeader: true },
        cell: ({ row }) => (
          <Link href={`/tools/${row.original.slug}`} className="font-medium hover:underline">
            {row.original.name}
          </Link>
        ),
      },
      {
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
            <Button variant="ghost" size="xs" aria-pressed={preview?.slug === row.original.slug} onClick={() => setPreviewSlug(row.original.slug)}>
              {t("previewRow")}
            </Button>
            <Button variant="ghost" size="xs" disabled={busy !== null || grid.perPage === 0} onClick={() => printLabels([row.original.slug])}>
              <Printer aria-hidden="true" />
              {t("printRow")}
            </Button>
          </span>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the row actions read the current settings through closures rebuilt with them
    [t, preview?.slug, busy, grid.perPage, settings, origin]
  );

  const labelCount = (count: number) => t("labelsAndPages", { count, pages: pageCount(count, grid.perPage) });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
      <div className="flex min-w-0 flex-col gap-3">
        <FilterBar
          label={t("filtersLabel")}
          search={{ value: query, onChange: setQuery, label: t("search"), placeholder: t("searchPlaceholder") }}
          facets={<FacetFilter label={t("filterCategory")} value={category} options={categoryOptions} onChange={setCategory} />}
          shown={visible.length}
          total={rows.length}
          onClear={query || category ? () => (setQuery(""), setCategory(null)) : null}
          activeCount={category ? 1 : 0}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => setSelection(Object.fromEntries(rows.map((row) => [row.slug, true])))}>
            {t("selectAll", { count: rows.length })}
          </Button>
          <Button size="sm" disabled={visible.length === rows.length} onClick={() => setSelection((current) => ({ ...current, ...Object.fromEntries(visible.map((row) => [row.slug, true])) }))}>
            {t("selectFiltered", { count: visible.length })}
          </Button>
          <Button size="sm" variant="ghost" disabled={selectedSlugs.length === 0} onClick={() => setSelection({})}>
            {t("clearSelection")}
          </Button>
        </div>
        <DataTable
          data={visible}
          columns={columns}
          getRowId={(row) => row.slug}
          getRowName={(row) => row.name}
          labels={{ table: t("tableLabel"), selected: (count) => t("selectedCount", { count }), selectAll: t("selectShown") }}
          empty={<EmptyState>{rows.length === 0 ? t("emptyCatalogue") : t("emptyFiltered")}</EmptyState>}
          selectable
          selection={selection}
          onSelectionChange={setSelection}
          onActivate={(row) => setPreviewSlug(row.slug)}
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
              <button type="button" className="min-w-0 flex-1 text-start" onClick={() => setPreviewSlug(row.slug)}>
                <span className="block truncate text-sm font-medium">{row.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{[row.category, content(row).location].filter(Boolean).join(" · ")}</span>
              </button>
              <Button variant="quiet" size="xs" disabled={busy !== null || grid.perPage === 0} onClick={() => printLabels([row.slug])}>
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
                  aria-label={t("previewAlt", { tool: previewContent.name })}
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
                <Button variant="default" size="sm" disabled={busy !== null || grid.perPage === 0} onClick={() => printLabels([preview!.slug])}>
                  <Printer aria-hidden="true" />
                  {t("printThis")}
                </Button>
                <Button
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => run("svg", async () => saveBlob(await labelSvgFile(layout, previewContent, wordmarkHref), qrFileName(preview!.slug, "svg", "label")))}
                >
                  <Download aria-hidden="true" />
                  {t("downloadSvg")}
                </Button>
                <Button
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => run("png", async () => saveBlob(await labelPngFile(layout, previewContent, wordmarkHref), qrFileName(preview!.slug, "png", "label")))}
                >
                  <Download aria-hidden="true" />
                  {t("downloadPng")}
                </Button>
              </div>
            </>
          ) : (
            <EmptyState>{t("emptyCatalogue")}</EmptyState>
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
            <Button variant="default" size="sm" disabled={busy !== null || grid.perPage === 0 || selectedSlugs.length === 0} onClick={() => printLabels(selectedSlugs)}>
              <Printer aria-hidden="true" />
              {t("printSelected", { count: selectedSlugs.length })}
            </Button>
            <Button size="sm" disabled={busy !== null || grid.perPage === 0 || rows.length === 0} onClick={() => printLabels(rows.map((row) => row.slug))}>
              <Printer aria-hidden="true" />
              {t("printAll", { count: rows.length })}
            </Button>
            <Button
              size="sm"
              disabled={busy !== null || grid.perPage === 0 || rows.length === 0}
              onClick={() => downloadPdf(selectedSlugs.length > 0 ? selectedSlugs : rows.map((row) => row.slug))}
            >
              <Download aria-hidden="true" />
              {t("downloadPdf")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {labelCount(selectedSlugs.length > 0 ? selectedSlugs.length : rows.length)} · {t("printHint")}
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

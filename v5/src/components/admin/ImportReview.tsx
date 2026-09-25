"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { ImportActions, RowPatch } from "../../app/admin/intake/imports/action-result";
import type { ColumnMap } from "../../lib/import/columns";
import {
  IMPORT_MAX_ITEMS,
  IMPORT_POLL_INTERVAL_MS,
  IMPORT_RESEARCH_CHUNK,
  IMPORT_VIRTUALIZE_ABOVE,
  parseTooManyItemsReason,
  SUGGEST_MAX_ITEMS,
} from "../../lib/import/limits";
import type { TablePreview } from "../../lib/import/preview";
import { postResearch, queueResearchInChunks, type ChunkProgress, type ResearchPost } from "../../lib/import/research-queue";
import type { ImportItemView, ImportView } from "../../lib/import/view";
import { ADMIN_INTAKE_PATH } from "../../lib/intake/types";
import { ImportMapping } from "./ImportMapping";
import { ImportTable } from "./ImportTable";
import { IMPORT_FILTERS, isLive, researchPlan, visibleRows, type ImportFilter } from "./import-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "../system/EmptyState";
import { FacetFilter } from "../system/data-table/FacetFilter";
import { FilterBar } from "../system/data-table/FilterBar";
import { ReviewNote } from "../system/review/ReviewCard";

/**
 * `/admin/intake/imports/[id]` — one import, as it stands (bulk intake spec
 * §5, §6).
 *
 * - **Choose columns** (`mapping`): the first rows and the suggested matches;
 *   Continue creates the rows.
 * - **Reading your list…** (`parsing`): a model is reading the document; the
 *   page asks again every few seconds.
 * - **Failed**: "No equipment found in this document", with the first lines,
 *   or the reason it could not be read.
 * - **The review table** (`ready`): search, filters (all, duplicates, needs a
 *   name, consumables, suggested, selected), select all shown, inline edits,
 *   bulk category and location, remove, the optional **Suggest names**, and
 *   **Research selected (N)**, sent in groups of 25 with the progress shown and
 *   what did not go said: nothing silently drops.
 *
 * Above 200 rows the table renders the first 200 and adds more as the reader
 * scrolls to the end (amendment "Progressive rendering"). The actions arrive
 * as props and each re-checks its own permission.
 */

export interface ImportReviewProps {
  initialImport: ImportView;
  initialItems: ImportItemView[];
  preview: TablePreview | null;
  /** The first lines of the source, shown when nothing was found in it. */
  sourceHead: string[] | null;
  categories: string[];
  locations: string[];
  actions: ImportActions;
  /** For tests: the research request. */
  post?: ResearchPost;
}

type Message = { tone: "status" | "error" | "warning"; text: string };

/** How long the page keeps asking for suggestions after a Suggest names press. */
const SUGGEST_POLL_MS = 3 * 60_000;

/** When to stop asking for suggestions — read in an event handler, never during render. */
function suggestDeadline(): number {
  return Date.now() + SUGGEST_POLL_MS;
}

export function ImportReview({
  initialImport,
  initialItems,
  preview,
  sourceHead,
  categories,
  locations,
  actions,
  post = postResearch,
}: ImportReviewProps) {
  const t = useTranslations("admin.import");
  const tf = useTranslations("ui.filters");
  const [view, setView] = useState(initialImport);
  const [items, setItems] = useState(initialItems);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState<ImportFilter>("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkLocation, setBulkLocation] = useState("");
  const [shown, setShown] = useState(IMPORT_VIRTUALIZE_ABOVE);
  const [progress, setProgress] = useState<ChunkProgress | null>(null);
  const [suggestUntil, setSuggestUntil] = useState<number | null>(null);

  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const rows = useMemo(() => visibleRows(items, filter, query, selected), [items, filter, query, selected]);
  const plan = useMemo(() => researchPlan(items, selected), [items, selected]);
  const live = items.filter(isLive);
  const locked = busy !== null;

  // Poll while a document is being read, or suggestions are arriving.
  const polling = view.status === "parsing" || suggestUntil !== null;
  const load = actions.load;
  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(async () => {
      try {
        const result = await load({ importId: view.id });
        if (!result.ok) return;
        setView(result.import);
        setItems(result.items);
      } catch {
        // A dropped poll is retried on the next tick.
      }
      if (suggestUntil !== null && Date.now() > suggestUntil) setSuggestUntil(null);
    }, IMPORT_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [polling, load, view.id, suggestUntil]);

  // Progressive rendering: more rows as the end of the table comes into view.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setShown((current) => current + IMPORT_VIRTUALIZE_ABOVE);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [rows.length]);

  function say(...next: Message[]) {
    setMessages(next);
  }

  /** Merge changed rows into the table by id. */
  function merge(changed: ImportItemView[]) {
    if (changed.length === 0) return;
    const fresh = new Map(changed.map((item) => [item.id, item]));
    setItems((current) => current.map((item) => fresh.get(item.id) ?? item));
  }

  async function run<T extends { ok: boolean }>(which: string, call: () => Promise<T>): Promise<T | null> {
    setBusy(which);
    try {
      const result = await call();
      if (!result.ok) {
        const failure = result as unknown as { error: string; remaining?: number };
        say({ tone: "error", text: t(`errors.${failure.error}`, { remaining: failure.remaining ?? 0, limit: 0 }) });
      }
      return result;
    } catch {
      say({ tone: "error", text: t("errors.failed", { remaining: 0, limit: 0 }) });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function confirmColumns(map: ColumnMap) {
    setMappingError(null);
    setBusy("mapping");
    try {
      const result = await actions.confirmColumns({ importId: view.id, columnMap: map });
      if (!result.ok) {
        setMappingError(result.error);
        return;
      }
      setView(result.import);
      setItems(result.items);
    } catch {
      setMappingError("failed");
    } finally {
      setBusy(null);
    }
  }

  async function patch(id: string, rowPatch: RowPatch) {
    const result = await run("row", () => actions.updateRow({ importId: view.id, id, patch: rowPatch }));
    if (result?.ok) {
      merge(result.items);
      say();
    }
  }

  async function mergeRow(sourceId: string, targetId: string) {
    const result = await run("row", () => actions.mergeRow({ importId: view.id, sourceId, targetId }));
    if (result?.ok) {
      merge(result.items);
      say({ tone: "status", text: t("review.merged") });
    }
  }

  async function accept(ids: string[]) {
    if (ids.length === 0) return;
    const result = await run("suggest", () => actions.acceptSuggestions({ importId: view.id, ids }));
    if (result?.ok) {
      merge(result.items);
      say({ tone: "status", text: t("suggestion.accepted", { count: ids.length }) });
    }
  }

  async function ignore(ids: string[]) {
    const result = await run("suggest", () => actions.ignoreSuggestions({ importId: view.id, ids }));
    if (result?.ok) merge(result.items);
  }

  const selectedIds = live.filter((item) => selected.has(item.id)).map((item) => item.id);

  async function setHints(field: "categoryHint" | "locationHint", value: string) {
    if (selectedIds.length === 0) return;
    const result = await run("bulk", () =>
      actions.setHints({ importId: view.id, ids: selectedIds, [field]: value.trim() || null })
    );
    if (result?.ok) {
      merge(result.items);
      say({ tone: "status", text: t("review.bulkSet", { count: result.items.length }) });
    }
  }

  async function removeSelected() {
    if (selectedIds.length === 0) return;
    const result = await run("bulk", () => actions.removeRows({ importId: view.id, ids: selectedIds }));
    if (result?.ok) {
      merge(result.items);
      setSelected(new Set());
      say({ tone: "status", text: t("review.removed", { count: result.items.length }) });
    }
  }

  async function suggestNames() {
    const ids = live.filter((item) => selected.has(item.id) && item.status === "identified").map((item) => item.id);
    if (ids.length === 0) return;
    const result = await run("suggest", () => actions.suggestNames({ importId: view.id, ids: ids.slice(0, SUGGEST_MAX_ITEMS) }));
    if (result?.ok) {
      setSuggestUntil(suggestDeadline());
      say({ tone: "status", text: t("suggestion.started", { count: result.requested }) });
    }
  }

  async function research() {
    const { send, undecided, notResearchable } = plan;
    if (send.length === 0) return;
    setBusy("research");
    setProgress(null);
    try {
      const outcome = await queueResearchInChunks(send, post, { onProgress: setProgress });
      const next: Message[] = [];
      const sent = outcome.queued.length + outcome.readyAsUnit.length;
      next.push({ tone: "status", text: t("outcome.queued", { count: sent }) });
      if (outcome.waiting.length > 0) next.push({ tone: "warning", text: t("outcome.waiting", { count: outcome.waiting.length }) });
      for (const refusal of outcome.refused) {
        next.push({
          tone: "error",
          text: t("outcome.refused", { count: refusal.ids.length, reason: t(`researchErrors.${refusal.code}`) }),
        });
      }
      if (undecided.length > 0) next.push({ tone: "warning", text: t("outcome.undecided", { count: undecided.length }) });
      if (notResearchable.length > 0) next.push({ tone: "warning", text: t("outcome.notResearchable", { count: notResearchable.length }) });
      say(...next);
      setSelected(new Set(outcome.waiting));
      const fresh = await actions.load({ importId: view.id });
      if (fresh.ok) {
        setView(fresh.import);
        setItems(fresh.items);
      }
    } catch {
      say({ tone: "error", text: t("errors.failed", { remaining: 0, limit: 0 }) });
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  const header = (
    <header className="admin-section-head">
      <p className="td-eyebrow">{t("eyebrow")}</p>
      <h2>{view.sourceName ?? t(`source.${view.sourceKind}`)}</h2>
      <p className="admin-lede">
        {view.status === "ready"
          ? t("summary", { items: live.length, duplicates: live.filter((item) => item.duplicateOf !== null).length })
          : t(`status.${view.status}`)}
      </p>
      <p>
        <Link href={ADMIN_INTAKE_PATH}>{t("backToIntake")}</Link>
      </p>
    </header>
  );

  if (view.status === "mapping" && preview) {
    return (
      <section className="admin-section">
        {header}
        <ImportMapping preview={preview} busy={busy === "mapping"} error={mappingError} onConfirm={(map) => void confirmColumns(map)} />
      </section>
    );
  }

  if (view.status === "parsing") {
    return (
      <section className="admin-section">
        {header}
        <ReviewNote role="status" tone="ink">
          {t("parsing")}
        </ReviewNote>
      </section>
    );
  }

  if (view.status === "failed") {
    const reason = view.parseError ?? "failed";
    const tooMany = parseTooManyItemsReason(reason);
    return (
      <section className="admin-section">
        {header}
        <div className="ui flex flex-col gap-2">
          <ReviewNote tone="bad" role="alert" className="text-table">
            {tooMany !== null
              ? t("failed.too_many_items", { count: tooMany, limit: IMPORT_MAX_ITEMS })
              : reason === "no_items" || reason === "start_failed"
                ? t(`failed.${reason}`)
                : t("failed.other", { reason })}
          </ReviewNote>
          {reason === "no_items" && sourceHead && sourceHead.length > 0 ? (
            <>
              <ReviewNote>{t("failed.firstLines")}</ReviewNote>
              <pre className="overflow-x-auto border-s-2 border-s-border bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
                {sourceHead.join("\n")}
              </pre>
            </>
          ) : null}
        </div>
      </section>
    );
  }

  const exact = live.filter((item) => item.nameSuggestion?.confidence === "exact" && item.status === "identified").map((item) => item.id);
  const shownRows = rows.slice(0, Math.max(shown, IMPORT_VIRTUALIZE_ABOVE));
  const narrowed = filter !== "all" || query.trim() !== "";
  // Each "Show" value with how many rows it would leave, given the search.
  const facetValues = IMPORT_FILTERS.filter((name) => name !== "all").map((name) => ({
    value: name,
    label: t(`filter.${name}`),
    count: visibleRows(items, name, query, selected).length,
  }));
  const clearFilters = () => {
    setFilter("all");
    setQuery("");
  };

  return (
    <section className="admin-section">
      {header}

      <div className="ui flex flex-col gap-2">
        <FilterBar
          label={t("review.filterBar")}
          search={{ value: query, onChange: setQuery, label: t("review.search"), placeholder: t("review.search") }}
          facets={
            <FacetFilter
              label={t("review.filterLabel")}
              value={filter === "all" ? null : filter}
              options={facetValues}
              anyLabel={t("filter.all")}
              onChange={(value) => setFilter((value as ImportFilter | null) ?? "all")}
            />
          }
          shown={rows.length}
          total={live.length}
          onClear={narrowed ? clearFilters : null}
          end={
            exact.length > 0 ? (
              <Button size="sm" disabled={locked} onClick={() => void accept(exact)}>
                {t("review.acceptAllExact", { count: exact.length })}
              </Button>
            ) : null
          }
        />
        <ReviewNote>{t("review.researchHint", { size: IMPORT_RESEARCH_CHUNK })}</ReviewNote>

        <div className="flex flex-col gap-1" role="status">
          {busy === "research" && progress ? (
            <ReviewNote tone="ink">
              {t("outcome.progress", { chunk: progress.chunk, chunks: progress.chunks, queued: progress.queued })}
            </ReviewNote>
          ) : null}
          {busy === "research" && !progress ? <ReviewNote tone="ink">{t("outcome.sending")}</ReviewNote> : null}
          {messages.map((message, index) => (
            <ReviewNote key={index} tone={message.tone === "error" ? "bad" : message.tone === "warning" ? "warn" : "ink"}>
              {message.text}
            </ReviewNote>
          ))}
        </div>

        <ImportTable
          rows={shownRows}
          byId={byId}
          selected={selected}
          locked={locked}
          categories={categories}
          locations={locations}
          onSelectionChange={setSelected}
          onPatch={(id, rowPatch) => void patch(id, rowPatch)}
          onMerge={(source, target) => void mergeRow(source, target)}
          onAccept={(ids) => void accept(ids)}
          onIgnore={(ids) => void ignore(ids)}
          empty={
            <EmptyState
              action={
                narrowed ? (
                  <Button variant="ghost" size="sm" onClick={clearFilters}>
                    {tf("clear")}
                  </Button>
                ) : null
              }
            >
              {t("review.emptyFilter")}
            </EmptyState>
          }
          bulkActions={(_ids, clear) => (
            <>
              <span className="flex items-center gap-1">
                <Input
                  list="import-categories"
                  aria-label={t("review.setCategory")}
                  placeholder={t("review.setCategory")}
                  value={bulkCategory}
                  className="h-7 w-36 text-table"
                  onChange={(event) => setBulkCategory(event.target.value)}
                />
                <Button size="sm" disabled={locked || selectedIds.length === 0} onClick={() => void setHints("categoryHint", bulkCategory)}>
                  {t("review.apply")}
                </Button>
              </span>
              <span className="flex items-center gap-1">
                <Input
                  list="import-locations"
                  aria-label={t("review.setLocation")}
                  placeholder={t("review.setLocation")}
                  value={bulkLocation}
                  className="h-7 w-36 text-table"
                  onChange={(event) => setBulkLocation(event.target.value)}
                />
                <Button size="sm" disabled={locked || selectedIds.length === 0} onClick={() => void setHints("locationHint", bulkLocation)}>
                  {t("review.apply")}
                </Button>
              </span>
              <Button variant="destructive" size="sm" disabled={locked || selectedIds.length === 0} onClick={() => void removeSelected()}>
                {t("review.removeSelected")}
              </Button>
              <Button size="sm" disabled={locked || selectedIds.length === 0} onClick={() => void suggestNames()}>
                {t("review.suggestNames")}
              </Button>
              <Button variant="ghost" size="sm" disabled={locked} onClick={clear}>
                {t("review.clearSelection")}
              </Button>
              <Button variant="default" size="sm" disabled={locked || plan.send.length === 0} onClick={() => void research()}>
                {t("review.researchSelected", { count: plan.send.length })}
              </Button>
            </>
          )}
        />
        {shownRows.length < rows.length ? (
          <div ref={sentinel} className="flex justify-center py-2">
            <Button size="sm" onClick={() => setShown((current) => current + IMPORT_VIRTUALIZE_ABOVE)}>
              {t("review.showMore", { count: rows.length - shownRows.length })}
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

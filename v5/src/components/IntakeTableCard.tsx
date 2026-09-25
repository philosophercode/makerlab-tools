"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { RESEARCH_MAX_ITEMS_PER_REQUEST } from "../lib/intake/limits";
import {
  ADMIN_INTAKE_PATH,
  type IntakeTablePayload,
  type PatchPendingToolBody,
  type PendingApiErrorCode,
  type PendingToolResponse,
  type PendingToolView,
  type ResearchStartedResponse,
} from "../lib/intake/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { DataTable } from "./system/data-table/DataTable";
import { StatusGlyph } from "./system/StatusGlyph";
import { DuplicateChoice } from "./system/review/DuplicateChoice";
import { ReviewNote } from "./system/review/ReviewCard";
import { PENDING_STATUS_TONE } from "./admin/pending-status-tone";

/**
 * The intake table card (data platform spec §5.4 step 5, §6): what the chat
 * shows after `identify_tools`, one editable row per pending item.
 *
 * Everything on it goes to a route, never back through the model, so fixing a
 * typo costs no tokens: an edit, a removal or a duplicate decision is a
 * `PATCH /api/pending-tools/[id]`, and **Research selected** is a
 * `POST /api/pending-tools/research` with exactly the ticked ids. The card then
 * points at `/admin/intake`, where the results land.
 *
 * It follows `use-row-action`'s honesty rules without its optimism, because a
 * row here changes shape on a save (a rename can create or clear a duplicate):
 *
 * - **A success keeps**, and the row is replaced by the item the route answered
 *   with, so the card shows what the database holds rather than what was typed.
 * - **A refusal restores**: the row is left as it was and says why, and an edit
 *   in progress stays open so nobody loses their typing.
 * - **No `useTransition`** around the fetches — the awaited answer is the
 *   confirmation (see `use-row-action.ts`).
 *
 * Since UI system phase 3 the table is the shared `DataTable` (selection with
 * rows that cannot be selected, a header box over the rows shown) in
 * **container** layout: the chat panel is 360–440px wide on any screen, so the
 * card's own width — not the viewport's — decides between the table and the
 * two-line list. A duplicate is decided with the shared `DuplicateChoice`.
 * Each row's edit state lives here, keyed by id, because a row's cells are
 * separate render functions (DataTable's rule: hooks live in components).
 *
 * Refusals render `intake.table.errors.<code>`; the route's English `error` is
 * never shown (Article 6).
 */

const ERROR_CODES: readonly PendingApiErrorCode[] = [
  "invalid_body",
  "sign_in_required",
  "forbidden",
  "not_found",
  "not_editable",
  "invalid_field",
  "rate_limited",
  "too_many_items",
  "daily_limit",
  "unresolved_duplicate",
  "not_researchable",
  "start_failed",
  "failed",
];

interface Refusal {
  code: PendingApiErrorCode;
  remaining?: number;
}

type Outcome<T> = { ok: true; value: T } | { ok: false; refusal: Refusal };

function toCode(value: unknown): PendingApiErrorCode {
  return ERROR_CODES.includes(value as PendingApiErrorCode) ? (value as PendingApiErrorCode) : "failed";
}

/** One JSON request, answered as a value. A dropped connection is `failed`. */
async function send<T>(url: string, method: "PATCH" | "POST", body: unknown): Promise<Outcome<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (res.ok && json) return { ok: true, value: json as T };
    return {
      ok: false,
      refusal: {
        code: toCode(json?.code),
        remaining: typeof json?.remaining === "number" ? json.remaining : undefined,
      },
    };
  } catch {
    return { ok: false, refusal: { code: "failed" } };
  }
}

/** Matched something, and nobody has said what to do about it yet. */
function isUnresolved(row: PendingToolView): boolean {
  return row.duplicateOf !== null && row.duplicateResolution === null;
}

function isGone(row: PendingToolView): boolean {
  return row.status === "discarded" || row.duplicateResolution === "discard";
}

type T = ReturnType<typeof useTranslations<"intake">>;

/** Values every error string may use; next-intl ignores the ones it does not. */
function errorText(t: T, refusal: Refusal): string {
  return t(`table.errors.${refusal.code}`, {
    max: RESEARCH_MAX_ITEMS_PER_REQUEST,
    remaining: refusal.remaining ?? 0,
  });
}

type Research =
  | { phase: "idle" }
  | { phase: "starting"; ids: string[] }
  | { phase: "started"; ids: string[]; response: ResearchStartedResponse }
  | { phase: "refused"; ids: string[]; refusal: Refusal };

interface Draft {
  name: string;
  brand: string;
  category: string;
}

function draftOf(row: PendingToolView): Draft {
  return { name: row.name, brand: row.brand ?? "", category: row.categoryHint ?? "" };
}

/** Why a row's box is disabled: the id of its duplicate's reason line. */
function reasonId(row: PendingToolView): string {
  return `intake-row-${row.id}-duplicate`;
}

export interface IntakeTableCardProps {
  payload: IntakeTablePayload;
}

export function IntakeTableCard({ payload }: IntakeTableCardProps) {
  const t = useTranslations("intake");
  const [rows, setRows] = useState<PendingToolView[]>(() => payload.items.filter((row) => !isGone(row)));
  // Every row that can be researched starts ticked (§5.4 step 5).
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(payload.items.filter((row) => !isGone(row) && !isUnresolved(row)).map((row) => row.id))
  );
  /** Rows being edited: the typing so far. */
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  /** Rows choosing "Add as another unit": the serial being typed. */
  const [serials, setSerials] = useState<Record<string, string>>({});
  /** Each row's last refusal, shown beside it. */
  const [refusals, setRefusals] = useState<Record<string, Refusal>>({});
  const [saving, setSaving] = useState<Set<string>>(() => new Set());
  const [research, setResearch] = useState<Research>({ phase: "idle" });

  const eligibleIds = rows.filter((row) => !isUnresolved(row)).map((row) => row.id);
  const selectedIds = eligibleIds.filter((id) => selected.has(id));

  // Once research has been asked for, the rows belong to it: a queued item
  // refuses edits anyway, and a start that failed is retried with the same ids.
  const locked =
    research.phase === "starting" ||
    research.phase === "started" ||
    (research.phase === "refused" && research.refusal.code === "start_failed");
  const editing = Object.keys(drafts).length + Object.keys(serials).length;
  const busy = editing > 0 || saving.size > 0;

  function without<V>(record: Record<string, V>, id: string): Record<string, V> {
    const next = { ...record };
    delete next[id];
    return next;
  }

  function setSavingFor(id: string, on: boolean) {
    setSaving((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  /** PATCH one row; on success take the route's answer as the row. */
  async function patch(row: PendingToolView, body: PatchPendingToolBody): Promise<Refusal | null> {
    setSavingFor(row.id, true);
    const outcome = await send<PendingToolResponse>(`/api/pending-tools/${encodeURIComponent(row.id)}`, "PATCH", body);
    setSavingFor(row.id, false);
    if (!outcome.ok) return outcome.refusal;

    const item = outcome.value.item;
    if (isGone(item)) {
      setRows((prev) => prev.filter((r) => r.id !== item.id));
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      return null;
    }
    setRows((prev) => prev.map((r) => (r.id === item.id ? item : r)));
    setSelected((prev) => {
      const next = new Set(prev);
      // A decision on a duplicate is a decision to keep it; a rename that
      // turned up a new match takes the row out until that is decided too.
      if (isUnresolved(item)) next.delete(item.id);
      else if (isUnresolved(row)) next.add(item.id);
      return next;
    });
    return null;
  }

  function open(id: string, start: () => void) {
    setRefusals((prev) => without(prev, id));
    start();
  }

  function close(id: string) {
    setDrafts((prev) => without(prev, id));
    setSerials((prev) => without(prev, id));
  }

  /** Send, and close the editor only on a success; a refusal keeps the typing. */
  async function commit(row: PendingToolView, body: PatchPendingToolBody, closeOnSuccess: boolean) {
    setRefusals((prev) => without(prev, row.id));
    const refusal = await patch(row, body);
    if (refusal) {
      setRefusals((prev) => ({ ...prev, [row.id]: refusal }));
      return;
    }
    if (closeOnSuccess) close(row.id);
  }

  async function save(row: PendingToolView) {
    const draft = drafts[row.id];
    if (!draft) return;
    // Only what changed: a patch carrying every field would overwrite an
    // edit made elsewhere since this card rendered.
    const body: PatchPendingToolBody = {};
    const name = draft.name.trim();
    const brand = draft.brand.trim() || null;
    const category = draft.category.trim() || null;
    if (name !== row.name) body.name = name;
    if (brand !== row.brand) body.brand = brand;
    if (category !== row.categoryHint) body.categoryHint = category;
    if (Object.keys(body).length === 0) {
      close(row.id);
      return;
    }
    await commit(row, body, true);
  }

  async function addAsUnit(row: PendingToolView) {
    const value = serials[row.id]?.trim() ?? "";
    await commit(row, { duplicateResolution: "add_unit", ...(value ? { serialNumber: value } : {}) }, true);
  }

  async function startResearch(ids: string[]) {
    setResearch({ phase: "starting", ids });
    const outcome = await send<ResearchStartedResponse>("/api/pending-tools/research", "POST", { ids });
    if (!outcome.ok) {
      setResearch({ phase: "refused", ids, refusal: outcome.refusal });
      return;
    }
    const response = outcome.value;
    const queued = new Set(response.queued);
    const ready = new Set(response.readyAsUnit);
    setRows((prev) =>
      prev.map((row) =>
        queued.has(row.id) ? { ...row, status: "queued" } : ready.has(row.id) ? { ...row, status: "researched" } : row
      )
    );
    setResearch({ phase: "started", ids, response });
  }

  const sentIds = research.phase === "idle" ? [] : research.ids;
  const waiting = rows.filter((row) => !sentIds.includes(row.id)).length;

  /** Everything one row's parts need. */
  function partsOf(row: PendingToolView): RowParts {
    const serial = serials[row.id];
    return {
      row,
      t,
      draft: drafts[row.id] ?? null,
      serial: serial ?? null,
      refusal: refusals[row.id] ?? null,
      saving: saving.has(row.id),
      disabled: locked || saving.has(row.id),
      onDraft: (draft) => setDrafts((prev) => ({ ...prev, [row.id]: draft })),
      onEdit: () => open(row.id, () => setDrafts((prev) => ({ ...prev, [row.id]: draftOf(row) }))),
      onCancel: () => close(row.id),
      onSave: () => void save(row),
      onRemove: () => void commit(row, { discard: true }, false),
      onSerial: (value) => setSerials((prev) => ({ ...prev, [row.id]: value })),
      onChooseUnit: () => open(row.id, () => setSerials((prev) => ({ ...prev, [row.id]: "" }))),
      onAddUnit: () => void addAsUnit(row),
      onDifferentTool: () => void commit(row, { duplicateResolution: "new_tool" }, false),
    };
  }

  const columns: ColumnDef<PendingToolView, unknown>[] = [
    {
      id: "photo",
      header: t("table.columnPhoto"),
      enableSorting: false,
      meta: { cellClassName: "align-top", className: "w-14" },
      cell: ({ row }) => <RowPhoto row={row.original} t={t} />,
    },
    {
      id: "name",
      accessorFn: (row) => row.name,
      header: t("table.columnName"),
      enableSorting: false,
      meta: { rowHeader: true, cellClassName: "align-top whitespace-normal" },
      cell: ({ row }) => <RowName parts={partsOf(row.original)} />,
    },
    {
      id: "brand",
      header: t("table.columnBrand"),
      enableSorting: false,
      meta: { cellClassName: "align-top whitespace-normal" },
      cell: ({ row }) => <RowText parts={partsOf(row.original)} field="brand" />,
    },
    {
      id: "category",
      header: t("table.columnCategory"),
      enableSorting: false,
      meta: { cellClassName: "align-top whitespace-normal" },
      cell: ({ row }) => <RowText parts={partsOf(row.original)} field="category" />,
    },
    {
      id: "duplicate",
      header: t("table.columnDuplicate"),
      enableSorting: false,
      meta: { cellClassName: "align-top whitespace-normal min-w-48" },
      cell: ({ row }) => <RowDuplicate parts={partsOf(row.original)} />,
    },
    {
      id: "actions",
      header: () => <span className="sr-only">{t("table.edit")}</span>,
      enableSorting: false,
      meta: { cellClassName: "align-top whitespace-normal" },
      cell: ({ row }) => <RowActions parts={partsOf(row.original)} />,
    },
  ];

  const selection: RowSelectionState = Object.fromEntries(selectedIds.map((id) => [id, true]));

  return (
    <section
      aria-label={t("table.label")}
      className="ui mt-2 flex flex-col gap-3 border-t border-rule pt-2 text-table first:mt-0"
    >
      <ReviewNote>{t("table.lede")}</ReviewNote>

      {payload.warnings.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {payload.warnings.map((warning) => (
            <li key={warning}>
              <ReviewNote tone="bad">{t(`table.warnings.${warning}`)}</ReviewNote>
            </li>
          ))}
        </ul>
      ) : null}

      <DataTable
        data={rows}
        columns={columns}
        getRowId={(row) => row.id}
        getRowName={(row) => row.name}
        labels={{ table: t("table.label"), selectAll: t("table.selectAllAria") }}
        empty={null}
        selectable
        alignTop
        canSelectRow={(row) => !locked && !isUnresolved(row) && !saving.has(row.id)}
        selectDescribedBy={(row) => (isUnresolved(row) ? reasonId(row) : undefined)}
        selection={selection}
        onSelectionChange={(next) => setSelected(new Set(Object.keys(next).filter((id) => next[id])))}
        mobileRow={(row, state) => <MobileRow parts={partsOf(row)} selected={state.selected} canSelect={state.canSelect} onToggle={state.toggle} />}
        layout="container"
        listSelectAll={t("table.selectAllVisible")}
        keyboardHint={false}
        stickyHeader={false}
      />

      <div className="flex flex-col gap-2" aria-live="polite">
        {research.phase === "started" ? (
          <StartedNote t={t} response={research.response} waiting={waiting} />
        ) : (
          <>
            {research.phase === "refused" ? (
              <ReviewNote tone="bad" role="alert">
                {errorText(t, research.refusal)}
              </ReviewNote>
            ) : null}
            {research.phase === "refused" && research.refusal.code === "start_failed" ? (
              <Button variant="default" className="self-start" onClick={() => startResearch(research.ids)}>
                {t("table.retry")}
              </Button>
            ) : (
              <Button
                variant="default"
                className="self-start"
                disabled={selectedIds.length === 0 || busy || locked}
                onClick={() => startResearch(selectedIds)}
              >
                {research.phase === "starting" ? t("table.starting") : t("table.researchSelected", { count: selectedIds.length })}
              </Button>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function StartedNote({ t, response, waiting }: { t: T; response: ResearchStartedResponse; waiting: number }) {
  const queued = response.queued.length;
  const ready = response.readyAsUnit.length;
  return (
    <div className="flex flex-col gap-1">
      {queued > 0 ? <ReviewNote tone="ink">{t("table.started", { count: queued })}</ReviewNote> : null}
      {ready > 0 ? <ReviewNote tone="ink">{t("table.readyAsUnit", { count: ready })}</ReviewNote> : null}
      {queued === 0 && ready === 0 ? <ReviewNote tone="ink">{t("table.startedNothingQueued")}</ReviewNote> : null}
      {waiting > 0 ? <ReviewNote>{t("table.unselectedWait", { count: waiting })}</ReviewNote> : null}
      <Button asChild variant="link" size="sm" className="self-start">
        <Link href={ADMIN_INTAKE_PATH}>{t("table.openIntake")}</Link>
      </Button>
    </div>
  );
}

// ── One row's parts ─────────────────────────────────────────────────
// Rendered as the table's cells and, in a narrow card, stacked in the list.

interface RowParts {
  row: PendingToolView;
  t: T;
  draft: Draft | null;
  serial: string | null;
  refusal: Refusal | null;
  saving: boolean;
  /** Locked by research, or this row is saving. */
  disabled: boolean;
  onDraft: (draft: Draft) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  onRemove: () => void;
  onSerial: (value: string) => void;
  onChooseUnit: () => void;
  onAddUnit: () => void;
  onDifferentTool: () => void;
}

function RowPhoto({ row, t }: { row: PendingToolView; t: T }) {
  const [cover, ...more] = row.photos;
  const frame = "flex size-12 items-center justify-center overflow-hidden border border-border bg-muted p-0.5 text-center text-[9px] leading-tight break-all text-muted-foreground";
  return (
    <div className="flex flex-col gap-0.5">
      {cover ? (
        cover.url ? (
          // eslint-disable-next-line @next/next/no-img-element -- a Blob URL at a random pathname; nothing for the optimizer to gain in a chat card
          <img src={cover.url} alt={t("table.photoAlt", { name: row.name })} className="size-12 border border-border object-cover" />
        ) : (
          <span className={frame}>
            {cover.filename ? t("table.photoNotShown", { filename: cover.filename }) : t("table.photoNotShownUnnamed")}
          </span>
        )
      ) : (
        <span className={frame}>{t("table.noPhoto")}</span>
      )}
      {more.length > 0 ? (
        <span className="font-mono text-micro text-muted-foreground">{t("table.morePhotos", { count: more.length })}</span>
      ) : null}
    </div>
  );
}

function RowName({ parts }: { parts: RowParts }) {
  const { row, t, draft, saving } = parts;
  if (draft) {
    return (
      <Input
        aria-label={t("table.fieldName")}
        value={draft.name}
        maxLength={200}
        disabled={saving}
        className="h-7 text-table"
        onChange={(e) => parts.onDraft({ ...draft, name: e.target.value })}
      />
    );
  }
  return (
    <span className="flex flex-col gap-1">
      <span className="font-medium">{row.name}</span>
      {row.status !== "identified" ? (
        <StatusGlyph tone={PENDING_STATUS_TONE[row.status]} label={parts.t(`status.${row.status}`)} />
      ) : null}
    </span>
  );
}

function RowText({ parts, field }: { parts: RowParts; field: "brand" | "category" }) {
  const { row, t, draft, saving } = parts;
  const value = field === "brand" ? row.brand : row.categoryHint;
  if (draft) {
    return (
      <Input
        aria-label={t(field === "brand" ? "table.fieldBrand" : "table.fieldCategory")}
        value={draft[field]}
        maxLength={200}
        disabled={saving}
        className="h-7 text-table"
        onChange={(e) => parts.onDraft({ ...draft, [field]: e.target.value })}
      />
    );
  }
  return value ? <>{value}</> : <span className="text-muted-foreground">{t("table.notSet")}</span>;
}

function RowDuplicate({ parts }: { parts: RowParts }) {
  const { row, t, draft, serial, disabled } = parts;
  const match = row.duplicateOf;
  if (!match) return <span className="text-muted-foreground">{t("table.notSet")}</span>;

  const sentence: ReactNode =
    match.kind === "tool"
      ? t.rich("table.duplicateOfTool", {
          name: match.name,
          link: (chunks) => (
            <Link href={`/tools/${match.slug}`} className="text-primary-ink underline underline-offset-2">
              {chunks}
            </Link>
          ),
        })
      : t("table.duplicateOfPending", { name: match.name });

  const resolved =
    row.duplicateResolution === "add_unit"
      ? t("table.resolvedAddUnit", { name: match.name })
      : row.duplicateResolution === "new_tool"
        ? t("table.resolvedNewTool")
        : null;

  const serialId = `intake-row-${row.id}-serial`;
  return (
    <DuplicateChoice
      label={t("table.columnDuplicate")}
      match={sentence}
      // Only a tool can take another unit; a pending item has none yet.
      options={[
        ...(match.kind === "tool" ? [{ value: "add_unit" as const, label: t("table.addAsUnit") }] : []),
        { value: "new_tool" as const, label: t("table.differentTool") },
      ]}
      value={serial !== null ? "add_unit" : null}
      disabled={disabled || draft !== null || serial !== null}
      resolved={resolved}
      onChoose={(value) => (value === "add_unit" ? parts.onChooseUnit() : parts.onDifferentTool())}
    >
      {resolved ? null : serial !== null ? (
        <div className="flex flex-col gap-1">
          <label htmlFor={serialId} className="font-mono text-micro tracking-[0.08em] text-muted-foreground uppercase">
            {t("table.serialLabel")}
          </label>
          <Input
            id={serialId}
            value={serial}
            maxLength={200}
            aria-describedby={`${serialId}-hint`}
            className="h-7 text-table"
            onChange={(e) => parts.onSerial(e.target.value)}
          />
          <span id={`${serialId}-hint`} className="text-xs text-muted-foreground">
            {t("table.serialHint")}
          </span>
          <span className="flex flex-wrap gap-1">
            <Button variant="default" size="xs" disabled={disabled} onClick={parts.onAddUnit}>
              {t("table.confirmAddUnit")}
            </Button>
            <Button size="xs" disabled={disabled} onClick={parts.onCancel}>
              {t("table.cancel")}
            </Button>
          </span>
        </div>
      ) : (
        <p id={reasonId(row)} className="text-xs text-muted-foreground">
          {t("table.duplicateChoose")}
        </p>
      )}
    </DuplicateChoice>
  );
}

function RowActions({ parts }: { parts: RowParts }) {
  const { row, t, draft, serial, saving, disabled, refusal } = parts;
  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex flex-wrap gap-1">
        {draft ? (
          <>
            <Button variant="default" size="xs" disabled={saving || draft.name.trim() === ""} onClick={parts.onSave}>
              {saving ? t("table.saving") : t("table.save")}
            </Button>
            <Button size="xs" disabled={saving} onClick={parts.onCancel}>
              {t("table.cancel")}
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              size="xs"
              aria-label={t("table.editAria", { name: row.name })}
              disabled={disabled || serial !== null}
              onClick={parts.onEdit}
            >
              {t("table.edit")}
            </Button>
            <Button
              variant="destructive"
              size="xs"
              aria-label={t("table.removeAria", { name: row.name })}
              disabled={disabled || serial !== null}
              onClick={parts.onRemove}
            >
              {t("table.remove")}
            </Button>
          </>
        )}
      </div>
      {refusal ? (
        <ReviewNote tone="bad" role="alert">
          {errorText(t, refusal)}
        </ReviewNote>
      ) : null}
    </div>
  );
}

/** The narrow card's list item: the same parts, stacked, the box first. */
function MobileRow({
  parts,
  selected,
  canSelect,
  onToggle,
}: {
  parts: RowParts;
  selected: boolean;
  canSelect: boolean;
  onToggle: () => void;
}) {
  const { row, t, draft } = parts;
  const unresolved = isUnresolved(row);
  return (
    <div className="flex flex-col gap-2 py-2">
      <div className="flex items-start gap-2">
        <Checkbox
          className="mt-1"
          aria-label={t("table.selectRowAria", { name: row.name })}
          aria-describedby={unresolved ? reasonId(row) : undefined}
          checked={selected}
          disabled={!canSelect}
          onCheckedChange={onToggle}
        />
        <RowPhoto row={row} t={t} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <RowName parts={parts} />
          {draft ? (
            <>
              <RowText parts={parts} field="brand" />
              <RowText parts={parts} field="category" />
            </>
          ) : (
            <span className="text-muted-foreground">
              {[row.brand, row.categoryHint].filter(Boolean).join(" · ") || t("table.notSet")}
            </span>
          )}
        </div>
      </div>
      {row.duplicateOf ? <RowDuplicate parts={parts} /> : null}
      <RowActions parts={parts} />
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
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
import "../styles/intake-table.css";

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

export interface IntakeTableCardProps {
  payload: IntakeTablePayload;
}

export function IntakeTableCard({ payload }: IntakeTableCardProps) {
  const t = useTranslations("intake");
  const [rows, setRows] = useState<PendingToolView[]>(() =>
    payload.items.filter((row) => !isGone(row))
  );
  // Every row that can be researched starts ticked (§5.4 step 5).
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(payload.items.filter((row) => !isGone(row) && !isUnresolved(row)).map((row) => row.id))
  );
  const [editing, setEditing] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState<Set<string>>(() => new Set());
  const [research, setResearch] = useState<Research>({ phase: "idle" });

  const eligibleIds = rows.filter((row) => !isUnresolved(row)).map((row) => row.id);
  const selectedIds = eligibleIds.filter((id) => selected.has(id));
  const allSelected = eligibleIds.length > 0 && selectedIds.length === eligibleIds.length;
  const someSelected = selectedIds.length > 0 && !allSelected;

  // Once research has been asked for, the rows belong to it: a queued item
  // refuses edits anyway, and a start that failed is retried with the same ids.
  const locked =
    research.phase === "starting" ||
    research.phase === "started" ||
    (research.phase === "refused" && research.refusal.code === "start_failed");
  const busy = editing.size > 0 || saving.size > 0;

  const headerBox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headerBox.current) headerBox.current.indeterminate = someSelected;
  }, [someSelected]);

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(eligibleIds));
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setIn(setter: typeof setEditing, id: string, on: boolean) {
    setter((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  /** PATCH one row; on success take the route's answer as the row. */
  async function patch(row: PendingToolView, body: PatchPendingToolBody): Promise<Refusal | null> {
    setIn(setSaving, row.id, true);
    const outcome = await send<PendingToolResponse>(
      `/api/pending-tools/${encodeURIComponent(row.id)}`,
      "PATCH",
      body
    );
    setIn(setSaving, row.id, false);
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
        queued.has(row.id)
          ? { ...row, status: "queued" }
          : ready.has(row.id)
            ? { ...row, status: "researched" }
            : row
      )
    );
    setResearch({ phase: "started", ids, response });
  }

  const sentIds = research.phase === "idle" ? [] : research.ids;
  const waiting = rows.filter((row) => !sentIds.includes(row.id)).length;

  return (
    <section className="intake-card" aria-label={t("table.label")}>
      <p className="intake-card-lede">{t("table.lede")}</p>

      {payload.warnings.length > 0 ? (
        <ul className="intake-card-warnings">
          {payload.warnings.map((warning) => (
            <li key={warning}>{t(`table.warnings.${warning}`)}</li>
          ))}
        </ul>
      ) : null}

      <div className="intake-table-wrap">
        <table className="intake-table">
          <thead>
            <tr>
              <th scope="col" className="intake-col-select">
                <input
                  ref={headerBox}
                  type="checkbox"
                  aria-label={t("table.selectAllAria")}
                  checked={allSelected}
                  disabled={locked || eligibleIds.length === 0}
                  onChange={toggleAll}
                />
              </th>
              <th scope="col">{t("table.columnPhoto")}</th>
              <th scope="col">{t("table.columnName")}</th>
              <th scope="col">{t("table.columnBrand")}</th>
              <th scope="col">{t("table.columnCategory")}</th>
              <th scope="col">{t("table.columnDuplicate")}</th>
              <th scope="col">
                <span className="intake-visually-hidden">{t("table.edit")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <IntakeRow
                key={row.id}
                row={row}
                t={t}
                selected={selected.has(row.id)}
                locked={locked}
                saving={saving.has(row.id)}
                onToggle={() => toggle(row.id)}
                onEditingChange={(on) => setIn(setEditing, row.id, on)}
                onPatch={(body) => patch(row, body)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="intake-card-footer" aria-live="polite">
        {research.phase === "started" ? (
          <StartedNote t={t} response={research.response} waiting={waiting} />
        ) : (
          <>
            {research.phase === "refused" ? (
              <p className="intake-card-error" role="alert">
                {errorText(t, research.refusal)}
              </p>
            ) : null}
            {research.phase === "refused" && research.refusal.code === "start_failed" ? (
              <button
                type="button"
                className="intake-button intake-button-primary"
                onClick={() => startResearch(research.ids)}
              >
                {t("table.retry")}
              </button>
            ) : (
              <button
                type="button"
                className="intake-button intake-button-primary"
                disabled={selectedIds.length === 0 || busy || locked}
                onClick={() => startResearch(selectedIds)}
              >
                {research.phase === "starting"
                  ? t("table.starting")
                  : t("table.researchSelected", { count: selectedIds.length })}
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function StartedNote({
  t,
  response,
  waiting,
}: {
  t: T;
  response: ResearchStartedResponse;
  waiting: number;
}) {
  const queued = response.queued.length;
  const ready = response.readyAsUnit.length;
  return (
    <div className="intake-card-started">
      {queued > 0 ? <p>{t("table.started", { count: queued })}</p> : null}
      {ready > 0 ? <p>{t("table.readyAsUnit", { count: ready })}</p> : null}
      {queued === 0 && ready === 0 ? <p>{t("table.startedNothingQueued")}</p> : null}
      {waiting > 0 ? <p>{t("table.unselectedWait", { count: waiting })}</p> : null}
      <Link href={ADMIN_INTAKE_PATH} className="intake-card-link">
        {t("table.openIntake")}
      </Link>
    </div>
  );
}

// ── One row ────────────────────────────────────────────────────────

interface IntakeRowProps {
  row: PendingToolView;
  t: T;
  selected: boolean;
  locked: boolean;
  saving: boolean;
  onToggle: () => void;
  onEditingChange: (editing: boolean) => void;
  onPatch: (body: PatchPendingToolBody) => Promise<Refusal | null>;
}

interface Draft {
  name: string;
  brand: string;
  category: string;
}

function draftOf(row: PendingToolView): Draft {
  return { name: row.name, brand: row.brand ?? "", category: row.categoryHint ?? "" };
}

function IntakeRow({ row, t, selected, locked, saving, onToggle, onEditingChange, onPatch }: IntakeRowProps) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [serial, setSerial] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  const unresolved = isUnresolved(row);
  const reasonId = `intake-row-${row.id}-duplicate`;
  const disabled = locked || saving;

  function open(next: () => void) {
    setRefusal(null);
    next();
    onEditingChange(true);
  }

  function close() {
    setDraft(null);
    setSerial(null);
    onEditingChange(false);
  }

  /** Send, and close the editor only on a success; a refusal keeps the typing. */
  async function commit(body: PatchPendingToolBody, closeOnSuccess: boolean) {
    setRefusal(null);
    const result = await onPatch(body);
    if (result) {
      setRefusal(result);
      return;
    }
    if (closeOnSuccess) close();
  }

  async function save() {
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
      close();
      return;
    }
    await commit(body, true);
  }

  async function addAsUnit() {
    const value = serial?.trim() ?? "";
    await commit(
      { duplicateResolution: "add_unit", ...(value ? { serialNumber: value } : {}) },
      true
    );
  }

  const [cover, ...more] = row.photos;

  return (
    <tr className={`intake-row${unresolved ? " is-unresolved" : ""}`}>
      <td className="intake-cell-select" data-label={t("table.columnSelect")}>
        <input
          type="checkbox"
          aria-label={t("table.selectRowAria", { name: row.name })}
          aria-describedby={unresolved ? reasonId : undefined}
          checked={selected && !unresolved}
          disabled={disabled || unresolved}
          onChange={onToggle}
        />
      </td>

      <td className="intake-cell-photo" data-label={t("table.columnPhoto")}>
        {cover ? (
          cover.url ? (
            // eslint-disable-next-line @next/next/no-img-element -- a Blob URL at a random pathname; nothing for the optimizer to gain in a chat card
            <img src={cover.url} alt={t("table.photoAlt", { name: row.name })} />
          ) : (
            <span className="intake-photo-placeholder">
              {cover.filename
                ? t("table.photoNotShown", { filename: cover.filename })
                : t("table.photoNotShownUnnamed")}
            </span>
          )
        ) : (
          <span className="intake-photo-placeholder">{t("table.noPhoto")}</span>
        )}
        {more.length > 0 ? (
          <span className="intake-photo-more">{t("table.morePhotos", { count: more.length })}</span>
        ) : null}
      </td>

      <td className="intake-cell-name" data-label={t("table.columnName")}>
        {draft ? (
          <input
            className="intake-input"
            aria-label={t("table.fieldName")}
            value={draft.name}
            maxLength={200}
            disabled={saving}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        ) : (
          <>
            <span className="intake-name">{row.name}</span>
            {row.status !== "identified" ? (
              <span className="intake-status">{t(`status.${row.status}`)}</span>
            ) : null}
          </>
        )}
      </td>

      <td data-label={t("table.columnBrand")}>
        {draft ? (
          <input
            className="intake-input"
            aria-label={t("table.fieldBrand")}
            value={draft.brand}
            maxLength={200}
            disabled={saving}
            onChange={(e) => setDraft({ ...draft, brand: e.target.value })}
          />
        ) : (
          row.brand ?? <span className="intake-muted">{t("table.notSet")}</span>
        )}
      </td>

      <td data-label={t("table.columnCategory")}>
        {draft ? (
          <input
            className="intake-input"
            aria-label={t("table.fieldCategory")}
            value={draft.category}
            maxLength={200}
            disabled={saving}
            onChange={(e) => setDraft({ ...draft, category: e.target.value })}
          />
        ) : (
          row.categoryHint ?? <span className="intake-muted">{t("table.notSet")}</span>
        )}
      </td>

      <td className="intake-cell-duplicate" data-label={t("table.columnDuplicate")}>
        {row.duplicateOf ? (
          <DuplicateCell
            row={row}
            t={t}
            reasonId={reasonId}
            disabled={disabled || draft !== null}
            serial={serial}
            onSerialChange={setSerial}
            onChooseUnit={() => open(() => setSerial(""))}
            onCancelUnit={close}
            onAddUnit={addAsUnit}
            onDifferentTool={() => commit({ duplicateResolution: "new_tool" }, false)}
          />
        ) : (
          <span className="intake-muted">{t("table.notSet")}</span>
        )}
      </td>

      <td className="intake-cell-actions">
        {draft ? (
          <>
            <button
              type="button"
              className="intake-button intake-button-primary"
              disabled={saving || draft.name.trim() === ""}
              onClick={save}
            >
              {saving ? t("table.saving") : t("table.save")}
            </button>
            <button type="button" className="intake-button" disabled={saving} onClick={close}>
              {t("table.cancel")}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="intake-button"
              aria-label={t("table.editAria", { name: row.name })}
              disabled={disabled || serial !== null}
              onClick={() => open(() => setDraft(draftOf(row)))}
            >
              {t("table.edit")}
            </button>
            <button
              type="button"
              className="intake-button intake-button-danger"
              aria-label={t("table.removeAria", { name: row.name })}
              disabled={disabled || serial !== null}
              onClick={() => commit({ discard: true }, false)}
            >
              {t("table.remove")}
            </button>
          </>
        )}
        {refusal ? (
          <p className="intake-row-error" role="alert">
            {errorText(t, refusal)}
          </p>
        ) : null}
      </td>
    </tr>
  );
}

interface DuplicateCellProps {
  row: PendingToolView;
  t: T;
  reasonId: string;
  disabled: boolean;
  /** Null until "Add as another unit" is chosen; then the serial being typed. */
  serial: string | null;
  onSerialChange: (value: string) => void;
  onChooseUnit: () => void;
  onCancelUnit: () => void;
  onAddUnit: () => void;
  onDifferentTool: () => void;
}

function DuplicateCell({
  row,
  t,
  reasonId,
  disabled,
  serial,
  onSerialChange,
  onChooseUnit,
  onCancelUnit,
  onAddUnit,
  onDifferentTool,
}: DuplicateCellProps) {
  const match = row.duplicateOf;
  if (!match) return null;

  const badge =
    match.kind === "tool" ? (
      <span className="intake-badge">
        {t.rich("table.duplicateOfTool", {
          name: match.name,
          link: (chunks) => (
            <Link href={`/tools/${match.slug}`} className="intake-card-link">
              {chunks}
            </Link>
          ),
        })}
      </span>
    ) : (
      <span className="intake-badge">{t("table.duplicateOfPending", { name: match.name })}</span>
    );

  if (row.duplicateResolution === "add_unit") {
    return (
      <>
        {badge}
        <span className="intake-resolved">{t("table.resolvedAddUnit", { name: match.name })}</span>
      </>
    );
  }
  if (row.duplicateResolution === "new_tool") {
    return (
      <>
        {badge}
        <span className="intake-resolved">{t("table.resolvedNewTool")}</span>
      </>
    );
  }

  if (serial !== null) {
    const serialId = `intake-row-${row.id}-serial`;
    return (
      <>
        {badge}
        <label className="intake-serial" htmlFor={serialId}>
          {t("table.serialLabel")}
        </label>
        <input
          id={serialId}
          className="intake-input"
          value={serial}
          maxLength={200}
          aria-describedby={`${serialId}-hint`}
          onChange={(e) => onSerialChange(e.target.value)}
        />
        <span id={`${serialId}-hint`} className="intake-muted">
          {t("table.serialHint")}
        </span>
        <span className="intake-choices">
          <button type="button" className="intake-button intake-button-primary" disabled={disabled} onClick={onAddUnit}>
            {t("table.confirmAddUnit")}
          </button>
          <button type="button" className="intake-button" disabled={disabled} onClick={onCancelUnit}>
            {t("table.cancel")}
          </button>
        </span>
      </>
    );
  }

  return (
    <>
      {badge}
      <span id={reasonId} className="intake-reason">
        {t("table.duplicateChoose")}
      </span>
      <span className="intake-choices">
        {/* Only a tool can take another unit; a pending item has none yet. */}
        {match.kind === "tool" ? (
          <button type="button" className="intake-button" disabled={disabled} onClick={onChooseUnit}>
            {t("table.addAsUnit")}
          </button>
        ) : null}
        <button type="button" className="intake-button" disabled={disabled} onClick={onDifferentTool}>
          {t("table.differentTool")}
        </button>
      </span>
    </>
  );
}

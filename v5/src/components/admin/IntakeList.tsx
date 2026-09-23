"use client";

import "../../styles/admin-intake.css";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { IntakeConfidenceLevel } from "../../lib/capabilities/types";
import { hasStalledStart } from "../../lib/intake/access";
import { INTAKE_POLL_INTERVAL_MS } from "../../lib/intake/limits";
import type { ResearchFocusField } from "../../lib/intake/research-focus";
import {
  ADMIN_INTAKE_PATH,
  type PendingApiErrorCode,
  type PendingStatus,
  type PendingToolView,
} from "../../lib/intake/types";

/**
 * The review queue on `/admin/intake` (spec §5.4 step 10, §6).
 *
 * A card list rather than a table, like the three §5.6 queues, and for their
 * reason: a failed item carries a diagnosis somebody has to read. Items are
 * grouped by the batch they were identified in — one chat turn's worth of
 * equipment — newest batch first, because a batch is how the person who
 * identified them remembers them. The open work is on the page; approved and
 * discarded items fold behind a disclosure.
 *
 * **It polls while research runs, and only then.** Research happens in a
 * workflow the page cannot subscribe to, so while anything in view is queued
 * or researching it asks the server for a fresh render every
 * `INTAKE_POLL_INTERVAL_MS` (§5.4 step 10). The interval is cleared the moment
 * nothing is in flight, and on unmount — a queue left open in a tab overnight
 * must not re-render itself forty thousand times for nothing.
 *
 * **Research and Retry are the same request.** Both POST the one id to
 * `/api/pending-tools/research`; a queued item whose workflow failed to start
 * is research-able again by construction (`isResearchable`), so a repeat POST
 * is the retry the unhappy path promises. The route answers codes; this renders
 * `admin.intake.errors.<code>` and never the English `error`.
 *
 * **A start that stalled is a failed start.** An item left `queued` with no
 * run — `start()` threw and even recording why failed, or the function was
 * killed first — is nothing anybody is working on once
 * `RESEARCH_START_STALE_MS` has passed (`hasStalledStart`). The page stops
 * polling for it and offers Retry and Discard, exactly as for a start whose
 * failure was recorded (§5.4 unhappy paths).
 *
 * **An item left behind can still be dealt with here.** The chat card is where
 * a duplicate is normally decided, but unselected rows wait on this page for
 * later, and by then the chat may be gone. So an unresolved duplicate gets the
 * card's choices — **Add as another unit** (with a serial number) when it
 * matched a catalogue tool, and **It's a different tool** — and anything not yet
 * researched (or whose research failed) can be **Discarded** after an inline
 * confirmation. All of them are the table card's own
 * `PATCH /api/pending-tools/[id]`, so the route's ownership and state checks
 * are the ones that apply.
 */

/** The route both controls call. Never imported — it is Part A's endpoint. */
export const RESEARCH_ENDPOINT = "/api/pending-tools/research";

/** The table card's edit route, which Discard and "It's a different tool" reuse. */
export function pendingToolEndpoint(id: string): string {
  return `/api/pending-tools/${id}`;
}

/** Every code the pending-tools routes answer, so an unknown one reads as `failed`. */
const API_ERROR_CODES: Record<PendingApiErrorCode, true> = {
  invalid_body: true,
  sign_in_required: true,
  forbidden: true,
  not_found: true,
  not_editable: true,
  invalid_field: true,
  rate_limited: true,
  too_many_items: true,
  daily_limit: true,
  unresolved_duplicate: true,
  not_researchable: true,
  start_failed: true,
  image_retry_running: true,
  failed: true,
};

function isApiErrorCode(value: unknown): value is PendingApiErrorCode {
  return typeof value === "string" && Object.hasOwn(API_ERROR_CODES, value);
}

/**
 * Send one item to research. Answers null when the route accepted it, or the
 * refusal's code. A dropped connection is `failed`, like any other surprise.
 */
export async function requestResearch(
  id: string,
  note?: string | null,
  focus?: readonly ResearchFocusField[] | null
): Promise<PendingApiErrorCode | null> {
  try {
    const res = await fetch(RESEARCH_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // A reviewer's note travels only when there is one (amendment "reviewer
      // notes"), and a focus only when it is not everything ("Guided redo").
      body: JSON.stringify({ ids: [id], ...(note ? { note } : {}), ...(focus?.length ? { focus } : {}) }),
    });
    return await answer(res);
  } catch {
    return "failed";
  }
}

/** Answer null when the route accepted it, or the refusal's code. */
async function answer(res: Response): Promise<PendingApiErrorCode | null> {
  if (res.ok) return null;
  const body = (await res.json().catch(() => null)) as { code?: unknown } | null;
  return isApiErrorCode(body?.code) ? body.code : "failed";
}

/** Discard one item, or decide its duplicate, through the table card's route. */
export async function patchPendingTool(
  id: string,
  body:
    | { discard: true }
    | { duplicateResolution: "new_tool" }
    | { duplicateResolution: "add_unit"; serialNumber?: string }
): Promise<PendingApiErrorCode | null> {
  try {
    const res = await fetch(pendingToolEndpoint(id), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return await answer(res);
  } catch {
    return "failed";
  }
}

/** Nothing more will happen to these, so they fold away. */
const SETTLED: ReadonlySet<PendingStatus> = new Set(["approved", "discarded"]);

/**
 * Research is under way and the page should keep asking. A queued item whose
 * start failed or stalled has nothing running for it, so it is not in flight;
 * it is waiting for somebody to press Retry.
 */
export function isInFlight(
  item: Pick<PendingToolView, "status" | "researchError" | "researchRequestedAt" | "hasWorkflowRun">,
  now: number = Date.now()
): boolean {
  if (item.status === "researching") return true;
  return item.status === "queued" && !hasStalledStart(item, now);
}

/**
 * What `discardPendingTool` accepts: nothing is running for it and nobody has
 * decided it. A researched item is discarded from its own page, beside the
 * proposal it would be throwing away.
 */
function discardable(item: PendingToolView): boolean {
  return item.status === "identified" || item.status === "failed" || startFailed(item);
}

/** A start that never happened: queued, no run, and either a reason or too long waiting. */
function startFailed(item: PendingToolView): boolean {
  return hasStalledStart(item);
}

const LEVEL_KEYS: Record<IntakeConfidenceLevel, string> = {
  high: "confidenceHigh",
  medium: "confidenceMedium",
  low: "confidenceLow",
};

export interface IntakeListProps {
  items: PendingToolView[];
}

export function IntakeList({ items }: IntakeListProps) {
  const t = useTranslations("admin.intake");
  const router = useRouter();
  const polling = items.some((item) => isInFlight(item));

  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(() => router.refresh(), INTAKE_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [polling, router]);

  if (items.length === 0) {
    return <p className="admin-empty td-empty">{t("empty")}</p>;
  }

  const open = items.filter((item) => !SETTLED.has(item.status));
  const settled = items.filter((item) => SETTLED.has(item.status));

  return (
    <div className="admin-queue admin-intake-list">
      {open.length === 0 ? (
        <p className="admin-empty td-empty">{t("emptyOpen")}</p>
      ) : (
        <Batches items={open} />
      )}

      {settled.length > 0 ? (
        <details className="admin-queue-settled">
          <summary>{t("settledToggle", { count: settled.length })}</summary>
          <Batches items={settled} />
        </details>
      ) : null}
    </div>
  );
}

/**
 * Items grouped by batch, the batch with the newest item first. Within a batch
 * the order is the one the server sent — alphabetical, from `listPendingTools`.
 */
function Batches({ items }: { items: PendingToolView[] }) {
  const t = useTranslations("admin.intake");

  const batches = new Map<string, PendingToolView[]>();
  for (const item of items) {
    const batch = batches.get(item.batchId);
    if (batch) batch.push(item);
    else batches.set(item.batchId, [item]);
  }
  const ordered = [...batches.values()].sort((a, b) => newest(b).localeCompare(newest(a)));

  return (
    <div className="admin-intake-batches">
      {ordered.map((batch) => (
        <section key={batch[0].batchId} className="admin-intake-batch">
          <h3 className="admin-intake-batch-head">
            {t("batchHeading", { count: batch.length, date: day(newest(batch)) })}
          </h3>
          <ul className="admin-queue-list">
            {batch.map((item) => (
              <IntakeRow key={item.id} item={item} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function IntakeRow({ item }: { item: PendingToolView }) {
  const t = useTranslations("admin.intake");
  const tStatus = useTranslations("intake.status");
  const tIntake = useTranslations("intake");
  const photo = item.photos.find((candidate) => candidate.url)?.url ?? null;
  const settled = SETTLED.has(item.status);
  const linked = item.status === "researched" || item.status === "approved";

  // Research for an item nobody has sent yet; Retry for one that failed or
  // never started. A researched item is re-researched from its own page.
  const control =
    item.status === "identified"
      ? "research"
      : item.status === "failed" || startFailed(item)
        ? "retry"
        : null;

  return (
    <li className="admin-queue-card admin-intake-row">
      <header className="admin-queue-card-head">
        {photo ? (
          <span className="admin-thumb">
            {/* `unoptimized`, like every admin thumbnail: a Blob URL on a page
                nobody browses for pleasure. */}
            <Image
              src={photo}
              alt=""
              fill
              sizes="48px"
              style={{ objectFit: "cover" }}
              unoptimized
            />
          </span>
        ) : null}
        <h4>
          {linked ? <Link href={`${ADMIN_INTAKE_PATH}/${item.id}`}>{item.name}</Link> : item.name}
        </h4>
        <span className={`admin-state admin-intake-status is-${item.status}`}>
          {tStatus(item.status)}
        </span>
      </header>

      <p className="admin-queue-meta">
        {item.brand ? <span>{item.brand}</span> : null}
        {item.confidenceLevel ? (
          <span className="admin-intake-confidence">
            {tIntake(LEVEL_KEYS[item.confidenceLevel])}
          </span>
        ) : null}
        <span>
          {item.createdByName
            ? t("identifiedBy", { name: item.createdByName })
            : t("identifiedByUnknown")}
        </span>
        <span className="admin-date">{t("identifiedOn", { date: day(item.createdAt) })}</span>
      </p>

      {item.duplicateOf ? <DuplicateNote item={item} /> : null}

      {startFailed(item) && !item.researchError ? (
        <div className="admin-intake-diagnosis">
          <p className="admin-intake-diagnosis-label">{t("startFailedLabel")}</p>
          <p className="admin-intake-diagnosis-text">{t("startStalled")}</p>
        </div>
      ) : null}

      {item.researchError && !settled ? (
        <div className="admin-intake-diagnosis">
          <p className="admin-intake-diagnosis-label">
            {startFailed(item) ? t("startFailedLabel") : t("researchErrorLabel")}
          </p>
          {/* The diagnosis is recorded in English by the workflow or the
              route — it is a record for whoever debugs this, not UI copy. */}
          <p className="admin-intake-diagnosis-text" lang="en">
            {item.researchError}
          </p>
        </div>
      ) : null}

      {control ? <ResearchButton id={item.id} name={item.name} kind={control} /> : null}
      {discardable(item) ? <SettleControls item={item} /> : null}
    </li>
  );
}

function DuplicateNote({ item }: { item: PendingToolView }) {
  const t = useTranslations("admin.intake");
  const match = item.duplicateOf;
  if (!match) return null;

  return (
    <p className="admin-intake-duplicate">
      <span>
        {match.kind === "tool"
          ? t("duplicateOfTool", { name: match.name })
          : t("duplicateOfPending", { name: match.name })}
      </span>{" "}
      <span>{t(`resolution.${item.duplicateResolution ?? "unresolved"}`)}</span>
    </p>
  );
}

/**
 * Research or Retry for one item. Its own state, so one row's refusal does not
 * appear on another's. On success the page is asked for a fresh render, which
 * shows the item queued and starts the polling above.
 */
function ResearchButton({
  id,
  name,
  kind,
}: {
  id: string;
  name: string;
  kind: "research" | "retry";
}) {
  const t = useTranslations("admin.intake");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<PendingApiErrorCode | null>(null);
  const [started, setStarted] = useState(false);

  async function handleClick() {
    setPending(true);
    setError(null);
    setStarted(false);
    const code = await requestResearch(id);
    setPending(false);
    if (code) {
      setError(code);
      return;
    }
    setStarted(true);
    router.refresh();
  }

  return (
    <div className="admin-intake-controls">
      <button
        type="button"
        className="admin-button is-primary"
        disabled={pending}
        aria-label={t(kind === "research" ? "researchFor" : "retryFor", { name })}
        onClick={handleClick}
      >
        {t(kind === "research" ? "research" : "retry")}
      </button>
      <span className={`admin-row-status${error ? " is-error" : ""}`} role="status">
        {pending ? t("starting") : null}
        {!pending && started ? t("researchStarted") : null}
        {!pending && error ? t(`errors.${error}`) : null}
      </span>
    </div>
  );
}

/**
 * The duplicate's choices for an undecided one — **Add as another unit** (a
 * catalogue match only, asking for a serial number) and **It's a different
 * tool** — and Discard behind an inline confirmation (never a modal — §6). One
 * state for all of them, so a refusal shows beside the controls that caused
 * it. Success asks for a fresh render: the row moves on (researchable, or
 * folded away as discarded) because the database says so, not because this
 * island assumed it.
 */
function SettleControls({ item }: { item: PendingToolView }) {
  const t = useTranslations("admin.intake");
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  // Null until "Add as another unit" is chosen; then the serial being typed.
  const [serial, setSerial] = useState<string | null>(null);
  const [pending, setPending] = useState<"discard" | "resolve" | "unit" | null>(null);
  const [error, setError] = useState<PendingApiErrorCode | null>(null);
  const undecided =
    item.status === "identified" && item.duplicateOf !== null && item.duplicateResolution === null;
  const canAddUnit = undecided && item.duplicateOf?.kind === "tool";
  const serialId = `intake-${item.id}-serial`;

  async function run(kind: "discard" | "resolve" | "unit") {
    setPending(kind);
    setError(null);
    const value = serial?.trim() ?? "";
    const code = await patchPendingTool(
      item.id,
      kind === "discard"
        ? { discard: true }
        : kind === "unit"
          ? { duplicateResolution: "add_unit", ...(value ? { serialNumber: value } : {}) }
          : { duplicateResolution: "new_tool" }
    );
    setPending(null);
    setConfirming(false);
    if (code) {
      setError(code);
      return;
    }
    setSerial(null);
    router.refresh();
  }

  if (serial !== null) {
    return (
      <div className="admin-intake-controls">
        <span className="admin-intake-confirm" role="group" aria-label={t("addAsUnitFor", { name: item.name })}>
          <label className="admin-field" htmlFor={serialId}>
            {t("unitSerial")}
            <input
              id={serialId}
              value={serial}
              maxLength={200}
              aria-describedby={`${serialId}-hint`}
              onChange={(event) => setSerial(event.target.value)}
            />
          </label>
          <span id={`${serialId}-hint`} className="admin-queue-meta">
            {t("addAsUnitHint")}
          </span>
          <button
            type="button"
            className="admin-button is-primary"
            disabled={pending !== null}
            onClick={() => run("unit")}
          >
            {t("addAsUnitConfirm")}
          </button>
          <button
            type="button"
            className="admin-button"
            disabled={pending !== null}
            onClick={() => setSerial(null)}
          >
            {t("addAsUnitCancel")}
          </button>
        </span>
        <span className={`admin-row-status${error ? " is-error" : ""}`} role="status">
          {pending === "unit" ? t("busy.save") : null}
          {!pending && error ? t(`errors.${error}`) : null}
        </span>
      </div>
    );
  }

  return (
    <div className="admin-intake-controls">
      {canAddUnit ? (
        <button
          type="button"
          className="admin-button"
          disabled={pending !== null}
          aria-label={t("addAsUnitFor", { name: item.name })}
          onClick={() => {
            setError(null);
            setSerial(item.serialNumber ?? "");
          }}
        >
          {t("addAsUnit")}
        </button>
      ) : null}
      {undecided ? (
        <button
          type="button"
          className="admin-button"
          disabled={pending !== null}
          aria-label={t("differentToolFor", { name: item.name })}
          onClick={() => run("resolve")}
        >
          {t("differentTool")}
        </button>
      ) : null}
      {confirming ? (
        <span className="admin-intake-confirm" role="group" aria-label={t("discardFor", { name: item.name })}>
          <span>{t("discardConfirm", { name: item.name })}</span>
          <button
            type="button"
            className="admin-button is-danger"
            disabled={pending !== null}
            onClick={() => run("discard")}
          >
            {t("discardYes")}
          </button>
          <button
            type="button"
            className="admin-button"
            disabled={pending !== null}
            onClick={() => setConfirming(false)}
          >
            {t("discardKeep")}
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="admin-button"
          disabled={pending !== null}
          aria-label={t("discardFor", { name: item.name })}
          onClick={() => setConfirming(true)}
        >
          {t("discard")}
        </button>
      )}
      <span className={`admin-row-status${error ? " is-error" : ""}`} role="status">
        {pending === "discard" ? t("busy.discard") : null}
        {pending === "resolve" ? t("busy.save") : null}
        {!pending && error ? t(`errors.${error}`) : null}
      </span>
    </div>
  );
}

/** The latest `createdAt` in a batch. ISO strings sort as the instants they name. */
function newest(batch: PendingToolView[]): string {
  return batch.reduce((latest, item) => (item.createdAt > latest ? item.createdAt : latest), "");
}

/** `2026-03-06` — the date format every admin queue uses. */
function day(iso: string): string {
  return iso.slice(0, 10);
}

"use client";

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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QueueList } from "../system/queue/QueueList";
import { Field, hintId } from "../system/Field";
import { StatusGlyph, type StatusTone } from "../system/StatusGlyph";
import { DuplicateChoice } from "../system/review/DuplicateChoice";
import { ReviewCard, ReviewDiagnosis, ReviewNote } from "../system/review/ReviewCard";
import { PENDING_STATUS_TONE } from "./pending-status-tone";
import { personLabel } from "./person-label";

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
  /** The search and facets over the queue; off for the one item an item page shows. */
  filters?: boolean;
}

/** Every status a queue item can be in, in the order work moves. */
const STATUSES: readonly PendingStatus[] = ["identified", "queued", "researching", "researched", "failed", "approved", "discarded"];

export function IntakeList({ items, filters = true }: IntakeListProps) {
  const t = useTranslations("admin.intake");
  const tStatus = useTranslations("intake.status");
  const router = useRouter();
  const polling = items.some((item) => isInFlight(item));

  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(() => router.refresh(), INTAKE_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [polling, router]);

  // The shared queue layout (UI system phase 4): the open work by batch, the
  // decided work folded away, search and a Status facet over both.
  return (
    <QueueList
      items={items}
      getId={(item) => item.id}
      isOpen={(item) => !SETTLED.has(item.status)}
      searchText={filters ? (item) => [item.name, item.brand, item.categoryHint, item.createdByName].join(" ") : undefined}
      facets={
        filters
          ? [
              {
                id: "status",
                label: t("statusFacet"),
                values: STATUSES,
                valueLabel: (value) => tStatus(value),
                matches: (item, value) => item.status === value,
              },
            ]
          : []
      }
      labels={{
        list: t("queueLabel"),
        filters: t("filtersLabel"),
        search: t("search"),
        searchPlaceholder: t("searchPlaceholder"),
        settled: (count) => t("settledToggle", { count }),
        empty: t("empty"),
        emptyOpen: t("emptyOpen"),
      }}
      renderItem={(item) => <IntakeRow item={item} />}
      renderList={(run) => <Batches items={run} />}
    />
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
    <div className="ui flex flex-col gap-6">
      {ordered.map((batch) => (
        <section key={batch[0].batchId} className="flex flex-col">
          <h3 className="m-0 border-b border-border pb-1 font-mono text-label font-medium text-muted-foreground uppercase">
            {t("batchHeading", { count: batch.length, date: day(newest(batch)) })}
          </h3>
          <ul className="flex flex-col">
            {batch.map((item) => (
              <li key={item.id}>
                <IntakeRow item={item} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

const CONFIDENCE_TONE: Record<IntakeConfidenceLevel, StatusTone> = { high: "ok", medium: "warn", low: "bad" };

/**
 * One waiting item as a `ReviewCard` (UI system phase 3): name (the link to
 * its page once research has proposed something), status and confidence as
 * glyphs, who identified it and when, a duplicate as a `DuplicateChoice`, a
 * failure as a diagnosis, and its one next step.
 */
function IntakeRow({ item }: { item: PendingToolView }) {
  const t = useTranslations("admin.intake");
  const tStatus = useTranslations("intake.status");
  const tIntake = useTranslations("intake");
  const tPeople = useTranslations("admin.people");
  const identifiedBy = personLabel(tPeople, item.createdByName, item.createdByRemoved);
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
    <ReviewCard
      label={item.name}
      title={
        linked ? (
          <Link className="text-primary-ink underline-offset-2 hover:underline" href={`${ADMIN_INTAKE_PATH}/${item.id}`}>
            {item.name}
          </Link>
        ) : undefined
      }
      tone={settled ? "settled" : item.status === "failed" ? "safety" : "default"}
      media={
        photo ? (
          <span className="relative size-10 shrink-0 overflow-hidden border border-border bg-muted">
            {/* `unoptimized`, like every admin thumbnail: a Blob URL on a page
                nobody browses for pleasure. */}
            <Image src={photo} alt="" fill sizes="40px" style={{ objectFit: "cover" }} unoptimized />
          </span>
        ) : null
      }
      marks={
        <>
          <StatusGlyph tone={PENDING_STATUS_TONE[item.status]} label={tStatus(item.status)} />
          {item.confidenceLevel ? (
            <StatusGlyph tone={CONFIDENCE_TONE[item.confidenceLevel]} label={tIntake(LEVEL_KEYS[item.confidenceLevel])} />
          ) : null}
        </>
      }
      meta={
        <>
          {item.brand ? <span>{item.brand}</span> : null}
          <span>{identifiedBy ? t("identifiedBy", { name: identifiedBy }) : t("identifiedByUnknown")}</span>
          <span className="tabular-nums">{t("identifiedOn", { date: day(item.createdAt) })}</span>
        </>
      }
    >
      {item.duplicateOf ? <Duplicate item={item} /> : null}

      {startFailed(item) && !item.researchError ? (
        <ReviewDiagnosis label={t("startFailedLabel")}>{t("startStalled")}</ReviewDiagnosis>
      ) : null}

      {item.researchError && !settled ? (
        // The diagnosis is recorded in English by the workflow or the route —
        // it is a record for whoever debugs this, not UI copy.
        <ReviewDiagnosis label={startFailed(item) ? t("startFailedLabel") : t("researchErrorLabel")} lang="en">
          {item.researchError}
        </ReviewDiagnosis>
      ) : null}

      {control || discardable(item) ? (
        <div className="flex flex-wrap items-center gap-2">
          {control ? <ResearchButton id={item.id} name={item.name} kind={control} /> : null}
          {discardable(item) ? <DiscardControl item={item} /> : null}
        </div>
      ) : null}
    </ReviewCard>
  );
}

/** Identified, matched, and nobody has said what to do about the match. */
function undecided(item: PendingToolView): boolean {
  return item.status === "identified" && item.duplicateOf !== null && item.duplicateResolution === null;
}

/**
 * The duplicate, with its choices while it is undecided — **Add as another
 * unit** (a catalogue match only, asking for a serial number) and **It's a
 * different tool** — or the decision in words once made; Discard is the
 * row's own control, under it. All of them are the table card's own `PATCH /api/pending-tools/[id]`,
 * so the route's ownership and state checks are the ones that apply. Success
 * asks for a fresh render: the row moves on because the database says so.
 */
function Duplicate({ item }: { item: PendingToolView }) {
  const t = useTranslations("admin.intake");
  const router = useRouter();
  // Null until "Add as another unit" is chosen; then the serial being typed.
  const [serial, setSerial] = useState<string | null>(null);
  const [pending, setPending] = useState<"resolve" | "unit" | null>(null);
  const [error, setError] = useState<PendingApiErrorCode | null>(null);
  const match = item.duplicateOf;
  if (!match) return null;
  const open = undecided(item);
  const serialId = `intake-${item.id}-serial`;

  async function run(kind: "resolve" | "unit") {
    setPending(kind);
    setError(null);
    const value = serial?.trim() ?? "";
    const code = await patchPendingTool(
      item.id,
      kind === "unit"
        ? { duplicateResolution: "add_unit", ...(value ? { serialNumber: value } : {}) }
        : { duplicateResolution: "new_tool" }
    );
    setPending(null);
    if (code) {
      setError(code);
      return;
    }
    setSerial(null);
    router.refresh();
  }

  return (
    <DuplicateChoice
      label={t("duplicateChoiceFor", { name: item.name })}
      match={match.kind === "tool" ? t("duplicateOfTool", { name: match.name }) : t("duplicateOfPending", { name: match.name })}
      options={[
        ...(match.kind === "tool"
          ? [{ value: "add_unit" as const, label: t("addAsUnit"), ariaLabel: t("addAsUnitFor", { name: item.name }) }]
          : []),
        { value: "new_tool" as const, label: t("differentTool"), ariaLabel: t("differentToolFor", { name: item.name }) },
      ]}
      value={serial !== null ? "add_unit" : null}
      disabled={pending !== null || serial !== null}
      resolved={open ? null : t(`resolution.${item.duplicateResolution ?? "unresolved"}`)}
      resolvedTone={item.duplicateResolution ? "ok" : "warn"}
      onChoose={(value) => {
        setError(null);
        if (value === "add_unit") setSerial(item.serialNumber ?? "");
        else void run("resolve");
      }}
    >
      {open && serial !== null ? (
        <div role="group" aria-label={t("addAsUnitFor", { name: item.name })} className="flex flex-wrap items-end gap-2">
          <Field id={serialId} label={t("unitSerial")} hint={t("addAsUnitHint")} className="w-56">
            <Input
              id={serialId}
              value={serial}
              maxLength={200}
              aria-describedby={hintId(serialId)}
              className="h-7 text-table"
              onChange={(event) => setSerial(event.target.value)}
            />
          </Field>
          <Button variant="default" size="xs" disabled={pending !== null} onClick={() => void run("unit")}>
            {t("addAsUnitConfirm")}
          </Button>
          <Button size="xs" disabled={pending !== null} onClick={() => setSerial(null)}>
            {t("addAsUnitCancel")}
          </Button>
        </div>
      ) : null}
      <ReviewNote role="status" tone={error ? "bad" : "muted"}>
        {pending ? t("busy.save") : null}
        {!pending && error ? t(`errors.${error}`) : null}
      </ReviewNote>
    </DuplicateChoice>
  );
}

/**
 * Research or Retry for one item. Its own state, so one row's refusal does not
 * appear on another's. On success the page is asked for a fresh render, which
 * shows the item queued and starts the polling above.
 */
function ResearchButton({ id, name, kind }: { id: string; name: string; kind: "research" | "retry" }) {
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
    <>
      <Button
        variant="outline"
        size="xs"
        disabled={pending}
        aria-label={t(kind === "research" ? "researchFor" : "retryFor", { name })}
        onClick={handleClick}
      >
        {t(kind === "research" ? "research" : "retry")}
      </Button>
      <ReviewNote role="status" tone={error ? "bad" : "muted"}>
        {pending ? t("starting") : null}
        {!pending && started ? t("researchStarted") : null}
        {!pending && error ? t(`errors.${error}`) : null}
      </ReviewNote>
    </>
  );
}

/** Discard, behind an inline confirmation (never a modal — §6). */
function DiscardControl({ item }: { item: PendingToolView }) {
  const t = useTranslations("admin.intake");
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<PendingApiErrorCode | null>(null);

  async function discard() {
    setPending(true);
    setError(null);
    const code = await patchPendingTool(item.id, { discard: true });
    setPending(false);
    setConfirming(false);
    if (code) {
      setError(code);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {confirming ? (
        <span role="group" aria-label={t("discardFor", { name: item.name })} className="flex flex-wrap items-center gap-2 text-table">
          <span>{t("discardConfirm", { name: item.name })}</span>
          <Button variant="destructive" size="xs" disabled={pending} onClick={() => void discard()}>
            {t("discardYes")}
          </Button>
          <Button size="xs" disabled={pending} onClick={() => setConfirming(false)}>
            {t("discardKeep")}
          </Button>
        </span>
      ) : (
        <Button
          variant="ghost"
          size="xs"
          disabled={pending}
          aria-label={t("discardFor", { name: item.name })}
          onClick={() => setConfirming(true)}
        >
          {t("discard")}
        </Button>
      )}
      <ReviewNote role="status" tone={error ? "bad" : "muted"}>
        {pending ? t("busy.discard") : null}
        {!pending && error ? t(`errors.${error}`) : null}
      </ReviewNote>
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

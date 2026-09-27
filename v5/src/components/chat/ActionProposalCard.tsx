"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { ActionPreview, ActionPreviewRow } from "../../lib/actions/define";
import type { DriftedField } from "../../lib/actions/staleness";
import type { ActionProposalCardPayload } from "../../lib/capabilities/actions";
import { Button } from "@/components/ui/button";
import { StatusGlyph, type StatusTone } from "../system/StatusGlyph";
import { ReviewCard, ReviewNote } from "../system/review/ReviewCard";

/**
 * The assistant's proposed change (assistant–GUI parity spec §6): one card
 * per `data-action-proposal` part, a row per subject.
 *
 * **Drawn from the stored proposal, never from the model's words.** The
 * payload is what the server wrote from the `action_proposals` rows — a
 * next-intl summary key with values read from the database, and before →
 * after values — so the card cannot say one thing while the click does
 * another (§8.4).
 *
 * **Confirm is the only commit**, and it sends ids only: `POST
 * /api/action-proposals` runs each row's stored input through the same
 * `performAction` the GUI uses, with the permission checked again. A batch
 * card ticks every row and offers **Confirm N**; unticking one confirms the
 * rest. Each row then shows its own outcome. The buttons are `type="button"`
 * and nothing listens for Enter, so a keystroke in the chat never confirms.
 *
 * **The server's state wins over the card's memory** (§5.5): on mount the
 * card re-reads its rows (`GET ?ids=`), so a card re-rendered after it was
 * confirmed, dismissed or expired never offers Confirm again, and a row
 * whose `expiresAt` passes while the card is on screen turns Expired. A
 * confirm that finds the record changed since the card was drawn answers
 * `conflict` with the value now, and the card shows it.
 */

type RowStatus = "open" | "confirming" | "confirmed" | "failed" | "conflict" | "expired" | "cancelled" | "already_decided" | "not_found";

interface RowState {
  status: RowStatus;
  error?: string;
  warning?: string;
  drifted?: DriftedField[];
}

interface Outcome {
  id: string;
  /** `open`: the request ran out of time before this row; nothing changed. */
  status: Exclude<RowStatus, "confirming">;
  error?: string;
  warning?: string;
  drifted?: DriftedField[];
}

/** A row as `GET /api/action-proposals?ids=` answers it. */
interface StoredRow {
  id: string;
  status: RowStatus;
  result: { error?: string; warning?: string; drifted?: DriftedField[] } | null;
}

const isPast = (iso: string) => {
  const at = Date.parse(iso);
  return Number.isFinite(at) && at <= Date.now();
};

const STATUS_TONE: Record<RowStatus, StatusTone> = {
  open: "active",
  confirming: "warn",
  confirmed: "ok",
  failed: "bad",
  conflict: "warn",
  expired: "muted",
  cancelled: "muted",
  already_decided: "muted",
  not_found: "bad",
};

const RISK_TONE: Record<ActionProposalCardPayload["risk"], StatusTone> = {
  operational: "idle",
  catalog: "active",
  people: "warn",
  spend: "warn",
  destructive: "bad",
};

/** Codes with an `admin.errors.<code>` sentence; anything else reads as "failed". */
const KNOWN_ERRORS = new Set([
  "not_signed_in",
  "not_permitted",
  "rate_limited",
  "unknown_user",
  "invalid_role",
  "protected_floor",
  "last_super_admin",
  "self_remove",
  "invalid_title",
  "invalid_email",
  "invalid_name",
  "email_not_allowed",
  "email_blocked",
  "duplicate_email",
  "conflict",
  "not_found",
  "invalid_field",
  "failed",
]);

export function ActionProposalCard({ payload }: { payload: ActionProposalCardPayload }) {
  const t = useTranslations("actions");
  const te = useTranslations("admin.errors");
  const tw = useTranslations("admin.warnings");
  const router = useRouter();
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(payload.items.map((item) => [item.id, { status: (isPast(item.expiresAt) ? "expired" : "open") as RowStatus }]))
  );

  // What the server holds, once, on mount: only rows still shown as open are
  // replaced, so a click already under way is never overwritten.
  const idsKey = payload.items.map((item) => item.id).join(",");
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await fetch(`/api/action-proposals?ids=${idsKey}`);
        if (!res.ok) return;
        const body = (await res.json().catch(() => null)) as { proposals?: StoredRow[] } | null;
        if (!live || !body?.proposals) return;
        const stored = body.proposals.filter((row) => row.status !== "open");
        if (stored.length === 0) return;
        setRows((prev) => {
          const next = { ...prev };
          for (const row of stored) {
            if (next[row.id]?.status !== "open") continue;
            next[row.id] = { status: row.status, error: row.result?.error, warning: row.result?.warning, drifted: row.result?.drifted };
          }
          return next;
        });
      } catch {
        // The card still works from what it was given; a click re-checks everything.
      }
    })();
    return () => {
      live = false;
    };
  }, [idsKey]);

  // An open row turns Expired when its time passes while the card is on screen.
  useEffect(() => {
    const pending = payload.items.map((item) => Date.parse(item.expiresAt) - Date.now()).filter((ms) => Number.isFinite(ms) && ms > 0);
    if (pending.length === 0) return;
    const timer = setTimeout(
      () =>
        setRows((prev) => {
          const next = { ...prev };
          for (const item of payload.items) {
            if (next[item.id]?.status === "open" && isPast(item.expiresAt)) next[item.id] = { status: "expired" };
          }
          return next;
        }),
      Math.min(Math.min(...pending) + 250, 2 ** 31 - 1)
    );
    return () => clearTimeout(timer);
  }, [payload.items, rows]);
  const [included, setIncluded] = useState<Set<string>>(() => new Set(payload.items.map((item) => item.id)));
  const [requestError, setRequestError] = useState(false);

  const batch = payload.items.length > 1;
  const open = payload.items.filter((item) => rows[item.id]?.status === "open");
  const chosen = open.filter((item) => included.has(item.id)).map((item) => item.id);
  const busy = payload.items.some((item) => rows[item.id]?.status === "confirming");
  const reason = (code: string | undefined) => te(KNOWN_ERRORS.has(code ?? "") ? (code as "failed") : "failed");

  async function decide(ids: string[], decision: "confirm" | "cancel") {
    if (ids.length === 0) return;
    setRequestError(false);
    setRows((prev) => ({ ...prev, ...Object.fromEntries(ids.map((id) => [id, { status: "confirming" as RowStatus }])) }));
    try {
      const res = await fetch("/api/action-proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids, decision }),
      });
      const body = (await res.json().catch(() => null)) as { results?: Outcome[] } | null;
      if (!res.ok || !body?.results) throw new Error("request refused");
      setRows((prev) => ({
        ...prev,
        ...Object.fromEntries(
          body.results!.map((outcome) => [outcome.id, { status: outcome.status, error: outcome.error, warning: outcome.warning, drifted: outcome.drifted }])
        ),
      }));
      // The page behind the chat shows the change too (a People row, a ticket).
      if (body.results.some((outcome) => outcome.status === "confirmed")) router.refresh();
    } catch {
      setRequestError(true);
      setRows((prev) => ({ ...prev, ...Object.fromEntries(ids.map((id) => [id, { status: "open" as RowStatus }])) }));
    }
  }

  return (
    <section
      data-slot="action-proposal"
      data-risk={payload.risk}
      aria-label={t("card.label")}
      className="ui flex flex-col gap-2 border-t border-rule pt-1"
    >
      {payload.items.map((item) => {
        const state = rows[item.id] ?? { status: "open" as RowStatus };
        const summary = t(`summary.${item.preview.summary.key}` as "summary.people_set_title", item.preview.summary.values);
        return (
          <ReviewCard
            key={item.id}
            label={summary}
            tone={state.status === "open" || state.status === "confirming" ? (payload.risk === "destructive" ? "safety" : "default") : "settled"}
            marks={
              <>
                <StatusGlyph tone={RISK_TONE[payload.risk]} label={t(`card.risk.${payload.risk}`)} />
                <StatusGlyph tone={STATUS_TONE[state.status]} label={statusLabel(t, state.status)} />
              </>
            }
          >
            {batch && state.status === "open" ? (
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={included.has(item.id)}
                  onChange={(event) =>
                    setIncluded((prev) => {
                      const next = new Set(prev);
                      if (event.target.checked) next.add(item.id);
                      else next.delete(item.id);
                      return next;
                    })
                  }
                />
                {t("card.include", { name: item.preview.subjectName })}
              </label>
            ) : null}
            <PreviewRows preview={item.preview} />
            {state.status === "failed" || state.status === "conflict" || state.status === "not_found" ? (
              <ReviewNote tone="bad" role="alert">
                {state.status === "conflict" ? t("card.conflict") : t("card.failedReason", { reason: reason(state.error ?? state.status) })}
                {state.status === "conflict" && state.drifted && state.drifted.length > 0 ? (
                  <>
                    {" "}
                    {state.drifted
                      .map((d) =>
                        t("card.driftedNow", {
                          field: t(`fields.${d.field}` as "fields.role"),
                          value: valueText(t, { field: d.field, before: d.was, after: d.now, format: d.format }, d.now),
                        })
                      )
                      .join(" ")}
                  </>
                ) : null}
              </ReviewNote>
            ) : null}
            {state.status === "expired" ? <ReviewNote tone="warn">{t("card.expiredHint")}</ReviewNote> : null}
            {state.status === "confirmed" && state.warning ? (
              <ReviewNote tone="warn">{tw.has(state.warning as "audit_unavailable") ? tw(state.warning as "audit_unavailable") : tw("audit_unavailable")}</ReviewNote>
            ) : null}
            {state.status === "confirmed" && item.preview.link ? (
              <a className="text-xs text-primary-ink hover:underline" href={item.preview.link}>
                {t("card.view")}
              </a>
            ) : null}
          </ReviewCard>
        );
      })}

      {payload.refused.length > 0 ? (
        <ReviewNote tone="warn">
          {t("card.refused", {
            count: payload.refused.length,
            reasons: [...new Set(payload.refused.map((item) => reason(item.error)))].join(" "),
          })}
        </ReviewNote>
      ) : null}

      {open.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="default" size="sm" disabled={busy || chosen.length === 0} onClick={() => void decide(chosen, "confirm")}>
            {batch ? t("card.confirmCount", { count: chosen.length }) : t("card.confirm")}
          </Button>
          <Button type="button" variant="quiet" size="sm" disabled={busy} onClick={() => void decide(open.map((item) => item.id), "cancel")}>
            {t("card.dismiss")}
          </Button>
          <span className="text-xs text-muted-foreground">{busy ? t("card.confirming") : t("card.pending")}</span>
        </div>
      ) : null}

      {requestError ? (
        <ReviewNote tone="bad" role="alert">
          {t("card.requestFailed")}
        </ReviewNote>
      ) : null}
    </section>
  );
}

type ActionsT = ReturnType<typeof useTranslations<"actions">>;

function statusLabel(t: ActionsT, status: RowStatus): string {
  if (status === "confirming") return t("card.confirming");
  return t(`card.status.${status}`);
}

/** Before → after for each changing field, as text: stored values, vocabulary translated. */
function PreviewRows({ preview }: { preview: ActionPreview }) {
  const t = useTranslations("actions");
  if (preview.rows.length === 0) return null;
  return (
    <dl className="m-0 grid grid-cols-1 gap-y-1 text-table sm:grid-cols-[auto_1fr] sm:gap-x-4">
      {preview.rows.map((row) => (
        <div key={row.field} className="contents">
          <dt className="font-mono text-micro tracking-[0.08em] text-muted-foreground uppercase">{t(`fields.${row.field}` as "fields.role")}</dt>
          <dd className="m-0 min-w-0 break-words">
            {row.before !== null ? (
              <>
                <span className="text-muted-foreground line-through decoration-muted-foreground/50">{valueText(t, row, row.before)}</span>
                <span aria-hidden="true" className="px-1.5 text-muted-foreground">
                  →
                </span>
                <span className="sr-only">{` ${t("card.after")}: `}</span>
              </>
            ) : null}
            <span className="text-foreground">{valueText(t, row, row.after)}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function valueText(t: ActionsT, row: ActionPreviewRow, value: string | null): string {
  if (value === null || value === "") return t("card.empty");
  if (!row.format) return value;
  const key = `values.${row.format}.${value}`;
  return t.has(key as "values.role.user") ? t(key as "values.role.user") : value;
}

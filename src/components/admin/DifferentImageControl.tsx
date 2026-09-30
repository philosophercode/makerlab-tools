"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { REVIEWER_NOTE_MAX_CHARS } from "../../lib/intake/limits";
import { cleanReviewerNote } from "../../lib/intake/reviewer-note";
import type { ImageRetryState } from "../../lib/research/result";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "../system/Field";
import { ReviewNote } from "../system/review/ReviewCard";

/**
 * **Find a different image** under the Product image section (amendment
 * "Product-page first, front-facing images, reviewer notes"): an optional note
 * ("a front-facing photo of the whole printer") and a button that runs the
 * research workflow's image stage again for this item alone.
 *
 * Three states, in one status line:
 *
 * - **starting** — the action is on its way;
 * - **looking** — a run is going ({@link DifferentImageControlProps.running},
 *   which the page works out from `research.imageRetry` and polls while it is
 *   true), or the action succeeded and the page has not re-rendered with the
 *   new run yet;
 * - **error** — the action refused (the day's allowance, a run already going…),
 *   or the last run failed, with its reason. The old pictures stay either way.
 *
 * The note starts as the one the last run carried, so asking again asks the
 * same thing unless it is changed.
 */

export interface DifferentImageControlProps {
  pendingId: string;
  /** `research.imageRetry` — the latest run, if any. */
  retry: ImageRetryState | null | undefined;
  /** A run is going and fresh — the page polls while this is true. */
  running: boolean;
  /** Start a run. Answers null, or a message key under `admin` (`errors.<code>`). */
  onRequest: (note: string | null) => Promise<string | null>;
}

export function DifferentImageControl({ pendingId, retry, running, onRequest }: DifferentImageControlProps) {
  const t = useTranslations("admin.intake.image");
  const tAdmin = useTranslations("admin");
  const [note, setNote] = useState(retry?.note ?? "");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The run the page showed when this one was requested: until the page shows
  // a newer one, the request is in flight as far as the reviewer can tell.
  const [requestedOver, setRequestedOver] = useState<string | null>(null);
  const awaiting = requestedOver !== null && (retry?.requestedAt ?? "") === requestedOver;
  const looking = running || awaiting;

  async function request() {
    setStarting(true);
    setError(null);
    const before = retry?.requestedAt ?? "";
    const refusal = await onRequest(cleanReviewerNote(note) || null);
    setStarting(false);
    if (refusal) {
      setError(refusal);
      return;
    }
    setRequestedOver(before);
  }

  const noteId = `intake-image-note-${pendingId}`;
  const failed = !looking && !error && retry?.status === "failed" ? retry.error : null;

  return (
    <div className="ui flex flex-col gap-2 border-t border-rule pt-2">
      <Field id={noteId} label={t("differentNote")}>
        <Textarea
          id={noteId}
          rows={2}
          maxLength={REVIEWER_NOTE_MAX_CHARS}
          placeholder={t("differentNotePlaceholder")}
          value={note}
          disabled={looking || starting}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>
      <Button size="sm" className="self-start" disabled={looking || starting} onClick={() => void request()}>
        {t("findDifferent")}
      </Button>
      <ReviewNote role="status" tone={error || failed ? "bad" : "muted"}>
        {starting ? t("differentStarting") : null}
        {!starting && looking ? t("differentRunning") : null}
        {!starting && !looking && error ? tAdmin(error) : null}
        {failed ? t("differentFailed", { reason: failed }) : null}
      </ReviewNote>
    </div>
  );
}

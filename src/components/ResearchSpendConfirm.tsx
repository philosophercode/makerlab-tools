"use client";

import { useTranslations } from "next-intl";
import { researchCostRange } from "../lib/intake/limits";
import { Button } from "@/components/ui/button";
import { ReviewNote } from "./system/review/ReviewCard";

/**
 * The confirmation before research spends anything (data platform spec
 * amendment "Many items at once"): how many items, how much of today's
 * research allowance that uses, and roughly what it costs — shown by the chat's
 * intake card and by `/admin/intake`'s **Research selected**.
 *
 * Informational: `left` was read when the surface was drawn and the route
 * checks the real allowance at the click (a `daily_limit` refusal is said by
 * the caller). Going over is warned, not blocked here — a grant may have
 * landed since. The dollar range is `RESEARCH_ESTIMATED_USD_PER_ITEM`, the
 * spec's measured figure, always worded "about".
 */

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface ResearchSpendConfirmProps {
  /** Items that cost research — add-unit items are free and not counted. */
  count: number;
  /** Items left in today's allowance, or null when it could not be read. */
  left: number | null;
  /** The request is on its way. */
  starting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ResearchSpendConfirm({ count, left, starting, onConfirm, onCancel }: ResearchSpendConfirmProps) {
  const t = useTranslations("intake.spend");
  const range = researchCostRange(count);
  const cost = `${usd.format(range.low)}–${usd.format(range.high)}`;
  const over = left !== null && count > left;
  return (
    <div role="group" aria-label={t("label")} className="flex flex-col gap-2 border border-border bg-muted/40 p-2">
      <ReviewNote tone="ink">{left === null ? t("summaryUnknown", { count, cost }) : t("summary", { count, left, cost })}</ReviewNote>
      {over ? <ReviewNote tone="bad">{t("overLimit", { left })}</ReviewNote> : null}
      <span className="flex flex-wrap gap-1">
        <Button variant="default" size="sm" disabled={starting} onClick={onConfirm}>
          {starting ? t("starting") : t("confirm", { count })}
        </Button>
        <Button variant="ghost" size="sm" disabled={starting} onClick={onCancel}>
          {t("cancel")}
        </Button>
      </span>
    </div>
  );
}

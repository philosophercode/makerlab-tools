"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

/**
 * Revoke with an inline confirmation (MCP access spec §6; DESIGN.md §8.10:
 * destructive, confirmed inline, never a modal) — the row action of both
 * `/account/tokens` tables. The owner keeps which row is confirming, so only
 * one asks at a time.
 */
export interface RevokeControlProps {
  /** The thing's name, for the labels ("Revoke Old laptop"). */
  name: string;
  /** The confirmation sentence, translated. */
  confirmText: string;
  confirming: boolean;
  busy: boolean;
  onAsk: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function RevokeControl({ name, confirmText, confirming, busy, onAsk, onConfirm, onCancel }: RevokeControlProps) {
  const t = useTranslations("account.tokens");
  if (!confirming) {
    return (
      <Button variant="destructive" size="xs" disabled={busy} aria-label={t("revokeAria", { name })} onClick={onAsk}>
        {t("revoke")}
      </Button>
    );
  }
  return (
    <div role="group" aria-label={confirmText} className="flex flex-wrap items-center justify-end gap-2 whitespace-normal">
      <span className="text-xs">{confirmText}</span>
      <Button variant="destructive" size="xs" disabled={busy} onClick={onConfirm}>
        {t("revokeYes")}
      </Button>
      <Button variant="ghost" size="xs" disabled={busy} onClick={onCancel}>
        {t("cancel")}
      </Button>
    </div>
  );
}

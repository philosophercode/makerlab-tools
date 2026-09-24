import { useTranslations } from "next-intl";
import type { ManualState } from "../../lib/data/manual-documents";

/**
 * A resource row's manual processing state in the tool editor (manual text
 * spec §5): "Text stored · 212 pages", "No text (scanned)", "Failed:
 * encrypted", or "Processing". Phase 1 stores text but does not search it yet,
 * so the ready state says what is true today — "Text stored" — rather than
 * the spec's eventual "Searchable".
 */
export function ManualStateTag({ state }: { state: ManualState }) {
  const t = useTranslations("admin.inventory.editor.manualState");
  const label = (() => {
    switch (state.state) {
      case "ready":
        return state.pageCount ? t("readyPages", { pages: state.pageCount }) : t("ready");
      case "no_text":
        return t("noText");
      case "failed":
        return t("failed", { reason: t(`reasons.${failureReason(state.reason)}`) });
      default:
        return t("processing");
    }
  })();
  return (
    <span className={`admin-tag admin-manual-state is-${state.state}`} data-manual-state={state.state}>
      {label}
    </span>
  );
}

/** The stored reason as a message key; anything unrecognised reads as "unreadable". */
function failureReason(reason: string | null): "encrypted" | "corrupt" | "too_large" {
  return reason === "encrypted" || reason === "too_large" ? reason : "corrupt";
}

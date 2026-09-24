import { useTranslations } from "next-intl";
import type { ManualState } from "../../lib/data/manual-documents";

/**
 * A resource row's manual processing state in the tool editor (manual text
 * spec §5): "Searchable · 212 pages", "Text stored · 212 pages" (ready, its
 * passages not built yet — or their embedding failed), "No text (scanned)",
 * "Failed: encrypted", or "Processing".
 */
export function ManualStateTag({ state }: { state: ManualState }) {
  const t = useTranslations("admin.inventory.editor.manualState");
  const label = (() => {
    switch (state.state) {
      case "ready":
        if (state.searchable) {
          return state.pageCount ? t("searchablePages", { pages: state.pageCount }) : t("searchable");
        }
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
    <span
      className={`admin-tag admin-manual-state is-${state.state}${state.searchable ? " is-searchable" : ""}`}
      data-manual-state={state.state === "ready" && state.searchable ? "searchable" : state.state}
    >
      {label}
    </span>
  );
}

/** The stored reason as a message key; anything unrecognised reads as "unreadable". */
function failureReason(reason: string | null): "encrypted" | "corrupt" | "too_large" {
  return reason === "encrypted" || reason === "too_large" ? reason : "corrupt";
}

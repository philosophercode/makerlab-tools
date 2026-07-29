"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useChatLauncher } from "../../../components/ChatLauncherContext";

/** Marks traffic that arrived from a label on a machine. */
export const QR_SOURCE_PARAM = "src";
export const QR_SOURCE_VALUE = "qr";

interface QrArrivalNoticeProps {
  toolName: string;
}

/**
 * Shown only when the page was reached from a QR label on a machine.
 *
 * It *surfaces* the assistant rather than opening it: someone who scanned a
 * code is overwhelmingly likely to have a question about this machine, but a
 * panel that opens by itself over the specs they came to read is an
 * interruption (spec §5). Tapping opens the chat pre-seeded for this tool.
 *
 * `?src=qr` changes presentation only — never what data the page shows.
 */
export function QrArrivalNotice({ toolName }: QrArrivalNoticeProps) {
  const searchParams = useSearchParams();
  const t = useTranslations("qr");
  const { open } = useChatLauncher();

  if (searchParams?.get(QR_SOURCE_PARAM) !== QR_SOURCE_VALUE) return null;

  return (
    // `.tool-detail` carries the detail palette (--td-*); the margin override
    // keeps this flush above the shell instead of double-spacing it.
    <div className="tool-detail" style={{ margin: "24px auto 0" }}>
      <section className="td-panel" aria-label={t("arrivalLabel")}>
        <p className="td-eyebrow">{t("arrivalEyebrow")}</p>
        <div className="td-section-title">
          <h2>{t("arrivalTitle", { tool: toolName })}</h2>
        </div>
        <p>{t("arrivalBody")}</p>
        <div className="td-actions">
          {/* Styled inline rather than with `.td-button`: that class appends an
              "↗" via ::after, which would promise navigation this does not do.
              Colors still come from the detail palette's CSS variables. */}
          <button
            type="button"
            onClick={() => open(t("arrivalSeed", { tool: toolName }))}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              height: 44,
              padding: "0 18px",
              minWidth: 140,
              borderRadius: 8,
              border: "1.5px solid var(--td-accent)",
              background: "var(--td-accent)",
              color: "#ffffff",
              fontWeight: 700,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            {t("arrivalAction")}
          </button>
        </div>
      </section>
    </div>
  );
}

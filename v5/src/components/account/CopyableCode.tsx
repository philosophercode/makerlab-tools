"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

/**
 * A block of text to paste somewhere — a token, a command, a config file —
 * with a Copy button. The clipboard can be unavailable (an insecure origin, a
 * denied permission); the text is selectable either way, so the button's
 * failure costs nothing but a click.
 */
export function CopyableCode({ label, value }: { label: string; value: string }) {
  const t = useTranslations("account");
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="account-copyable">
      <code className="account-code" aria-label={label}>
        {value}
      </code>
      <div className="account-actions">
        <button type="button" className="account-button" onClick={copy} aria-label={t("copyAria", { label })}>
          {copied ? t("copied") : t("copy")}
        </button>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A block of text to paste somewhere — a token, a command, a config file, a
 * prompt for an assistant — with a Copy button. The clipboard can be
 * unavailable (an insecure origin, a denied permission); the text is
 * selectable either way, so the button's failure costs nothing but a click.
 *
 * Long lines scroll inside the block and never widen the page (DESIGN.md §6);
 * `wrap` is for prose (the setup prompt), which wraps instead.
 */
export function CopyableCode({
  label,
  value,
  wrap = false,
  copyLabel,
}: {
  label: string;
  value: string;
  wrap?: boolean;
  /** The button's words when "Copy" is not enough ("Copy prompt"). */
  copyLabel?: string;
}) {
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
    <div data-slot="copyable" className="ui flex min-w-0 flex-col items-start gap-1.5">
      <pre
        className={cn(
          "m-0 w-full max-w-full overflow-x-auto border border-border bg-card px-3 py-2.5 font-mono text-table text-foreground",
          wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"
        )}
      >
        <code aria-label={label}>{value}</code>
      </pre>
      <Button
        type="button"
        size="sm"
        variant={copyLabel ? "outline" : "quiet"}
        onClick={copy}
        aria-label={copyLabel ? undefined : t("copyAria", { label })}
      >
        {copied ? t("copied") : (copyLabel ?? t("copy"))}
      </Button>
      <span role="status" className="sr-only">
        {copied ? t("copiedAnnounce", { label }) : ""}
      </span>
    </div>
  );
}

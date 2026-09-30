"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RowStatus } from "./RowStatus";

/**
 * **Export CSV** on `/admin/inventory` (super admins, `catalog.export`): posts
 * to `/api/admin/tools/export` and saves the file it answers with.
 *
 * `ids` absent exports every tool; given, exactly those — the selection, or the
 * rows the filters leave. The page renders this only for a viewer holding the
 * permission, but that is presentation: the route checks it again, and a
 * refusal is said here rather than swallowed.
 *
 * `fetch` + an object URL rather than a form post, so a refusal (403, 429, a
 * database that could not be read) comes back as words beside the button
 * instead of a JSON page replacing the table.
 */

export const TOOLS_EXPORT_ENDPOINT = "/api/admin/tools/export";

type ExportError = "forbidden" | "rate_limited" | "failed";

export interface ExportToolsCsvButtonProps {
  /** The tools to export; absent means every tool. */
  ids?: readonly string[];
  /** The button's words ("Export CSV", "Export CSV (3)"). */
  label: string;
  variant?: "quiet" | "default" | "ghost";
}

export function ExportToolsCsvButton({ ids, label, variant = "quiet" }: ExportToolsCsvButtonProps) {
  const t = useTranslations("admin.inventory");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ExportError | null>(null);

  async function exportCsv() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(TOOLS_EXPORT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ids ? { ids } : {}),
      });
      if (!response.ok) {
        setError(response.status === 401 || response.status === 403 ? "forbidden" : response.status === 429 ? "rate_limited" : "failed");
        return;
      }
      saveFile(await response.blob(), filenameFrom(response.headers.get("Content-Disposition")));
    } catch {
      setError("failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button variant={variant} size="sm" onClick={exportCsv} disabled={pending} aria-busy={pending || undefined}>
        <Download aria-hidden="true" />
        {pending ? t("exporting") : label}
      </Button>
      {error ? (
        <RowStatus tone="bad" role="alert">
          {t(`exportError.${error}`)}
        </RowStatus>
      ) : null}
    </span>
  );
}

/** The name the route gave the file, or a safe default. */
export function filenameFrom(disposition: string | null): string {
  const match = disposition ? /filename="([^"/\\]+)"/.exec(disposition) : null;
  return match?.[1] ?? "makerlab-tools.csv";
}

function saveFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // After the click has been handled; revoking at once can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

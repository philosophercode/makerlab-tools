"use client";

import { Download, Printer } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "../../../ui/button";

/**
 * The report's two exports (usage insight spec amendment "Value report"):
 * **Print or save as PDF** is the browser's own print dialog over the page's
 * print stylesheet (one page, no admin chrome), and **Download CSV** saves the
 * numbers the server already put in the page. Neither calls the server; there
 * is no export route to gate.
 */
export function ValueReportExport({ csv, fileName }: { csv: string; fileName: string }) {
  const t = useTranslations("admin.insights.value.actions");

  const download = () => {
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <div role="group" aria-label={t("label")} data-slot="value-report-export" className="ui flex flex-wrap items-center gap-2 print:hidden">
      <Button type="button" variant="default" onClick={() => window.print()}>
        <Printer aria-hidden="true" />
        {t("print")}
      </Button>
      <Button type="button" onClick={download}>
        <Download aria-hidden="true" />
        {t("csv")}
      </Button>
    </div>
  );
}

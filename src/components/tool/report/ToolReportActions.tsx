"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useOptionalChatLauncher } from "../../ChatLauncherContext";
import { ReportProblemButton, type ReportUnit } from "./ReportProblemButton";

/**
 * The tool page's two actions, side by side in the hero (quick report spec
 * §6; design review decisions 2026-10-07): **Report a problem**, the one
 * filled button, opens the quick report form; **Ask MakerLAB AI about this
 * machine** opens the chat on this tool, with its starter chips.
 *
 * It reads no query string, so the tool page's cached shell stays cached: a
 * unit's label preselects its unit through the arrival notice above the page,
 * which has its own Report button.
 */
export function ToolReportActions({ toolSlug, toolName, units }: { toolSlug: string; toolName: string; units: readonly ReportUnit[] }) {
  const t = useTranslations("report");
  // Optional: a page rendered without the chat (a test, a preview) still offers the report.
  const chat = useOptionalChatLauncher();

  return (
    <div data-slot="tool-report-actions" className="flex flex-col gap-2 pt-1 sm:flex-row sm:flex-wrap">
      <ReportProblemButton toolSlug={toolSlug} toolName={toolName} units={units} label={t("action")} className="h-10 px-4" />
      {chat ? (
        <Button variant="outline" className="h-10 px-4" onClick={() => chat.open()}>
          {t("ask")}
        </Button>
      ) : null}
    </div>
  );
}

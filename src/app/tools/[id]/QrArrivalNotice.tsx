"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { ToolStatus } from "../../../components/catalog-types";
import { useChatLauncher } from "../../../components/ChatLauncherContext";
import { StatusGlyph } from "../../../components/system/StatusGlyph";
import { TOOL_STATUS_KEY, TOOL_STATUS_TONE } from "../../../components/ToolCard";
// One definition of the markers a label carries, shared with everything that
// makes a code (`lib/qr/urls.ts`), so old and new labels land the same way.
import { QR_SOURCE_PARAM, QR_SOURCE_VALUE, QR_UNIT_PARAM, parseUnitToken, unitForToken } from "../../../lib/qr/urls";

/** One of the tool's units, as the notice needs it: already on the page. */
export interface ArrivalUnit {
  id: string;
  name: string;
  status: ToolStatus;
}

interface QrArrivalNoticeProps {
  toolName: string;
  /** The tool's units, so a unit label's `?unit=` can name one (QR codes spec amendment 2026-10-06). */
  units?: ArrivalUnit[];
}

/**
 * Shown when the page was reached from a QR label on a machine, or a link
 * that names one of its units.
 *
 * It *surfaces* the assistant rather than opening it: someone who scanned a
 * code is overwhelmingly likely to have a question about this machine, but a
 * panel that opens by itself over the specs they came to read is an
 * interruption (spec §5). Tapping opens the chat pre-seeded for this tool.
 *
 * A **unit's label** (`?unit=<token>`) names one machine. The notice then
 * leads with that unit and its status, and its main action is **Report a
 * problem with this unit**: the chat opens with the report already started
 * for that unit, so the ticket lands on it (`report_issue` prefers the units
 * of the tool on screen). Reporting is the main reason anyone scans a
 * machine (owner meeting 2026-10-06), so a tool label offers it too.
 *
 * `?src=qr` and `?unit=` change presentation only — never what data the page
 * shows. The unit is picked from the tool's own units, already on the page; a
 * token that matches none of them shows the tool's notice.
 */
export function QrArrivalNotice({ toolName, units = [] }: QrArrivalNoticeProps) {
  const searchParams = useSearchParams();
  const t = useTranslations("qr");
  const tStatus = useTranslations("gallery.status");
  const { open } = useChatLauncher();

  const fromLabel = searchParams?.get(QR_SOURCE_PARAM) === QR_SOURCE_VALUE;
  const unit = unitForToken(units, parseUnitToken(searchParams?.get(QR_UNIT_PARAM)));
  if (!fromLabel && !unit) return null;

  const askAction = (
    <Button variant={unit ? "quiet" : "default"} onClick={() => open(t("arrivalSeed", { tool: toolName }))}>
      {t("arrivalAction")}
    </Button>
  );

  return (
    // Above the tool page's column, the same width; the accent start rule
    // marks it as the thing waiting on the visitor (UI system phase 5a).
    <div className="ui mx-auto w-full max-w-[1200px] px-4 pt-6 sm:px-8">
      {unit ? (
        <section
          aria-label={t("arrivalUnitLabel")}
          data-qr-unit={unit.id}
          className="flex flex-col gap-3 border border-s-4 border-border border-s-primary-ink bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex min-w-0 flex-col gap-1">
            <p className="font-mono text-label tracking-[0.08em] text-muted-foreground uppercase">{t("arrivalEyebrow")}</p>
            <h2 className="font-heading text-lg font-medium uppercase">{unit.name}</h2>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span>{t("arrivalUnitOf", { tool: toolName })}</span>
              <StatusGlyph tone={TOOL_STATUS_TONE[unit.status]} label={tStatus(TOOL_STATUS_KEY[unit.status])} />
            </p>
            <p className="text-sm text-muted-foreground">{t("arrivalUnitBody")}</p>
          </div>
          <div className="flex flex-col gap-2 self-start sm:shrink-0 sm:items-stretch sm:self-auto">
            <Button variant="default" onClick={() => open(t("reportUnitSeed", { unit: unit.name, tool: toolName }))}>
              {t("reportUnitAction")}
            </Button>
            {askAction}
          </div>
        </section>
      ) : (
        <section
          aria-label={t("arrivalLabel")}
          className="flex flex-col gap-3 border border-s-4 border-border border-s-primary-ink bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex min-w-0 flex-col gap-1">
            <p className="font-mono text-label tracking-[0.08em] text-muted-foreground uppercase">{t("arrivalEyebrow")}</p>
            <h2 className="font-heading text-lg font-medium uppercase">{t("arrivalTitle", { tool: toolName })}</h2>
            <p className="text-sm text-muted-foreground">{t("arrivalBody")}</p>
          </div>
          <div className="flex flex-wrap gap-2 self-start sm:shrink-0 sm:self-auto">
            {askAction}
            <Button variant="quiet" onClick={() => open(t("reportToolSeed", { tool: toolName }))}>
              {t("reportToolAction")}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

import Link from "next/link";
import { useTranslations } from "next-intl";
import { summaryFor, type AssistantCapabilities as Data, type PageRole } from "../../lib/assistant/capabilities-page";
import { PageSection, Prose } from "../system/PublicPage";
import { StatusGlyph } from "../system/StatusGlyph";
import { CapabilityMatrix } from "./CapabilityMatrix";
import { NeverList } from "./NeverList";

const CONFIRM_NOTES = ["card", "recheck", "expiry", "outside", "reports"] as const;

/**
 * The body of `/assistant` (parity spec amendment 2026-09-29): what the viewer
 * gets, the matrix by area and role, the deny list, and how a change is
 * confirmed. Takes the generated data and the viewer's role; the page
 * resolves both. Presentational; no state.
 */
export function AssistantCapabilities({ data, viewerRole }: { data: Data; viewerRole: PageRole }) {
  const t = useTranslations("assistantPage");
  const counts = summaryFor(data, viewerRole);
  return (
    <>
      <PageSection keepCase id="assistant-for-you" title={t("forYouHeading")}>
        <div className="flex flex-col gap-1 border-s-2 border-s-primary-ink ps-3 text-sm" data-slot="for-you">
          <p>{t("forYou", { role: viewerRole })}</p>
          <p>{t("forYouCounts", counts)}</p>
          {counts.spend + counts.typedName > 0 ? <p>{t("forYouCare", counts)}</p> : null}
          {viewerRole === "anonymous" ? <p className="text-muted-foreground">{t("signInHint")}</p> : null}
        </div>
      </PageSection>

      <PageSection keepCase id="assistant-matrix" title={t("matrixHeading")} lede={t("matrixLede")}>
        <Legend />
        <CapabilityMatrix items={data.items} viewerRole={viewerRole} />
      </PageSection>

      <PageSection keepCase id="assistant-never" title={t("neverHeading")} lede={t("neverLede")}>
        <NeverList items={data.never} />
      </PageSection>

      <PageSection keepCase id="assistant-confirm" title={t("confirmHeading")}>
        <Prose>
          <ul>
            {CONFIRM_NOTES.map((key) => (
              <li key={key}>{t(`confirm.${key}`)}</li>
            ))}
          </ul>
        </Prose>
      </PageSection>

      <PageSection keepCase id="assistant-more" title={t("moreHeading")}>
        <p className="text-sm">
          <Link href="/mcp" className="text-primary-ink underline-offset-4 hover:underline">
            {t("mcpLink")}
          </Link>
          {" · "}
          <Link href="/about" className="text-primary-ink underline-offset-4 hover:underline">
            {t("aboutLink")}
          </Link>
        </p>
      </PageSection>
    </>
  );
}

function Legend() {
  const t = useTranslations("assistantPage");
  return (
    <dl aria-label={t("legendHeading")} className="flex flex-wrap gap-x-5 gap-y-1 text-micro text-muted-foreground">
      {(
        [
          ["ok", "cell.yes", "legend.read"],
          ["active", "cell.proposes", "legend.propose"],
          ["muted", "cell.no", "legend.none"],
          ["active", "mcpMode.inbox", "legend.mcpInbox"],
          ["warn", "mcpMode.direct", "legend.mcpDirect"],
        ] as const
      ).map(([tone, word, body]) => (
        <div key={body} className="flex items-baseline gap-1.5">
          <dt>
            <StatusGlyph compact={word.startsWith("cell.")} tone={tone} label={t(word)} />
          </dt>
          <dd>{t(body)}</dd>
        </div>
      ))}
    </dl>
  );
}

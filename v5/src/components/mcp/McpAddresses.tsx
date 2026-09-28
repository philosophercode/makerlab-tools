import { useTranslations } from "next-intl";
import { CopyableCode } from "../account/CopyableCode";
import { PageSection, SectionLabel } from "../system/PublicPage";

/**
 * The two MCP addresses at the top of `/mcp` (MCP access spec, amendment
 * 2026-09-25), absolute for the origin the page was requested on, each with a
 * Copy button and a line on what it is for. Side by side from `md`: they are
 * parallel things (small multiples).
 */
export function McpAddresses({ publicUrl, signedInUrl }: { publicUrl: string; signedInUrl: string }) {
  const t = useTranslations("mcpPage");
  return (
    <PageSection id="mcp-addresses-heading" title={t("addressesHeading")}>
      <div className="grid min-w-0 gap-6 md:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <SectionLabel>{t("signedInLabel")}</SectionLabel>
          <p className="text-xs text-muted-foreground">{t("signedInBody")}</p>
          <CopyableCode label={t("signedInLabel")} value={signedInUrl} />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <SectionLabel>{t("publicLabel")}</SectionLabel>
          <p className="text-xs text-muted-foreground">{t("publicBody")}</p>
          <CopyableCode label={t("publicLabel")} value={publicUrl} />
        </div>
      </div>
    </PageSection>
  );
}

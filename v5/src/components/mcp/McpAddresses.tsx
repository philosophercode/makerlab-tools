import { useTranslations } from "next-intl";
import { CopyableCode } from "../account/CopyableCode";

/**
 * The two MCP addresses at the top of `/mcp` (MCP access spec, amendment
 * 2026-09-25), absolute for the origin the page was requested on, each with a
 * Copy button and a line on what it is for.
 */
export function McpAddresses({ publicUrl, signedInUrl }: { publicUrl: string; signedInUrl: string }) {
  const t = useTranslations("mcpPage");
  return (
    <section className="account-section" aria-labelledby="mcp-addresses-heading">
      <h2 id="mcp-addresses-heading">{t("addressesHeading")}</h2>
      <div className="mcp-address">
        <h3>{t("publicLabel")}</h3>
        <p className="account-field-hint">{t("publicBody")}</p>
        <CopyableCode label={t("publicLabel")} value={publicUrl} />
      </div>
      <div className="mcp-address">
        <h3>{t("signedInLabel")}</h3>
        <p className="account-field-hint">{t("signedInBody")}</p>
        <CopyableCode label={t("signedInLabel")} value={signedInUrl} />
      </div>
    </section>
  );
}

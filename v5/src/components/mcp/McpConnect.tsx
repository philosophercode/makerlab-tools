import Link from "next/link";
import { useTranslations } from "next-intl";
import type { McpSnippets } from "../../lib/account/mcp-snippets";
import { SignInSetup } from "../account/SignInSetup";

/**
 * How to connect, on `/mcp` (MCP access spec, amendment 2026-09-25): sign in
 * with Google first — `SignInSetup`, the same component `/account/tokens` used
 * to lead with — then, for a client or script that cannot sign in, a pointer to
 * personal access tokens, which stay on `/account/tokens`.
 */
export function McpConnect({ snippets }: { snippets: McpSnippets }) {
  const t = useTranslations("mcpPage");
  return (
    <>
      <SignInSetup snippets={snippets} />
      <section className="account-section" aria-labelledby="mcp-tokens-heading">
        <h2 id="mcp-tokens-heading">{t("tokensHeading")}</h2>
        <p>{t("tokensBody")}</p>
        <p>
          <Link href="/account/tokens">{t("tokensLink")}</Link>
        </p>
      </section>
    </>
  );
}

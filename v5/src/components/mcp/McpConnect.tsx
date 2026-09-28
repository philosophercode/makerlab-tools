import Link from "next/link";
import { useTranslations } from "next-intl";
import type { McpSnippets } from "../../lib/account/mcp-snippets";
import { Button } from "@/components/ui/button";
import { SignInSetup } from "../account/SignInSetup";
import { PageSection } from "../system/PublicPage";

/**
 * How to connect, on `/mcp` (MCP access spec, amendments 2026-09-25): sign in
 * with Google first — `SignInSetup`, which opens with the copyable setup
 * prompt for the student's own AI — then, for a client or script that cannot
 * sign in, a pointer to personal access tokens, which stay on
 * `/account/tokens`.
 */
export function McpConnect({ snippets }: { snippets: McpSnippets }) {
  const t = useTranslations("mcpPage");
  return (
    <>
      <SignInSetup snippets={snippets} />
      <PageSection id="mcp-tokens-heading" title={t("tokensHeading")} lede={t("tokensBody")}>
        <div>
          <Button asChild variant="outline">
            <Link href="/account/tokens">{t("tokensLink")}</Link>
          </Button>
        </div>
      </PageSection>
    </>
  );
}

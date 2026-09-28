import { useTranslations } from "next-intl";
import type { McpSnippets } from "../../lib/account/mcp-snippets";
import { PageSection, SectionLabel } from "../system/PublicPage";
import { AiSetupPrompt } from "./AiSetupPrompt";
import { CopyableCode } from "./CopyableCode";

/**
 * "Sign in with Google" — the default way to connect an assistant (MCP access
 * spec, amendment 2026-09-24). Every client that supports OAuth for a remote
 * HTTP MCP server gets the sign-in address, and the steps for it, with no token
 * to copy or keep safe: Claude Code, Codex, Claude Desktop, claude.ai and
 * ChatGPT. Personal access tokens are the fallback below it on the page.
 *
 * It opens with **Copy setup prompt for your AI** (amendment 2026-09-25): text
 * a student pastes into their assistant so it connects itself — the sign-in
 * address first, a token only from `MAKERLAB_MCP_TOKEN`, never in the chat.
 *
 * Shown signed in or not: the client sends the person here to sign in.
 * Presentational — no state of its own.
 */
export function SignInSetup({
  snippets,
}: {
  snippets: Pick<McpSnippets, "url" | "signedInUrl" | "claudeCodeSignIn" | "codexSignIn" | "codexLogin">;
}) {
  const t = useTranslations("account.signIn");
  return (
    <PageSection id="sign-in-heading" title={t("heading")} lede={t("body")}>
      <CopyableCode label={t("addressLabel")} value={snippets.signedInUrl} />

      <div className="mt-2 border-s-2 border-s-primary-ink ps-4">
        <AiSetupPrompt snippets={snippets} variant="signIn" headingId="mcp-ai-prompt-heading" />
      </div>

      <SectionLabel>{t("claudeCodeHeading")}</SectionLabel>
      <p className="text-sm">{t("claudeCodeBody")}</p>
      <CopyableCode label={t("claudeCodeHeading")} value={snippets.claudeCodeSignIn} />
      <p className="text-sm">{t("claudeCodeThen")}</p>

      <SectionLabel>{t("codexHeading")}</SectionLabel>
      <p className="text-sm">{t("codexBody")}</p>
      <CopyableCode label={t("codexHeading")} value={snippets.codexSignIn} />
      <p className="text-sm">{t("codexAgain")}</p>
      <CopyableCode label={t("codexAgainLabel")} value={snippets.codexLogin} />

      <SectionLabel>{t("connectorsHeading")}</SectionLabel>
      <p className="text-sm">{t("connectorsBody")}</p>

      <SectionLabel>{t("chatgptHeading")}</SectionLabel>
      <p className="text-sm">{t("chatgptBody")}</p>

      <p className="text-xs text-muted-foreground">{t("readOnlyNote")}</p>
    </PageSection>
  );
}

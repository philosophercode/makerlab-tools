import { useTranslations } from "next-intl";
import type { McpSnippets } from "../../lib/account/mcp-snippets";
import { CopyableCode } from "./CopyableCode";

/**
 * "Sign in with Google" — the default way to connect an assistant (MCP access
 * spec, amendment 2026-09-24). Every client that supports OAuth for a remote
 * HTTP MCP server gets the sign-in address, and the steps for it, with no token
 * to copy or keep safe: Claude Code, Codex, Claude Desktop, claude.ai and
 * ChatGPT. Personal access tokens are the fallback below it on the page.
 *
 * Shown signed in or not: the client sends the person here to sign in.
 * Presentational — no state of its own.
 */
export function SignInSetup({ snippets }: { snippets: Pick<McpSnippets, "signedInUrl" | "claudeCodeSignIn" | "codexSignIn" | "codexLogin"> }) {
  const t = useTranslations("account.signIn");
  return (
    <section className="account-section" aria-labelledby="sign-in-heading">
      <h2 id="sign-in-heading">{t("heading")}</h2>
      <p>{t("body")}</p>
      <CopyableCode label={t("addressLabel")} value={snippets.signedInUrl} />

      <h3>{t("claudeCodeHeading")}</h3>
      <p>{t("claudeCodeBody")}</p>
      <CopyableCode label={t("claudeCodeHeading")} value={snippets.claudeCodeSignIn} />
      <p>{t("claudeCodeThen")}</p>

      <h3>{t("codexHeading")}</h3>
      <p>{t("codexBody")}</p>
      <CopyableCode label={t("codexHeading")} value={snippets.codexSignIn} />
      <p>{t("codexAgain")}</p>
      <CopyableCode label={t("codexAgainLabel")} value={snippets.codexLogin} />

      <h3>{t("connectorsHeading")}</h3>
      <p>{t("connectorsBody")}</p>

      <h3>{t("chatgptHeading")}</h3>
      <p>{t("chatgptBody")}</p>

      <p className="account-field-hint">{t("readOnlyNote")}</p>
    </section>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { MCP_TOKEN_ENV_VAR, type McpSnippets } from "../../lib/account/mcp-snippets";
import { CopyableCode } from "./CopyableCode";

/**
 * "Copy setup prompt for your AI" (MCP access spec amendment 2026-09-25): a
 * short piece of text a student pastes into Claude, ChatGPT or Codex that tells
 * the assistant how to connect itself to the MakerLab MCP server.
 *
 * - `variant="signIn"` (on `/mcp`'s Connect section): the sign-in address
 *   first; a token only as the fallback, read from `MAKERLAB_MCP_TOKEN`.
 * - `variant="token"` (on the one-time reveal): the student has just put a
 *   token in that variable, so the prompt names the open address and the
 *   variable.
 *
 * **The prompt never carries a token**, in either variant: it tells the
 * assistant to read the variable and never to ask for the token in the chat.
 */
export function AiSetupPrompt({
  snippets,
  variant,
  headingId,
}: {
  snippets: Pick<McpSnippets, "url" | "signedInUrl">;
  variant: "signIn" | "token";
  headingId: string;
}) {
  const t = useTranslations("account.aiPrompt");
  const prompt = t(variant === "signIn" ? "signInText" : "tokenText", {
    url: snippets.url,
    signedInUrl: snippets.signedInUrl,
    envVar: MCP_TOKEN_ENV_VAR,
  });
  return (
    <section aria-labelledby={headingId} data-slot="ai-setup-prompt" className="ui flex min-w-0 flex-col gap-2">
      <h3 id={headingId} className="font-mono text-label tracking-[0.08em] uppercase">
        {t("heading")}
      </h3>
      <p className="text-sm text-muted-foreground">{t(variant === "signIn" ? "signInBody" : "tokenBody")}</p>
      <CopyableCode label={t("label")} value={prompt} wrap copyLabel={t("copy")} />
    </section>
  );
}

import { Suspense } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { McpAddresses } from "../../components/mcp/McpAddresses";
import { McpConnect } from "../../components/mcp/McpConnect";
import { McpToolList } from "../../components/mcp/McpToolList";
import { McpTryIt } from "../../components/mcp/McpTryIt";
import { PublicPage } from "../../components/system/PublicPage";
import { mcpSnippets } from "../../lib/account/mcp-snippets";
import { authBaseUrl } from "../../lib/auth/config";
import { resolveIdentityFromHeaders } from "../../lib/auth/identity";
import { CAPABILITIES } from "../../lib/capabilities";
import { describeMcpTools, mcpToolNamesForRole, tryItToolNames } from "../../lib/capabilities/mcp-catalog";
import { requestOrigin } from "../../lib/request-origin";
import { runMcpTryIt } from "./actions";

/**
 * `/mcp` — the MCP server, in public (MCP access spec, amendment 2026-09-25):
 * what it is, its two addresses, every tool it offers (from the registry, by
 * audience, with the viewer's own marked), a form to try the public reads as
 * an anonymous caller, and how to connect — which, since phase 5a, comes right
 * after the addresses, with the setup prompt for the student's own AI. No sign-in needed.
 *
 * The origin and the viewer's role are request data, so everything that uses
 * them sits inside a Suspense boundary; the shell above stays static under
 * `cacheComponents`.
 */

export const metadata = {
  title: "MCP server",
  description:
    "Connect Claude, ChatGPT, Codex or another AI assistant to the lab's catalog: search the equipment, see which units are free and read the manuals.",
};

export default async function McpPage() {
  const t = await getTranslations("mcpPage");
  return (
    <PublicPage crumbs={[{ label: t("eyebrow") }]} title={t("title")} lede={t("lede")}>
      <Suspense fallback={<p className="pt-8 text-sm text-muted-foreground">{t("loading")}</p>}>
        <McpPageBody />
      </Suspense>
    </PublicPage>
  );
}

async function McpPageBody() {
  const [requestHeaders, identity, t] = await Promise.all([headers(), resolveIdentityFromHeaders(), getTranslations("mcpPage")]);
  const snippets = mcpSnippets(requestOrigin(requestHeaders) ?? authBaseUrl());

  const tools = describeMcpTools(CAPABILITIES);
  const usable = mcpToolNamesForRole(CAPABILITIES, identity.role);
  const runnable = tryItToolNames(CAPABILITIES);

  return (
    <>
      <McpAddresses publicUrl={snippets.url} signedInUrl={snippets.signedInUrl} />
      <McpConnect snippets={snippets} />
      <McpToolList tools={tools} usable={usable} viewerRole={identity.role} />
      {/* Parity spec amendment 2026-09-29: the chat's side of the same story, every role at once. */}
      <p className="pt-4 text-sm">
        <Link href="/assistant" className="text-primary-ink underline-offset-4 hover:underline">
          {t("assistantPageLink")}
        </Link>
      </p>
      <McpTryIt tools={tools.filter((tool) => runnable.has(tool.name))} runAction={runMcpTryIt} />
    </>
  );
}

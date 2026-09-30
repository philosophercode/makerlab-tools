import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { AssistantCapabilities } from "../../components/assistant/AssistantCapabilities";
import { PublicPage } from "../../components/system/PublicPage";
import { ACTIONS } from "../../lib/actions/registry";
import { buildAssistantCapabilities, pageRoleOf } from "../../lib/assistant/capabilities-page";
import { resolveIdentityFromHeaders } from "../../lib/auth/identity";
import { CAPABILITIES } from "../../lib/capabilities";

/**
 * `/assistant` — what MakerLAB AI can and can't do, by role (parity spec
 * amendment 2026-09-29). Public, no sign-in needed. Every row is generated
 * from the capability and action registries and gated by the same checks the
 * chat and MCP use (`buildAssistantCapabilities`), so it cannot drift from
 * what the assistant actually offers; the viewer's own role is highlighted.
 *
 * The viewer's role is request data, so the body sits inside a Suspense
 * boundary; the header above stays static under `cacheComponents`.
 */

export const metadata = {
  title: "What MakerLAB AI can do",
  description: "What MakerLAB AI can read, file and propose for each role, what an outside AI connected over MCP may do, and what it never does.",
};

export default async function AssistantPage() {
  const t = await getTranslations("assistantPage");
  return (
    <PublicPage keepCase crumbs={[{ label: t("eyebrow") }]} title={t("title")} lede={t("lede")}>
      <Suspense fallback={<p className="pt-8 text-sm text-muted-foreground">{t("loading")}</p>}>
        <AssistantPageBody />
      </Suspense>
    </PublicPage>
  );
}

async function AssistantPageBody() {
  const identity = await resolveIdentityFromHeaders();
  const data = buildAssistantCapabilities(CAPABILITIES, ACTIONS);
  return <AssistantCapabilities data={data} viewerRole={pageRoleOf(identity.role)} />;
}

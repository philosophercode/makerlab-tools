import { useTranslations } from "next-intl";
import { demoPassEnabled } from "../../lib/demo-pass/config";
import { siteConfig } from "../../lib/site-config";
import { DemoSignupNudgeClient } from "./DemoSignupNudgeClient";

/**
 * The root layout's sign-up notice (demo pass spec, amendment 2026-10-11). A
 * server component, so the words are rendered here and the client island
 * carries only four strings, not the whole `demoPass` namespace. Nothing at
 * all with `DEMO_PASS=off`.
 */
export function DemoSignupNudge() {
  const t = useTranslations("demoPass.callout");
  if (!demoPassEnabled()) return null;
  const assistant = siteConfig.chatAssistantName;
  return <DemoSignupNudgeClient label={t("label", { assistant })} text={t("text", { assistant })} cta={t("cta")} dismiss={t("dismiss")} />;
}

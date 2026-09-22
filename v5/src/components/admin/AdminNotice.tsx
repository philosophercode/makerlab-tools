import Link from "next/link";
import { useTranslations } from "next-intl";

/**
 * The two honest refusals every `/admin` page can give (spec §6, Article 4).
 *
 * Not a 404 and not a crash. A 404 would lie about the page existing, and an
 * error boundary would say "something went wrong" about a situation where
 * nothing did — the visitor simply is not signed in, or is signed in and does
 * not hold the permission. Those are different sentences, and only one of them
 * is actionable, so they are different states here rather than one "denied".
 *
 * A server component with no `async`: `useTranslations` resolves from the
 * request's messages, which is what keeps it renderable in a test with the
 * ordinary `NextIntlClientProvider` wrapper.
 */

export type AdminNoticeKind = "signedOut" | "forbidden";

export function AdminNotice({ kind }: { kind: AdminNoticeKind }) {
  const t = useTranslations("admin");

  return (
    <section className="admin-notice td-panel td-prose" aria-live="polite">
      <p className="td-eyebrow">{t("eyebrow")}</p>
      <h1>{t(kind === "signedOut" ? "signedOutTitle" : "forbiddenTitle")}</h1>
      <p>{t(kind === "signedOut" ? "signedOutBody" : "forbiddenBody")}</p>
      <div className="td-prose-actions">
        <Link className="td-button td-button-primary" href="/">
          {t("backToCatalog")}
        </Link>
      </div>
    </section>
  );
}

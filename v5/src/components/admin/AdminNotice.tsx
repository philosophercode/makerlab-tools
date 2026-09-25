import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { PageHeader } from "../system/PageHeader";

/**
 * The two honest refusals every `/admin` page can give (spec §6, Article 4).
 *
 * Not a 404 and not a crash. A 404 would lie about the page existing, and an
 * error boundary would say "something went wrong" about a situation where
 * nothing did — the visitor simply is not signed in, or is signed in and does
 * not hold the permission. Those are different sentences, and only one of them
 * is actionable, so they are different states here rather than one "denied".
 *
 * A `PageHeader` whose title is the page's h1 (the refusal is the page), the
 * reason as its lede, and the way back. A server component with no `async`:
 * `useTranslations` resolves from the request's messages, which keeps it
 * renderable in a test with the ordinary `NextIntlClientProvider` wrapper.
 */

export type AdminNoticeKind = "signedOut" | "forbidden";

export function AdminNotice({ kind }: { kind: AdminNoticeKind }) {
  const t = useTranslations("admin");

  return (
    <section aria-live="polite" data-slot="admin-notice" className="ui max-w-3xl">
      <PageHeader
        as="h1"
        crumbs={[{ label: t("eyebrow") }]}
        title={t(kind === "signedOut" ? "signedOutTitle" : "forbiddenTitle")}
        lede={t(kind === "signedOut" ? "signedOutBody" : "forbiddenBody")}
      />
      <Button asChild variant="default">
        <Link href="/">{t("backToCatalog")}</Link>
      </Button>
    </section>
  );
}

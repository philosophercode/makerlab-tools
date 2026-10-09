import { getTranslations } from "next-intl/server";
import { DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AdminNotice } from "../../../../components/admin/AdminNotice";
import { AdminPageHeader } from "../../../../components/admin/AdminPageHeader";
import { DemoSignupsTable, type DemoSignupRow } from "../../../../components/admin/DemoSignupsTable";
import { resolveIdentityFromHeaders } from "../../../../lib/auth/identity";
import { can } from "../../../../lib/auth/permissions";
import { listDemoSignups } from "../../../../lib/data/demo-signups";
import { demoPassBudgetUsd } from "../../../../lib/demo-pass/config";

export const metadata = {
  title: "Demo sign-ups",
};

/**
 * `/admin/users/demo-signups` — who signed up for a demo pass (demo pass spec
 * 2026-10-07 §5.6), under People: every sign-up with its answers, whether the
 * visitor may be contacted, and what their pass has spent; **Download CSV**
 * for the follow-up.
 *
 * Super admins only (`users.manage`), checked here and again by the CSV route.
 * The rows are visitors' names and emails, which is why this is the one page
 * that reads them. Read per request, never cached.
 */
export default async function DemoSignupsPage() {
  const t = await getTranslations("admin");
  const identity = await resolveIdentityFromHeaders();
  if (!can(identity, "users.manage")) return <AdminNotice kind="forbidden" />;

  const signups = await listDemoSignups();
  const budgetUsd = demoPassBudgetUsd();
  const rows: DemoSignupRow[] = signups.map((signup) => ({
    id: signup.id,
    name: signup.name,
    email: signup.email,
    institution: signup.institution,
    role: signup.role,
    runsMakerspace: signup.runsMakerspace,
    useCase: signup.useCase,
    consentToContact: signup.consentToContact,
    passActive: signup.passActive,
    passEndsOn: signup.passExpiresAt.toISOString().slice(0, 10),
    spentUsd: signup.spentUsd,
    chargedTurns: signup.chargedTurns,
    signedUpOn: signup.createdAt.toISOString().slice(0, 10),
  }));
  const consented = rows.filter((row) => row.consentToContact).length;
  const spent = rows.reduce((sum, row) => sum + row.spentUsd, 0);

  return (
    <section className="flex flex-col gap-4">
      <AdminPageHeader
        surface="users"
        item
        title={t("demoSignups.title")}
        lede={t("demoSignups.lede")}
        facts={[
          t("demoSignups.factSignups", { count: rows.length }),
          t("demoSignups.factConsented", { count: consented }),
          t("demoSignups.factSpent", { amount: `$${spent.toFixed(2)}` }),
        ]}
        actions={
          rows.length > 0 ? (
            <Button asChild size="sm">
              <a href="/api/admin/demo-signups/export" download>
                <DownloadIcon aria-hidden="true" />
                {t("demoSignups.download")}
              </a>
            </Button>
          ) : null
        }
      />
      <DemoSignupsTable rows={rows} budgetUsd={budgetUsd} />
    </section>
  );
}

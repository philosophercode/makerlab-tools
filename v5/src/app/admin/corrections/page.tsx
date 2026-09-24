import { getTranslations } from "next-intl/server";
import { AdminNotice } from "../../../components/admin/AdminNotice";
import { CorrectionsQueue } from "../../../components/admin/CorrectionsQueue";
import { resolveIdentityFromHeaders } from "../../../lib/auth/identity";
import { can } from "../../../lib/auth/permissions";
import { listFeedbackQueue } from "../../../lib/data/feedback";
import { siteConfig } from "../../../lib/site-config";
import { setCorrectionStatus } from "./actions";

/**
 * `/admin/corrections` — what people have told us is wrong (spec §5.6, §6).
 *
 * Requires `feedback.manage`, which is its own permission and not
 * `tools.edit`: reading what somebody reported and deciding what to do about
 * it is a different job from editing the record, even though the same person
 * usually does both. The refusal is said, never 404ed.
 *
 * **Nothing here is cached**, for the reason the other queues are not: a
 * correction somebody has already handled must not still be sitting at the top
 * of the list.
 *
 * The action travels down as a prop and re-checks its own permission — a server
 * action is a POST endpoint reachable without this page (§8).
 */

export const metadata = {
  title: `Corrections — ${siteConfig.name}`,
};

export default async function AdminCorrectionsPage() {
  const t = await getTranslations("admin");
  const identity = await resolveIdentityFromHeaders();

  if (!can(identity, "feedback.manage")) return <AdminNotice kind="forbidden" />;

  const corrections = await listFeedbackQueue();

  return (
    <section className="admin-section">
      <header className="admin-section-head">
        <p className="td-eyebrow">{t("eyebrow")}</p>
        <h2>{t("correctionsTitle")}</h2>
        {/* No placeholder in this string: `/admin/page.tsx` renders the same
            key without arguments, and a next-intl placeholder with no argument
            renders literally (Article 6 — this has been a real bug here). */}
        <p className="admin-lede">{t("correctionsLede")}</p>
      </header>

      <CorrectionsQueue corrections={corrections} action={setCorrectionStatus} />
    </section>
  );
}

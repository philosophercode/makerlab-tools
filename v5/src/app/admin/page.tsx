import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { resolveIdentityFromHeaders } from "../../lib/auth/identity";
import { can } from "../../lib/auth/permissions";

/**
 * `/admin` — the index the header's `AdminLink` points at.
 *
 * Phase 4 builds one surface, so this is a short list rather than the
 * `AdminHome` of spec §6 (counts, the intake queue, open tickets, mirror
 * status) — those need the tables and queues later phases add. What it must do
 * now is be honest: a SuperMaker who holds `tools.edit` but not `users.manage`
 * reaches this page, sees nothing they can open yet, and is told that, instead
 * of following a link into a refusal.
 *
 * The layout above has already established that this person may see an admin
 * surface at all.
 */

export default async function AdminHomePage() {
  const t = await getTranslations("admin");
  const identity = await resolveIdentityFromHeaders();
  const manageUsers = can(identity, "users.manage");

  return (
    <section className="admin-index td-panel td-prose">
      <p className="td-eyebrow">{t("eyebrow")}</p>
      <h2>{t("indexTitle")}</h2>

      {manageUsers ? (
        <ul className="admin-index-list">
          <li>
            <Link href="/admin/users">{t("usersTitle")}</Link>
            <span>{t("usersLede")}</span>
          </li>
        </ul>
      ) : (
        <p>{t("indexNothingYet")}</p>
      )}

      <p className="admin-index-note">{t("indexMoreComing")}</p>
    </section>
  );
}

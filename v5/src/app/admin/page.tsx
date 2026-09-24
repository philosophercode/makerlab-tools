import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { resolveIdentityFromHeaders } from "../../lib/auth/identity";
import { can, type Permission } from "../../lib/auth/permissions";

/**
 * `/admin` — the index the header's `AdminLink` points at.
 *
 * This is still a short list rather than the `AdminHome` of spec §6 (counts,
 * the intake queue, open tickets, mirror status) — those need the tables Phase
 * 6 adds. What it must do now is be honest: it lists exactly the surfaces the
 * viewer's own permissions open, so nobody follows a link into a refusal, and
 * a SuperMaker who holds `tools.edit` but not `users.manage` sees the inventory
 * and not the roster.
 *
 * The layout above has already established that this person may see an admin
 * surface at all.
 */

/**
 * Every admin page, with the permission that opens it and the two message keys
 * that name it.
 *
 * A list rather than a stack of conditionals, because it is now long enough
 * that a page added without an entry here would simply be unreachable — and
 * because each permission is checked exactly once, against the same `can()`
 * the page itself calls. The ledes are shared with each page's own header, so
 * none of them takes an argument: a next-intl placeholder rendered without one
 * renders literally, which has been a real bug here (Article 6).
 */
const SURFACES: ReadonlyArray<{ href: string; permission: Permission; key: string }> = [
  { href: "/admin/inventory", permission: "tools.edit", key: "inventory" },
  { href: "/admin/maintenance", permission: "maintenance.manage", key: "maintenance" },
  { href: "/admin/corrections", permission: "feedback.manage", key: "corrections" },
  { href: "/admin/projects", permission: "projects.moderate", key: "projects" },
  { href: "/admin/users", permission: "users.manage", key: "users" },
];

export default async function AdminHomePage() {
  const t = await getTranslations("admin");
  const identity = await resolveIdentityFromHeaders();
  const open = SURFACES.filter((surface) => can(identity, surface.permission));

  return (
    <section className="admin-index td-panel td-prose">
      <p className="td-eyebrow">{t("eyebrow")}</p>
      <h2>{t("indexTitle")}</h2>

      {open.length > 0 ? (
        <ul className="admin-index-list" aria-label={t("indexListLabel")}>
          {open.map((surface) => (
            <li key={surface.href}>
              <Link href={surface.href}>{t(`${surface.key}Title`)}</Link>
              <span>{t(`${surface.key}Lede`)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p>{t("indexNothingYet")}</p>
      )}

      <p className="admin-index-note">{t("indexMoreComing")}</p>
    </section>
  );
}

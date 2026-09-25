import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { AdminNav } from "../../components/admin/AdminNav";
import { AdminNotice } from "../../components/admin/AdminNotice";
import { ADMIN_SURFACES } from "../../lib/admin/surfaces";
import { resolveIdentityFromHeaders } from "../../lib/auth/identity";
import { can, canReachAdmin } from "../../lib/auth/permissions";
import { siteConfig } from "../../lib/site-config";

/**
 * The `/admin` shell and its front door (spec §6, §8).
 *
 * **The gate is here, once, and each page checks again.** This layout answers
 * the coarse question — may this person see an admin surface at all — so that
 * every page under it can assume a signed-in someone and check only the
 * permission it actually needs. `/admin/users` gates on `users.manage`; a
 * SuperMaker gets past this layout and is refused there, which is the honest
 * answer rather than a 404.
 *
 * **It refuses, it never throws.** No `notFound()` and no redirect: a 404 would
 * lie about the page existing and a redirect to sign-in would lose where they
 * were going. `AdminNotice` says which of the two situations this is.
 *
 * The identity read lives in its own `Suspense` boundary because
 * `cacheComponents` is enabled: reading request headers marks this subtree
 * dynamic, and the boundary is what lets the rest of the shell stay static.
 */

export const metadata = {
  title: `Admin — ${siteConfig.name}`,
};

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const t = await getTranslations("admin");

  return (
    <main className="page-shell admin-shell">
      {/* UI system spec §6.3: one compact header per surface, not an 88px
          display "ADMIN" stacked above every page's own title. The h1 stays
          for the document outline; the section bar carries the context. */}
      <h1 id="admin-title" className="sr-only">
        {t("title")}
      </h1>

      <Suspense fallback={<p className="admin-empty td-empty">{t("loading")}</p>}>
        <AdminGate>{children}</AdminGate>
      </Suspense>
    </main>
  );
}

/** Resolves who is asking, and renders the children only if they may be here. */
async function AdminGate({ children }: { children: React.ReactNode }) {
  const identity = await resolveIdentityFromHeaders();

  if (identity.role === "anonymous") return <AdminNotice kind="signedOut" />;
  if (!canReachAdmin(identity)) return <AdminNotice kind="forbidden" />;

  const items = ADMIN_SURFACES.filter((surface) => can(identity, surface.permission)).map(
    ({ key, href, group }) => ({ key, href, group })
  );

  return (
    <>
      <AdminNav items={items} />
      {children}
    </>
  );
}

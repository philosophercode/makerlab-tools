import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { AdminNav } from "../../components/admin/AdminNav";
import { AdminNotice } from "../../components/admin/AdminNotice";
import { PaletteScope } from "../../components/palette/palette-scope";
import { EmptyState } from "../../components/system/EmptyState";
import { surfacesFor } from "../../lib/admin/surfaces";
import { resolveIdentityFromHeaders } from "../../lib/auth/identity";
import { can, canReachAdmin } from "../../lib/auth/permissions";
import { listToolIndex, type ToolIndexEntry } from "../../lib/data/tool-index";
import { siteConfig } from "../../lib/site-config";

/**
 * The `/admin` shell and its front door (spec §6, §8; UI system spec §8.1).
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
 * **Past the gate, every page gets the section bar** (`AdminNav`) and the ⌘K
 * palette (the header's, told who this is by `PaletteScope`), both over `surfacesFor(identity)` — the one list in
 * `lib/admin/surfaces.ts`, filtered by the same `can()` each page calls — so
 * no admin page is reachable only through `/admin` and none of them links to
 * a refusal. The 88px display "ADMIN" that stacked above every page's own
 * title is gone (UI system spec §4.1 finding 4); an `sr-only` h1 keeps the
 * document outline, and each page's `PageHeader` title is its h2.
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
      <h1 id="admin-title" className="sr-only">
        {t("title")}
      </h1>

      <Suspense fallback={<EmptyState>{t("loading")}</EmptyState>}>
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

  const items = surfacesFor(identity).map(({ key, href, group }) => ({ key, href, group }));
  // The palette's tools. A list that cannot be read is said in the palette,
  // never an empty one that would claim the lab owns nothing (Article 4).
  let tools: ToolIndexEntry[] | null;
  try {
    tools = await listToolIndex({ includeDrafts: can(identity, "catalog.view_drafts") });
  } catch (err) {
    console.error("[admin] could not read the palette's tool list", err);
    tools = null;
  }

  return (
    <>
      {/* The header's ⌘K palette learns this viewer and the index with drafts. */}
      <PaletteScope role={identity.role} tools={tools} />
      <AdminNav items={items} />
      {children}
    </>
  );
}

import { getTranslations } from "next-intl/server";
import { AdminNotice } from "../../../components/admin/AdminNotice";
import { AdminPageHeader } from "../../../components/admin/AdminPageHeader";
import { TaxonomyBoard } from "../../../components/admin/TaxonomyBoard";
import { resolveIdentityFromHeaders } from "../../../lib/auth/identity";
import { can } from "../../../lib/auth/permissions";
import { listAdminCategories, listCategoryProposals, listToolsForTaxonomy } from "../../../lib/data/category-admin";
import { decideCategoryProposal, editCategory, mergeCategories, proposeCategory, recategorizeTool, setCategoryRetired } from "./actions";

/**
 * `/admin/taxonomy` — the category tree and the proposals waiting on it
 * (taxonomy v2 spec §5.3).
 *
 * Requires `taxonomy.manage` (admin and super admin); the refusal is said,
 * never 404ed. Nothing is cached: a proposal somebody just decided must not
 * still be offered. The actions travel down as props and re-check their own
 * permission (§8).
 */

export const metadata = {
  title: "Categories",
};

export default async function AdminTaxonomyPage() {
  const t = await getTranslations("admin");
  const identity = await resolveIdentityFromHeaders();

  if (!can(identity, "taxonomy.manage")) return <AdminNotice kind="forbidden" />;

  const [categories, proposals, tools] = await Promise.all([listAdminCategories(), listCategoryProposals(), listToolsForTaxonomy()]);
  const live = categories.filter((category) => !category.retiredAt);
  const pending = proposals.filter((proposal) => proposal.status === "pending").length;

  return (
    <section className="flex flex-col gap-4">
      <AdminPageHeader
        surface="taxonomy"
        title={t("taxonomyTitle")}
        lede={t("taxonomyLede")}
        facts={[
          t("facts.categories", { count: live.length }),
          t("facts.topLevel", { count: live.filter((category) => !category.parentId && !category.group).length }),
          t("facts.waiting", { count: pending }),
        ]}
      />
      <TaxonomyBoard
        categories={categories}
        tools={tools}
        proposals={proposals}
        actions={{
          decide: decideCategoryProposal,
          propose: proposeCategory,
          merge: mergeCategories,
          edit: editCategory,
          setRetired: setCategoryRetired,
          recategorize: recategorizeTool,
        }}
      />
    </section>
  );
}

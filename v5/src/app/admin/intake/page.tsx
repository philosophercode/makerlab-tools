import { getTranslations } from "next-intl/server";
import { AdminNotice } from "../../../components/admin/AdminNotice";
import { ImportsList } from "../../../components/admin/ImportsList";
import { IntakeList } from "../../../components/admin/IntakeList";
import { listBulkImports } from "../../../lib/data/bulk-imports";
import { IMPORT_PERMISSION } from "../../../lib/import/access";
import { toImportView, type ImportView } from "../../../lib/import/view";
import { resolveIdentityFromHeaders } from "../../../lib/auth/identity";
import { can } from "../../../lib/auth/permissions";
import { listIntakeQueue } from "../../../lib/data/pending-tools";
import { INTAKE_REVIEW_PERMISSION } from "../../../lib/intake/access";
import type { PendingToolView } from "../../../lib/intake/types";
import { toPendingToolView } from "../../../lib/intake/view";
import { siteConfig } from "../../../lib/site-config";

/**
 * `/admin/intake` — the review queue (spec §5.4 step 10, §6, Article 5).
 *
 * Requires `tools.approve`. The layout above let anyone holding an admin
 * permission through; the exact refusal happens here and is *said* — a 404
 * would claim the page does not exist, to somebody who is signed in.
 *
 * Every pending item, newest batch first: the ones identified in the chat and
 * never sent to research, the ones researching now, the ones waiting for a
 * decision, and — folded away — the most recent ones already decided. The
 * open ones are read **uncapped** (`listIntakeQueue`): however much history
 * accumulates, an item waiting for a decision is never pushed off the one page
 * that offers it. A researched item links to its preliminary page, which is
 * where approval happens.
 *
 * **Nothing here is cached.** The page exists to show research finishing, and
 * `IntakeList` asks for a fresh render every few seconds while it runs.
 *
 * **A database that cannot be reached is said, not papered over** (§6
 * States): the error line, never an empty queue that would read as "nothing
 * is waiting" and never sample data.
 */

export const metadata = {
  title: `Intake — ${siteConfig.name}`,
};

export default async function AdminIntakePage() {
  const t = await getTranslations("admin");
  const identity = await resolveIdentityFromHeaders();

  if (!can(identity, INTAKE_REVIEW_PERMISSION)) return <AdminNotice kind="forbidden" />;

  let items: PendingToolView[] | null;
  try {
    items = (await listIntakeQueue()).map(toPendingToolView);
  } catch (err) {
    console.error("[admin/intake] could not read the queue", err);
    items = null;
  }
  // The recent imports (bulk intake spec §6), each resumable from here.
  let imports: ImportView[] | null;
  try {
    imports = (await listBulkImports()).map((record) => toImportView(record));
  } catch (err) {
    console.error("[admin/intake] could not read the imports", err);
    imports = null;
  }

  return (
    <section className="admin-section">
      <header className="admin-section-head">
        <p className="td-eyebrow">{t("eyebrow")}</p>
        <h2>{t("intakeTitle")}</h2>
        {/* No placeholder in this string: `/admin/page.tsx` renders the same
            key without arguments (Article 6). */}
        <p className="admin-lede">{t("intakeLede")}</p>
      </header>

      <ImportsList imports={imports} canImport={can(identity, IMPORT_PERMISSION)} />

      {items ? (
        <IntakeList items={items} />
      ) : (
        <p className="admin-empty td-empty" role="alert">
          {t("intake.unavailable")}
        </p>
      )}
    </section>
  );
}

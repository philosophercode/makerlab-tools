import { getTranslations } from "next-intl/server";
import { AdminNotice } from "../../../../components/admin/AdminNotice";
import { IntakeList } from "../../../../components/admin/IntakeList";
import { EmptyState } from "../../../../components/system/EmptyState";
import { resolveIdentityFromHeaders } from "../../../../lib/auth/identity";
import { can } from "../../../../lib/auth/permissions";
import { listIntakeQueueSummaries } from "../../../../lib/data/pending-tools";
import { INTAKE_REVIEW_PERMISSION } from "../../../../lib/intake/access";
import { researchAllowanceLeft } from "../../../../lib/intake/allowance";
import type { PendingToolView } from "../../../../lib/intake/types";
import { summaryToPendingToolView } from "../../../../lib/intake/view";

/**
 * `/admin/intake` — Add equipment's **Queue** tab: the review queue (spec
 * §5.4 step 10, §6, Article 5). The header and the tabs are the route group's
 * layout; the recent imports moved to their own tab (UI system phase 4).
 *
 * Requires `tools.approve`. The layout above let anyone holding an admin
 * permission through; the exact refusal happens here and is *said* — a 404
 * would claim the page does not exist, to somebody who is signed in.
 *
 * Every pending item, newest batch first: the ones identified in the chat and
 * never sent to research, the ones researching now, the ones waiting for a
 * decision, and — folded away — the most recent ones already decided. The
 * open ones are read **uncapped** (`listIntakeQueueSummaries`): however much history
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
  title: "Intake",
};

export default async function AdminIntakePage() {
  const t = await getTranslations("admin");
  const identity = await resolveIdentityFromHeaders();

  if (!can(identity, INTAKE_REVIEW_PERMISSION)) return <AdminNotice kind="forbidden" />;

  let items: PendingToolView[] | null;
  try {
    // An imported row not yet sent to research is reviewed on its import's page
    // (bulk intake spec §5): four hundred of them here would bury the queue.
    // Once researched it appears here like any other item.
    // Filtered in SQL, and read without the research blobs this list never
    // shows (performance plan, "Slim the intake and refresh list queries").
    items = (await listIntakeQueueSummaries()).map(summaryToPendingToolView);
  } catch (err) {
    console.error("[admin/intake] could not read the queue", err);
    items = null;
  }

  // For **Research selected**'s confirmation only; the route checks at the click.
  const researchLeft = items ? await researchAllowanceLeft(identity.userId) : null;
  return items ? <IntakeList items={items} researchLeft={researchLeft} /> : <EmptyState tone="bad">{t("intake.unavailable")}</EmptyState>;
}

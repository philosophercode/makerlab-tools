import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { AdminNotice } from "../../../../components/admin/AdminNotice";
import { IntakeList } from "../../../../components/admin/IntakeList";
import {
  PreliminaryToolPage,
  type IntakeToolLink,
} from "../../../../components/admin/PreliminaryToolPage";
import { redoWhat, type IntakeTranslate } from "../../../../components/admin/redo-status";
import { resolveIdentityFromHeaders } from "../../../../lib/auth/identity";
import { can } from "../../../../lib/auth/permissions";
import { getPendingTool, type PendingTool } from "../../../../lib/data/pending-tools";
import {
  listCategories,
  listLocations,
  type CategoryOption,
  type LocationOption,
} from "../../../../lib/data/taxonomy";
import { findToolForEditor } from "../../../../lib/data/tools";
import { hasStalledStart, INTAKE_REVIEW_PERMISSION } from "../../../../lib/intake/access";
import { toPendingToolView } from "../../../../lib/intake/view";
import { siteConfig } from "../../../../lib/site-config";
import { ADMIN_INTAKE_PATH, type IntakeActions } from "../action-result";
import {
  addPendingUnit,
  approvePending,
  approvePendingAsDraft,
  discardPending,
  requestDifferentImage,
  savePendingIdentity,
} from "../actions";

/**
 * `/admin/intake/[id]` — one item's preliminary page (spec §5.4 steps 10–12).
 *
 * Requires `tools.approve`, refused in words like every admin page. The
 * actions travel down as props and each re-checks its own permission — a
 * server action is a POST endpoint reachable without this page (§8).
 *
 * **What renders depends on where the item is:**
 *
 * - `researched` — `PreliminaryToolPage`: the proposal, the evidence, and the
 *   buttons. An add-unit item gets the same component in its unit layout.
 * - `approved` or `discarded` — the same component, settled. Rendering the
 *   same tree is deliberate: the approval's own `revalidatePath` re-renders
 *   this page, and a page that swapped components would unmount the one
 *   holding the success line and its audit warning.
 * - anything else — a sentence naming the status, and the item as the queue
 *   shows it, with its Research or Retry control and the queue's polling. A
 *   **Research again** in progress says what it is redoing instead ("Re-researching
 *   the specs."), from the marker the press left on the stored result
 *   (`research.redoRequest`, amendment "Guided redo").
 * - no such item — a sentence and a link back, not a 404: an id that has gone
 *   is a normal thing for a queue to have in its history.
 */

export const metadata = {
  title: `Intake — ${siteConfig.name}`,
};

/** The actions `PreliminaryToolPage` receives — a `"use server"` module can export only functions. */
const ACTIONS: IntakeActions = {
  approve: approvePending,
  approveAsDraft: approvePendingAsDraft,
  addUnit: addPendingUnit,
  discard: discardPending,
  saveIdentity: savePendingIdentity,
  differentImage: requestDifferentImage,
};

/** The statuses the preliminary page itself renders. */
const ON_THE_PAGE = new Set(["researched", "approved", "discarded"]);

interface Loaded {
  item: PendingTool | null;
  categories: CategoryOption[];
  locations: LocationOption[];
}

export default async function AdminIntakeItemPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getTranslations("admin");
  const identity = await resolveIdentityFromHeaders();

  if (!can(identity, INTAKE_REVIEW_PERMISSION)) return <AdminNotice kind="forbidden" />;

  const { id } = await params;

  let loaded: Loaded | null;
  let createdTool: IntakeToolLink | null = null;
  try {
    const [item, categories, locations] = await Promise.all([
      getPendingTool(id),
      listCategories(),
      listLocations(),
    ]);
    loaded = { item, categories, locations };
    if (item?.createdToolId) {
      const tool = await findToolForEditor(item.createdToolId);
      createdTool = tool ? { name: tool.name, slug: tool.slug, published: tool.published } : null;
    }
  } catch (err) {
    console.error("[admin/intake] could not read the item", err);
    loaded = null;
  }

  const back = (
    <p>
      <Link href={ADMIN_INTAKE_PATH}>{t("intake.backToQueue")}</Link>
    </p>
  );

  if (!loaded) {
    return (
      <section className="admin-section">
        <p className="admin-empty td-empty" role="alert">
          {t("intake.unavailable")}
        </p>
        {back}
      </section>
    );
  }

  const { item, categories, locations } = loaded;
  if (!item) {
    return (
      <section className="admin-section">
        <p className="admin-empty td-empty">{t("intake.missing")}</p>
        {back}
      </section>
    );
  }

  const view = toPendingToolView(item);

  if (!ON_THE_PAGE.has(item.status)) {
    // A queued item nothing is starting is not "queued" in any sense a person
    // can wait on: say so, beside the Retry the list below offers.
    const notice = hasStalledStart(view) ? "queuedStalled" : item.status;
    const redo = item.research?.redoRequest;
    const redoing =
      notice !== "queuedStalled" &&
      (item.status === "queued" || item.status === "researching") &&
      redo != null &&
      redo.requestId === item.researchRequestId;
    const lede = redoing
      ? redoWhat((await getTranslations("admin.intake")) as unknown as IntakeTranslate, await getLocale(), redo.focus, "notice")
      : t(`intake.statusNotice.${notice}`);
    return (
      <section className="admin-section">
        <header className="admin-section-head">
          <p className="td-eyebrow">{t("intakeTitle")}</p>
          <h2>{item.name}</h2>
          <p className="admin-lede">{lede}</p>
        </header>
        <IntakeList items={[view]} />
        {back}
      </section>
    );
  }

  const match = item.duplicateOf;
  const targetTool: IntakeToolLink | null =
    match?.kind === "tool"
      ? { name: match.name, slug: match.slug, published: match.published }
      : null;

  return (
    <section className="admin-section">
      <header className="admin-section-head">
        <p className="td-eyebrow">{t("intakeTitle")}</p>
        <h2>{item.name}</h2>
        {back}
      </header>

      <PreliminaryToolPage
        key={item.id}
        item={view}
        research={item.research}
        categories={categories}
        locations={locations}
        targetTool={targetTool}
        createdTool={createdTool}
        // Hiding Approve from somebody who may only draft is presentation;
        // `approvePending` checks `tools.publish` itself.
        canPublish={can(identity, "tools.publish")}
        actions={ACTIONS}
      />
    </section>
  );
}

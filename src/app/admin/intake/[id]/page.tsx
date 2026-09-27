import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { AdminNotice } from "../../../../components/admin/AdminNotice";
import { AdminPageHeader } from "../../../../components/admin/AdminPageHeader";
import { EmptyState } from "../../../../components/system/EmptyState";
import { Button } from "@/components/ui/button";
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
import { listToolNames } from "../../../../lib/data/tool-name-clash";
import { findToolForEditor } from "../../../../lib/data/tools";
import { getDb } from "../../../../lib/db/client";
import { hasStalledStart, INTAKE_REVIEW_PERMISSION } from "../../../../lib/intake/access";
import { toPendingToolView } from "../../../../lib/intake/view";
import { siteConfig } from "../../../../lib/site-config";
import { CurateChatStarter } from "../../../../components/CurateChatStarter";
import type { ResearchResult } from "../../../../lib/research/result";
import { ADMIN_INTAKE_PATH, type IntakeActions } from "../action-result";
import { personLabel } from "../../../../components/admin/person-label";
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
  /** Every tool's display name — the Name box starts from one none has (amendment 2026-09-25). */
  takenNames: string[];
}

export default async function AdminIntakeItemPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getTranslations("admin");
  const identity = await resolveIdentityFromHeaders();

  if (!can(identity, INTAKE_REVIEW_PERMISSION)) return <AdminNotice kind="forbidden" />;

  const { id } = await params;

  let loaded: Loaded | null;
  let createdTool: IntakeToolLink | null = null;
  try {
    const [item, categories, locations, names] = await Promise.all([
      getPendingTool(id),
      listCategories(),
      listLocations(),
      getDb().then(listToolNames),
    ]);
    loaded = { item, categories, locations, takenNames: names.map((row) => row.name) };
    if (item?.createdToolId) {
      const tool = await findToolForEditor(item.createdToolId);
      createdTool = tool ? { name: tool.name, slug: tool.slug, published: tool.published } : null;
    }
  } catch (err) {
    console.error("[admin/intake] could not read the item", err);
    loaded = null;
  }

  const back = (
    <Button asChild size="sm">
      <Link href={ADMIN_INTAKE_PATH}>{t("intake.backToQueue")}</Link>
    </Button>
  );

  if (!loaded) {
    return (
      <section className="flex flex-col gap-4">
        <AdminPageHeader surface="intake" item title={t("intakeTitle")} actions={back} />
        <EmptyState tone="bad">{t("intake.unavailable")}</EmptyState>
      </section>
    );
  }

  const { item, categories, locations, takenNames } = loaded;
  if (!item) {
    return (
      <section className="flex flex-col gap-4">
        <AdminPageHeader surface="intake" item title={t("intakeTitle")} />
        <EmptyState action={back}>{t("intake.missing")}</EmptyState>
      </section>
    );
  }

  const view = toPendingToolView(item);
  const tStatus = await getTranslations("intake.status");
  const identifiedBy = personLabel(await getTranslations("admin.people"), view.createdByName, view.createdByRemoved);
  const facts = [
    tStatus(item.status),
    item.brand,
    identifiedBy ? t("intake.identifiedBy", { name: identifiedBy }) : null,
    t("intake.identifiedOn", { date: view.createdAt.slice(0, 10) }),
  ];

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
      <section className="flex flex-col gap-4">
        <AdminPageHeader surface="intake" item title={item.name} lede={lede} facts={facts} actions={back} />
        <IntakeList items={[view]} filters={false} />
      </section>
    );
  }

  const match = item.duplicateOf;
  const targetTool: IntakeToolLink | null =
    match?.kind === "tool"
      ? { name: match.name, slug: match.slug, published: match.published }
      : null;

  return (
    <section className="flex flex-col gap-4">
      <AdminPageHeader surface="intake" item title={item.name} facts={facts} actions={back} />

      {/* The assistant may curate this item for a reviewer (refresh research spec §12.3). */}
      <CurateChatStarter keys={[item.id]} />

      <PreliminaryToolPage
        // Re-keyed when the draft's own fields change, so a change accepted in
        // the chat (§12.2) shows here after the refresh it triggers.
        key={`${item.id}:${draftKey(item.research)}`}
        item={view}
        research={item.research}
        categories={categories}
        takenNames={takenNames}
        locations={locations}
        targetTool={targetTool}
        createdTool={createdTool}
        // Hiding Approve from somebody who may only draft is presentation;
        // `approvePending` checks `tools.publish` itself.
        canPublish={can(identity, "tools.publish")}
        actions={ACTIONS}
        // What a bulk import carried: units, its links, its lab documents (bulk intake spec §3.4).
        imported={
          item.importId
            ? { quantity: item.quantity, serials: item.serials, links: item.links, labDocs: item.labDocs, notes: item.notes }
            : null
        }
      />
    </section>
  );
}

/** A short fingerprint of the draft fields a chat proposal can change. */
function draftKey(research: ResearchResult | null): string {
  if (!research) return "none";
  const text = JSON.stringify([
    research.canonicalName,
    research.displayName ?? null,
    research.description,
    research.materials,
    research.tags,
    research.trainingRequired,
    research.useRestrictions,
    research.emergencyStop ?? null,
    research.resources.map((r) => r.url),
  ]);
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

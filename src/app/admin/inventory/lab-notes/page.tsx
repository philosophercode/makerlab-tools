import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AdminNotice } from "../../../../components/admin/AdminNotice";
import { AdminPageHeader } from "../../../../components/admin/AdminPageHeader";
import { LabNotesForm } from "../../../../components/admin/lab-notes/LabNotesForm";
import { EmptyState } from "../../../../components/system/EmptyState";
import { resolveIdentityFromHeaders } from "../../../../lib/auth/identity";
import { can } from "../../../../lib/auth/permissions";
import { getLabSetting, LAB_NOTES_SETTING, type LabSetting } from "../../../../lib/data/lab-settings";
import { listToolsWithLabNotes, type ToolWithLabNotes } from "../../../../lib/data/tool-lab-notes";
import { getDb } from "../../../../lib/db/client";
import { isoDay } from "../../../../lib/iso-day";
import { labNoteLines } from "../../../../lib/lab-notes/lines";
import { readLabNotesSetting } from "../../../../lib/lab-notes/setting";
import { saveLabNotes } from "./actions";

/**
 * `/admin/inventory/lab-notes` — **Lab notes** (identity spec amendment "Lab
 * notes", 2026-10-06): the one place for the lab's own knowledge.
 *
 * - **Lab-wide notes** — rules for the whole lab, one per line, which the
 *   assistant knows in every conversation. Edited here (`lab.set_notes`).
 * - **Tool lab notes** — every tool whose editor has lab notes, with the
 *   notes, linking to the tool's page (where its Edit control is). Read only
 *   here: a tool's notes are its own field.
 *
 * Requires `tools.edit`, the inventory's permission, like QR labels beside it.
 * Uncached: a review page is a picture of now. A read that fails says so
 * rather than showing an empty box somebody might save over the real notes.
 */

export const metadata = {
  title: "Lab notes",
};

export default async function AdminLabNotesPage() {
  const t = await getTranslations("admin.labNotes");
  const identity = await resolveIdentityFromHeaders();
  if (!can(identity, "tools.edit")) return <AdminNotice kind="forbidden" />;

  let setting: LabSetting | null;
  let toolNotes: ToolWithLabNotes[];
  try {
    const db = await getDb();
    [setting, toolNotes] = await Promise.all([getLabSetting(LAB_NOTES_SETTING, { db }), listToolsWithLabNotes(db)]);
  } catch (err) {
    console.error("[admin/inventory/lab-notes] could not read the lab notes", err);
    return (
      <section className="flex flex-col gap-4">
        <AdminPageHeader surface="labNotes" title={t("title")} lede={t("lede")} />
        <EmptyState tone="bad">{t("unreadable")}</EmptyState>
      </section>
    );
  }

  const text = readLabNotesSetting(setting?.value);
  const labWide = labNoteLines(text).length;

  return (
    <section className="flex flex-col gap-6">
      <AdminPageHeader
        surface="labNotes"
        title={t("title")}
        lede={t("lede")}
        facts={[
          t("factsLabWide", { count: labWide }),
          t("factsTools", { count: toolNotes.length }),
          setting && t("factsChanged", { date: isoDay(setting.updatedAt), name: setting.updatedByName ?? t("someone") }),
        ]}
      />

      <section aria-labelledby="lab-wide-heading" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 id="lab-wide-heading" className="m-0 font-heading text-lg font-medium uppercase">
            {t("labWideHeading")}
          </h3>
          <p className="m-0 max-w-[78ch] text-sm text-muted-foreground">{t("labWideLede")}</p>
        </div>
        <LabNotesForm initial={text} save={saveLabNotes} />
      </section>

      <section aria-labelledby="tool-notes-heading" data-slot="tool-lab-notes-list" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 id="tool-notes-heading" className="m-0 font-heading text-lg font-medium uppercase">
            {t("toolsHeading")}
          </h3>
          <p className="m-0 max-w-[78ch] text-sm text-muted-foreground">{t("toolsLede")}</p>
        </div>
        {toolNotes.length === 0 ? (
          <EmptyState>{t("toolsEmpty")}</EmptyState>
        ) : (
          <ul className="m-0 list-none border-t border-rule p-0 text-table">
            {toolNotes.map((tool) => (
              <li key={tool.id} className="grid gap-x-4 gap-y-1 border-b border-rule py-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
                <span className="flex flex-wrap items-baseline gap-2">
                  <Link href={`/tools/${tool.slug}`} className="font-medium text-primary-ink hover:underline">
                    {tool.name}
                  </Link>
                  {tool.published ? null : (
                    <span className="font-mono text-micro tracking-[0.08em] text-muted-foreground uppercase">{t("draft")}</span>
                  )}
                </span>
                <ul className="m-0 flex list-disc flex-col gap-0.5 ps-4">
                  {tool.lines.map((line, n) => (
                    <li key={n}>{line}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

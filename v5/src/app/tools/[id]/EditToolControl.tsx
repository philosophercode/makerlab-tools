"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ToolEditorPanel } from "../../../components/admin/ToolEditorPanel";
import type { ToolEditorActions } from "../../../components/admin/tool-editor-actions";
import { fetchIdentity, type ClientIdentity } from "../../../lib/auth/sign-in-client";
import { can } from "../../../lib/auth/permissions";

/**
 * Edit mode on a tool's own page (spec §5.3(b), §6).
 *
 * **This is the phone-first one.** A SuperMaker marking a printer out of
 * service is standing next to the machine with one hand free, so the way in is
 * a single control on the page they are already looking at — the one the QR
 * label on the machine opens — and the editor arrives as a full-screen sheet
 * rather than a panel beside something.
 *
 * **It asks who is calling after mount, and that is what keeps the page
 * cached.** The tool page is statically shelled and served from the catalogue
 * cache; reading the session during render would make it dynamic for every
 * visitor to buy a button for a handful of staff. `AdminLink` and
 * `RefreshCatalogButton` established the pattern, and `role` may be `undefined`
 * for the same reason: until `/api/identity` answers there is nothing to show.
 *
 * **Hiding is presentation.** Every action behind the panel re-checks
 * `tools.edit` for itself, because a control that is absent from the DOM is
 * absent for exactly as long as nobody calls the endpoint directly (§8).
 */

export interface EditToolControlProps {
  /** The tool's slug — what the panel's own read looks it up by. */
  slug: string;
  toolName: string;
  actions: ToolEditorActions;
}

export function EditToolControl({ slug, toolName, actions }: EditToolControlProps) {
  const t = useTranslations("admin.inventory.editor");
  const [identity, setIdentity] = useState<ClientIdentity | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetchIdentity(controller.signal).then((answer) => {
      if (!controller.signal.aborted) setIdentity(answer);
    });
    return () => controller.abort();
  }, []);

  // `identity` is null while the answer is outstanding *and* when it could not
  // be asked — both mean "no evidence this person may edit", which is the same
  // as a student as far as this control is concerned.
  if (!can(identity, "tools.edit")) return null;

  return (
    <div className="tool-edit-control">
      <button type="button" className="admin-button is-primary" onClick={() => setOpen(true)}>
        {t("editThisTool")}
      </button>

      {open ? (
        <ToolEditorPanel
          idOrSlug={slug}
          toolName={toolName}
          actions={actions}
          canPublish={can(identity, "tools.publish")}
          variant="sheet"
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

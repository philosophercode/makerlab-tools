"use client";

import { useTranslations } from "next-intl";
import type { EditableTool } from "../../lib/data/tools";

/**
 * Looks good, Publish, Unpublish, Archive and Restore (spec §5.3(3), §5.3(5)).
 *
 * The five controls that change what a tool *is* rather than what it says. Four
 * of them write an audit event, because they decide what the public catalogue
 * shows (§4.11, Article 5); the fifth — **Looks good** — is the inventory
 * review's mark and is an ordinary edit that happens to be one click.
 *
 * **Archiving is offered where deleting would be.** A tool is never deleted:
 * maintenance history, project links and printed QR labels all point at rows
 * that have to survive (§5.3 "Deleting"). An archived tool can be restored, and
 * the control to do it is the same button with the other label.
 *
 * `canPublish` hides the four state changes from somebody who only holds
 * `tools.edit`. **Hiding is presentation** — each action re-checks
 * `tools.publish` for itself, because a button that is absent from the DOM is
 * absent for exactly as long as nobody calls the endpoint directly (§8).
 */

export interface ToolStateControlsProps {
  tool: EditableTool;
  /** Whether the viewer holds `tools.publish`, as the server reported it. */
  canPublish: boolean;
  pending: boolean;
  onMarkReviewed: () => void;
  onPublish: () => void;
  onUnpublish: () => void;
  onArchive: () => void;
  onRestore: () => void;
}

export function ToolStateControls({
  tool,
  canPublish,
  pending,
  onMarkReviewed,
  onPublish,
  onUnpublish,
  onArchive,
  onRestore,
}: ToolStateControlsProps) {
  const t = useTranslations("admin.inventory.editor");
  const archived = tool.archivedAt !== null;

  return (
    <div className="admin-editor-state">
      <p className="admin-state-summary">
        <span className={`admin-state is-${stateOf(tool)}`}>
          {t(`stateName.${stateOf(tool)}`)}
        </span>
        <span className="admin-cell-note">
          {tool.lastReviewedAt
            ? t("lastReviewed", { date: isoDay(tool.lastReviewedAt) })
            : t("neverReviewed")}
        </span>
      </p>

      <div className="admin-unit-actions">
        <button
          type="button"
          className="admin-button is-primary"
          disabled={pending}
          onClick={onMarkReviewed}
        >
          {t("looksGood")}
        </button>

        {canPublish ? (
          <>
            {tool.published ? (
              <button type="button" className="admin-button" disabled={pending} onClick={onUnpublish}>
                {t("unpublish")}
              </button>
            ) : (
              <button
                type="button"
                className="admin-button"
                disabled={pending || archived}
                onClick={onPublish}
              >
                {t("publish")}
              </button>
            )}

            {archived ? (
              <button type="button" className="admin-button" disabled={pending} onClick={onRestore}>
                {t("restore")}
              </button>
            ) : (
              <button
                type="button"
                className="admin-button is-danger"
                disabled={pending}
                onClick={onArchive}
              >
                {t("archive")}
              </button>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Archived wins over published — it is the state somebody chose last. */
function stateOf(tool: EditableTool): "published" | "draft" | "archived" {
  if (tool.archivedAt !== null) return "archived";
  return tool.published ? "published" : "draft";
}

/** ISO, like every other date on this surface: it is compared, not read. */
function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

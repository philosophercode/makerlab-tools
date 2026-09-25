"use client";

import { useTranslations } from "next-intl";
import type { SetProjectPublishedAction } from "../../app/admin/projects/action-result";
import { Button } from "@/components/ui/button";
import { StatusGlyph } from "../system/StatusGlyph";
import { RowStatus } from "./RowStatus";
import { useRowAction } from "./use-row-action";

/**
 * The moderation gate's one control (spec §5.6, Article 5).
 *
 * One button whose label says what it will do, not what the row is — the badge
 * beside it says that. Two states, so a toggle is the honest shape; and it is
 * the same button in both directions because taking something down is the same
 * decision as putting it up, made again.
 *
 * Optimistic, with `useRowAction`'s contract behind it: a refusal restores the
 * previous state, a warning keeps the new one. The warning matters here more
 * than anywhere else on these three pages — this is the only queue action that
 * writes an audit event, so `audit_unavailable` is a thing it can actually
 * report, and it means *the project was published and the trail does not say
 * so* (§4.11). Restoring the button for that would be a worse lie than the
 * missing event.
 *
 * The action arrives as a prop and re-checks `projects.moderate` itself (§8).
 */

export interface PublishToggleProps {
  projectId: string;
  title: string;
  published: boolean;
  action: SetProjectPublishedAction;
}

export function PublishToggle({ projectId, title, published, action }: PublishToggleProps) {
  const t = useTranslations("admin.projects");
  const row = useRowAction<boolean>(published);

  const next = !row.value;

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-rule pt-2">
      <StatusGlyph
        tone={row.value ? "ok" : "active"}
        label={t(row.value ? "statePublished" : "stateWaiting")}
        className="me-2"
      />

      <Button
        size="xs"
        // Publishing is the one decision this card exists for; taking a
        // project down again is the quiet direction.
        variant={next ? "default" : "quiet"}
        disabled={row.pending}
        aria-label={t(next ? "publishFor" : "unpublishFor", { title })}
        onClick={() => void row.run(next, () => action({ projectId, published: next }))}
      >
        {t(next ? "publish" : "unpublish")}
      </Button>

      <RowStatus pending={row.pending} saved={row.saved} error={row.error} warning={row.warning} />
    </div>
  );
}

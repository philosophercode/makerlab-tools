"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import type { MaintenanceQueueEntry } from "../../lib/data/maintenance";
import { MAINTENANCE_PRIORITY, MAINTENANCE_STATUS } from "../../lib/db/schema/vocabulary";
import type { UpdateTicketAction } from "../../app/admin/maintenance/action-result";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "../system/Field";
import { RowStatus } from "./RowStatus";
import { useRowAction } from "./use-row-action";

/**
 * The controls on one maintenance ticket (spec §5.6).
 *
 * **Everything but the resolution saves the moment it changes.** Status,
 * priority and assignee are single clicks, and a queue of twenty tickets that
 * asks for a Save after each of them is a queue nobody clears. The resolution
 * is the exception because it is typing: it keeps a local draft and saves on
 * its own button, so a half-written sentence is never posted by a stray click
 * elsewhere on the card.
 *
 * **One draft, one status line.** The three selects share a single optimistic
 * value — the editable state of the ticket — so a refusal restores all of it
 * at once and every outcome is announced in one `role="status"` region, the
 * shape `RoleSelect` set. Each control still sends only the field it changed,
 * because a patch carrying all three would overwrite whatever somebody else
 * set from the next bench.
 *
 * The action arrives as a **prop**. A client component importing `actions.ts`
 * would drag `next/headers`, the limiter and `server-only` into its graph and
 * stop being testable, and the page that renders this already has it. Handing
 * it down is not a grant: the action checks `maintenance.manage` itself (§8).
 */

/** The part of a ticket these controls own. */
interface TicketDraft {
  status: string;
  priority: string | null;
  assignedToUserId: string | null;
}

export interface TicketControlsProps {
  ticket: MaintenanceQueueEntry;
  /** Who a ticket can be handed to — admin roles only, by name. */
  staff: ReadonlyArray<{ id: string; name: string }>;
  action: UpdateTicketAction;
}

export function TicketControls({ ticket, staff, action }: TicketControlsProps) {
  const t = useTranslations("admin.maintenance");
  const draft = useRowAction<TicketDraft>({
    status: ticket.status,
    priority: ticket.priority,
    assignedToUserId: ticket.assignedToUserId,
  });
  // The resolution is typed, so it lives outside the optimistic draft: nothing
  // may copy a server value over a box somebody is writing in, and a refused
  // save must leave the words where they are.
  const [resolution, setResolution] = useState(ticket.resolution);
  // What the server last confirmed, so the Save button can be dark until there
  // is something to save. It moves only on a landed write — an optimistic move
  // here would let a refused save look committed.
  const [committed, setCommitted] = useState(ticket.resolution);

  const { value, pending } = draft;

  function save(next: TicketDraft, patch: Parameters<UpdateTicketAction>[0]["patch"]) {
    void draft.run(next, () => action({ logId: ticket.id, patch }));
  }

  async function saveResolution() {
    const landed = await draft.run(value, () =>
      action({ logId: ticket.id, patch: { resolution } })
    );
    if (landed) setCommitted(resolution);
  }

  function assign(userId: string) {
    const person = staff.find((member) => member.id === userId);
    save(
      { ...value, assignedToUserId: person?.id ?? null },
      // The name is stored beside the id as the snapshot §4.8 asks for, so the
      // queue still says who has a ticket after that account is demoted.
      { assignedToUserId: person?.id ?? null, assignedToName: person?.name ?? null }
    );
  }

  const id = useId();

  return (
    <div className="flex flex-wrap items-end gap-3 border-t border-rule pt-2">
      <Field id={`${id}-status`} label={t("fieldStatus")}>
        <NativeSelect
          id={`${id}-status`}
          size="sm"
          value={value.status}
          disabled={pending}
          aria-label={t("statusFor", { title: ticket.title })}
          onChange={(event) => save({ ...value, status: event.target.value }, { status: event.target.value })}
        >
          {MAINTENANCE_STATUS.map((option) => (
            <option key={option} value={option}>
              {t(`status.${option}`)}
            </option>
          ))}
        </NativeSelect>
      </Field>

      <Field id={`${id}-priority`} label={t("fieldPriority")}>
        <NativeSelect
          id={`${id}-priority`}
          size="sm"
          value={value.priority ?? ""}
          disabled={pending}
          aria-label={t("priorityFor", { title: ticket.title })}
          onChange={(event) => {
            const next = event.target.value || null;
            save({ ...value, priority: next }, { priority: next });
          }}
        >
          <option value="">{t("noPriority")}</option>
          {MAINTENANCE_PRIORITY.map((option) => (
            <option key={option} value={option}>
              {t(`priority.${option}`)}
            </option>
          ))}
        </NativeSelect>
      </Field>

      <Field id={`${id}-assignee`} label={t("fieldAssignee")}>
        <NativeSelect
          id={`${id}-assignee`}
          size="sm"
          value={value.assignedToUserId ?? ""}
          disabled={pending || staff.length === 0}
          aria-label={t("assigneeFor", { title: ticket.title })}
          onChange={(event) => assign(event.target.value)}
        >
          <option value="">{t("unassigned")}</option>
          {staff.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </NativeSelect>
      </Field>

      {/* The resolution takes the rest of the row, then the whole of it on a
          phone: it is the only field here somebody writes a sentence into. */}
      <Field id={`${id}-resolution`} label={t("fieldResolution")} className="min-w-[16rem] flex-1">
        <Textarea
          id={`${id}-resolution`}
          value={resolution}
          rows={2}
          className="min-h-8 resize-y text-table"
          placeholder={t("resolutionPlaceholder")}
          aria-label={t("resolutionFor", { title: ticket.title })}
          onChange={(event) => setResolution(event.target.value)}
        />
      </Field>

      <Button size="sm" disabled={pending || resolution === committed} onClick={() => void saveResolution()}>
        {t("saveResolution")}
      </Button>

      <RowStatus pending={draft.pending} saved={draft.saved} error={draft.error} warning={draft.warning} />
    </div>
  );
}

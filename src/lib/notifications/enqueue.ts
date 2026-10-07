import { notifications } from "../db/schema/index.ts";
import type { NotificationSurface } from "../db/schema/vocabulary.ts";
import type { Db } from "../db/types.ts";
import { dedupeKeyFor, type NotificationEvent } from "./events.ts";

/**
 * Write one outbox row (email notifications spec §3.2, §4.4).
 *
 * Called **inside the caller's transaction**: `createMaintenanceLog` passes
 * its `tx`, so the ticket and its notification land together or not at all.
 * A ticket that did not land notifies nobody, and an insert that fails rolls
 * the ticket back, which `report_issue` already reports as "not filed" (§5.2,
 * §11 Q6: inside, by decision).
 *
 * `ON CONFLICT (dedupe_key) DO NOTHING`, so the same event about the same
 * subject is queued once. Null means it was already there.
 */
export interface EnqueueInput {
  event: NotificationEvent;
  subject: { type: string; id: string };
  surface?: NotificationSurface | null;
  audienceUserId?: string | null;
}

export async function enqueueNotification(tx: Db, input: EnqueueInput): Promise<{ id: string } | null> {
  const [row] = await tx
    .insert(notifications)
    .values({
      event: input.event,
      subjectType: input.subject.type,
      subjectId: input.subject.id,
      audienceUserId: input.audienceUserId ?? null,
      dedupeKey: dedupeKeyFor(input.event, input.subject.id),
      surface: input.surface ?? null,
    })
    .onConflictDoNothing({ target: notifications.dedupeKey })
    .returning({ id: notifications.id });
  return row ?? null;
}

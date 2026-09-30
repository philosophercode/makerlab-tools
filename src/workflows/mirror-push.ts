import { sleep } from "workflow";
import { MIRROR_BUSY_PAUSE, MIRROR_BUSY_RETRIES, MIRROR_COALESCE_DELAY, MIRROR_MAX_ROUNDS } from "../lib/mirror/limits.ts";
import type { MirrorPushOutcome } from "../lib/mirror/push.ts";
import {
  finishMirrorPush,
  pushMirrorRound,
  takeCoalescedMirrors,
  type MirrorPushSummary,
} from "../lib/mirror/steps.ts";

/**
 * The Notion mirror's two workflows (spec §3.8 "Push" and "Triggers").
 *
 * - {@link mirrorPush} — push one mirror now. Started by **Sync now**
 *   (`syncMirrorNow`) and by the daily cron's backstop (`runMirrorBackstop`),
 *   both through `src/lib/mirror/start.ts`.
 * - {@link mirrorPushAfterChange} — a change in the app (approving a tool,
 *   publishing, saving an edit) called `requestMirrorPush()`; sleep two
 *   minutes so a burst of edits becomes one push, then push every active
 *   mirror, one after another.
 *
 * **Rounds.** One push is bounded at 45 seconds (§3.8, `MIRROR_PUSH_BUDGET_MS`)
 * so each step stays far inside the Hobby plan's 300-second function ceiling.
 * A first sync of a real inventory is bigger than that, so a round that ran
 * out of budget with nothing failed answers `incomplete`, and the workflow
 * pauses five seconds and runs another — up to {@link MIRROR_MAX_ROUNDS}.
 * Anything left after that waits for the next trigger or the nightly
 * backstop. Every other state — `ok`, `partial`, `failed`, `skipped` — ends
 * that mirror's rounds: a failure is retried by the next trigger, not in a
 * loop here (§5.8).
 *
 * **Busy.** One exception: a round skipped as `running` — another push holds
 * the mirror — waits {@link MIRROR_BUSY_PAUSE} and claims again, up to
 * {@link MIRROR_BUSY_RETRIES} times, without spending a round. The other push
 * may have read its tables before the change that started this one, so giving
 * up would leave that change for the nightly backstop.
 *
 * **Deterministic for replay.** The body is replayed from the run's event log
 * after every step, and a replay must issue the same step calls in the same
 * order. So the mirrors are pushed sequentially in the order the step
 * returned them, nothing reads the clock or draws a random number, and there
 * is no worker pool. The steps do everything that touches the database or
 * Notion (`src/lib/mirror/steps.ts`).
 */

/** The pause between rounds of one mirror's push. */
const ROUND_PAUSE = "5s";

/** A duration `sleep` accepts, in the form `limits.ts` spells them. */
type SleepDuration = `${number}${"s" | "m" | "h"}`;

/** Push one mirror, in as many rounds as it takes (at most {@link MIRROR_MAX_ROUNDS}). */
export async function mirrorPush(mirrorId: string): Promise<MirrorPushSummary> {
  "use workflow";
  const summary = await pushInRounds(mirrorId);
  await finishMirrorPush("run", [summary]);
  return summary;
}

/**
 * Wait for a burst of edits to finish, then push every mirror that asked for
 * it. The waiting claims are taken *after* the sleep, so an edit made during
 * it rides along, and one made while the pushes run claims — and starts — the
 * next run.
 */
export async function mirrorPushAfterChange(
  delay: SleepDuration = MIRROR_COALESCE_DELAY
): Promise<{ mirrors: MirrorPushSummary[] }> {
  "use workflow";
  await sleep(delay);
  const ids = await takeCoalescedMirrors();
  const mirrors: MirrorPushSummary[] = [];
  for (const id of ids) {
    mirrors.push(await pushInRounds(id));
  }
  await finishMirrorPush("change", mirrors);
  return { mirrors };
}

/**
 * One mirror's rounds. A plain function in workflow scope, not a step.
 *
 * A round that throws has already been retried by the SDK and has released
 * its claim (`pushMirror`'s `finally`); it ends this mirror as `error` and
 * the next mirror still gets its push — one mirror's database trouble must
 * not strand another admin's.
 */
async function pushInRounds(mirrorId: string): Promise<MirrorPushSummary> {
  const summary: MirrorPushSummary = { mirrorId, rounds: 0, state: "incomplete", pushed: 0, archived: 0, failed: 0 };
  /** Rounds that did work, which {@link MIRROR_MAX_ROUNDS} bounds; `summary.rounds` counts every call. */
  let worked = 0;
  let busy = 0;
  let pause: SleepDuration | null = null;

  while (worked < MIRROR_MAX_ROUNDS) {
    if (pause) await sleep(pause);
    summary.rounds += 1;

    let outcome: MirrorPushOutcome;
    try {
      outcome = await pushMirrorRound(mirrorId);
    } catch {
      summary.state = "error";
      break;
    }

    summary.state = outcome.state;
    if (outcome.state === "skipped" && outcome.reason === "running" && busy < MIRROR_BUSY_RETRIES) {
      busy += 1;
      pause = MIRROR_BUSY_PAUSE;
      continue;
    }
    worked += 1;
    pause = ROUND_PAUSE;
    if (outcome.state === "ok" || outcome.state === "incomplete" || outcome.state === "partial") {
      summary.pushed += outcome.pushed;
      summary.archived += outcome.archived;
    }
    if (outcome.state === "partial") summary.failed += outcome.failed;
    if (outcome.state !== "incomplete") break;
  }

  return summary;
}

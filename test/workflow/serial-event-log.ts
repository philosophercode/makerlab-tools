import { beforeAll } from "vitest";
import { getWorld } from "workflow/runtime";

/**
 * The workflow tier's local world, with its event log kept append-only
 * (a setup file of `vitest.workflow.config.ts` only).
 *
 * The World contract (`@workflow/world`, `Storage`) is an append-only event
 * log, and replay depends on it: a workflow draws each step's correlation id
 * from one per-run sequence, in the order the step calls are made, and a
 * branch of a `Promise.allSettled` makes its next call when its previous
 * step's result is delivered — in event-log order. A replay matches a stored
 * step by that id and its step name only, not by its arguments.
 *
 * `@workflow/world-local` 4.x breaks the contract under concurrency.
 * `events.create` picks the event's id and timestamp — its place in the log —
 * first, then reads and writes the step's files, and only then writes the
 * event. Two steps finishing together (two stubbed searches) can land in the
 * other order: the later event is written first, a replay triggered by it
 * sees it alone and gives that item's next step the next id; when the earlier
 * event lands it sorts in front, and the following replay hands the same id —
 * and that step's stored result — to the other item. In
 * `refresh-batch.workflow.test.ts` the known tool then received the
 * unidentified tool's read (a floor check and nothing else), only under CI
 * load; with the steps further apart the replay fails outright with a
 * `ReplayDivergenceError`. No 4.x release changes this (4.4.2 is the last).
 *
 * The fix here: one `events.create` at a time per world. An event's id is then
 * picked and written before the next one's is picked, so every listing is a
 * prefix of the final log, and replays agree on every id. Steps still run
 * concurrently; only the event writes take turns. A create that rejects still
 * rejects for its caller, and does not hold up the ones behind it.
 */

const SERIALIZED = Symbol.for("makerlab.test.serialEventLog");

type Events = ReturnType<typeof getWorld>["events"] & { [SERIALIZED]?: true };

/** Make `events.create` run one call at a time, in call order. Idempotent. */
export function serializeEventCreates(events: Events): void {
  if (events[SERIALIZED]) return;
  const create = events.create.bind(events) as (...args: unknown[]) => Promise<unknown>;
  let tail: Promise<unknown> = Promise.resolve();
  events.create = ((...args: unknown[]) => {
    const created = tail.then(() => create(...args));
    tail = created.catch(() => undefined);
    return created;
  }) as Events["create"];
  events[SERIALIZED] = true;
}

// `@workflow/vitest`'s own setup file creates each test file's world. The wrap
// waits for the first hook — every setup file has run by then, and no test has
// started a run yet.
beforeAll(() => {
  serializeEventCreates(getWorld().events);
});

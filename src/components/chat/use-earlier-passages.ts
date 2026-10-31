import { useMemo } from "react";
import type { UIMessage } from "ai";
import { manualPassages, type ManualPassageRef } from "./manual-citations";

type Passages = ReadonlyMap<string, ManualPassageRef>;

const NONE: Passages = new Map();
/** One message's own passages, read once per `parts` array. */
const ownByParts = new WeakMap<object, Passages>();
/** `earlier` with `added` laid over it, built once per pair. */
const folded = new WeakMap<Passages, WeakMap<Passages, Passages>>();

function ownPassages(message: UIMessage): Passages {
  let mine = ownByParts.get(message.parts);
  if (!mine) {
    mine = manualPassages(message.parts);
    ownByParts.set(message.parts, mine);
  }
  return mine;
}

function fold(earlier: Passages, added: Passages): Passages {
  let byAdded = folded.get(earlier);
  if (!byAdded) {
    byAdded = new WeakMap();
    folded.set(earlier, byAdded);
  }
  let both = byAdded.get(added);
  if (!both) {
    // A later search's passage replaces an earlier one under the same key.
    both = new Map([...earlier, ...added]);
    byAdded.set(added, both);
  }
  return both;
}

/**
 * For each message, the manual passages earlier turns' searches returned, so a
 * follow-up answered from them (manual text spec amendment 2026-10-29) still
 * cites them as links and lists them under Sources. Keyed by message id; a
 * message with nothing earlier gets no entry.
 *
 * `ChatMessage` is memoised and only the streaming message's object changes
 * while an answer streams, so each map is built once per run of earlier
 * `parts` arrays and keeps its identity: the earlier turns are not redrawn on
 * every chunk.
 */
export function earlierPassagesByMessage(messages: readonly UIMessage[]): ReadonlyMap<string, Passages> {
  const result = new Map<string, Passages>();
  let running = NONE;
  for (const message of messages) {
    if (running.size > 0) result.set(message.id, running);
    if (message.role !== "assistant") continue;
    const mine = ownPassages(message);
    if (mine.size > 0) running = fold(running, mine);
  }
  return result;
}

export function useEarlierPassages(messages: readonly UIMessage[]): ReadonlyMap<string, Passages> {
  return useMemo(() => earlierPassagesByMessage(messages), [messages]);
}

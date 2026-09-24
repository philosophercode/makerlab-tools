import "server-only";

import { exaResultTexts, type StepLike } from "../ai/exa";
import type { Identity } from "../auth/identity";
import { can } from "../auth/permissions";
import type { CurationContext } from "../capabilities/types";
import { isUuid } from "../data/uuid";
import { loadCurationSubject, recordFields } from "../refresh/curation";
import { recordTurnHost, recordTurnText } from "./turn-sources";

/**
 * What the chat route needs for a curation turn (refresh research spec §12.3):
 * the record the page shows, **only for a caller who may curate it** —
 * `tools.approve` for a pending item (the preliminary page sends `pendingId`),
 * `tools.edit` for a tool (its page sends `toolId`, as today). Anyone else gets
 * null and the capability is never composed; a record that cannot be read is
 * null too, and the chat carries on as an ordinary turn.
 */
export async function curationForChat(
  identity: Identity,
  page: { toolId?: string | null; pendingId?: string | null }
): Promise<CurationContext | null> {
  try {
    if (page.pendingId && isUuid(page.pendingId) && can(identity, "tools.approve")) {
      return toContext(await loadCurationSubject("pending", page.pendingId));
    }
    if (page.toolId && can(identity, "tools.edit")) {
      return toContext(await loadCurationSubject("tool", decodeURIComponent(page.toolId)));
    }
  } catch (error) {
    console.warn(`[chat] curation record not loaded: ${error instanceof Error ? error.name : "error"}`);
  }
  return null;
}

function toContext(subject: Awaited<ReturnType<typeof loadCurationSubject>>): CurationContext | null {
  if (!subject) return null;
  return {
    kind: subject.kind,
    id: subject.id,
    name: subject.name,
    revision: subject.revision,
    fields: recordFields(subject.record),
    sources: subject.sources.slice(0, 30),
  };
}

/**
 * After each step, record what `exa_search` returned this turn — its text, for
 * quote verification, and its hosts, which a curation turn's `read_page` may
 * then open (§12.1, §12.2).
 */
export function recordSearchResults(turn: object, step: StepLike): void {
  for (const result of exaResultTexts([step])) {
    recordTurnText(turn, result.url, result.text);
    recordTurnHost(turn, result.url);
  }
}

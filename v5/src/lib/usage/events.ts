import type { Role } from "../auth/roles.ts";
import type { GapKind, QuestionKind, UsageAudience, UsageKind, UsageSurface } from "../db/schema/vocabulary.ts";

/**
 * One usage event as it is recorded (usage insight spec §4) — and, by
 * construction, everything about it: there is no field for a user, a session,
 * a chat, a token or an address, so there is nothing to forget to leave out.
 */
export interface UsageEvent {
  kind: UsageKind;
  surface: UsageSurface;
  audience: UsageAudience;
  toolId?: string | null;
  manualDocumentId?: string | null;
  page?: number | null;
  source?: string | null;
  questionKind?: QuestionKind | null;
  locale?: string | null;
}

/**
 * An unanswered question, before it is grouped: the scrubbed wording, why it
 * could not be answered and the tool it was about. `record.ts` upserts it into
 * `usage_gaps` and links the turn's `gap` event to the row.
 */
export interface UsageGapInput {
  kind: GapKind;
  question: string;
  toolId: string | null;
  audience: UsageAudience;
  surface: UsageSurface;
  locale?: string | null;
}

/**
 * The coarse bucket an event records instead of a person (§4): a visitor who
 * is not signed in, a signed-in member (`user`), or lab staff (`admin`,
 * `super_admin`) — whom the page leaves out by default.
 */
export function audienceFor(role: Role | null | undefined): UsageAudience {
  if (role === "admin" || role === "super_admin") return "staff";
  if (role === "user") return "member";
  return "anonymous";
}

/** A locale code short enough to be one (`en`, `pt-BR`), or null — never free text. */
export function usageLocale(locale: unknown): string | null {
  return typeof locale === "string" && /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/.test(locale) ? locale : null;
}

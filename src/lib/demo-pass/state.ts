/**
 * What a demo pass is right now (demo pass spec 2026-10-07 §5.3): its ledger
 * read against today's budget. Pure and client-safe — the chat's indicator
 * uses the same {@link DemoPassView} the routes send.
 */

/** A pass as the server reasons about it. Never carries a name or an email. */
export interface DemoPassState {
  id: string;
  budgetUsd: number;
  spentUsd: number;
  /** Budget minus spend, never below zero. */
  remainingUsd: number;
  /** Spent at or past the budget: the pass now runs at the anonymous limits. */
  exhausted: boolean;
  expiresAt: Date;
  chargedTurns: number;
}

/** The ledger columns a state is built from (`DemoPassLedger`). */
export interface DemoPassLedgerLike {
  id: string;
  passExpiresAt: Date;
  spentUsd: number;
  chargedTurns: number;
}

export function demoPassState(ledger: DemoPassLedgerLike, budgetUsd: number): DemoPassState {
  const spent = Math.max(0, ledger.spentUsd);
  return {
    id: ledger.id,
    budgetUsd,
    spentUsd: spent,
    remainingUsd: Math.max(0, roundUsd(budgetUsd - spent)),
    exhausted: spent >= budgetUsd,
    expiresAt: ledger.passExpiresAt,
    chargedTurns: ledger.chargedTurns,
  };
}

/**
 * What the browser is told about a pass: the money and the end date, and the
 * contact address the thank-you offers. No id, no name, no email.
 */
export interface DemoPassView {
  remainingUsd: number;
  budgetUsd: number;
  exhausted: boolean;
  /** ISO timestamp. */
  expiresAt: string;
  /** `DEMO_PASS_CONTACT_EMAIL`, or null: the chat then points to the About page. */
  contactEmail: string | null;
}

export function toDemoPassView(state: DemoPassState, contactEmail: string | null): DemoPassView {
  return {
    remainingUsd: state.remainingUsd,
    budgetUsd: state.budgetUsd,
    exhausted: state.exhausted,
    expiresAt: state.expiresAt.toISOString(),
    contactEmail,
  };
}

/** Dollars to the micro-dollar, the ledger's own precision. */
function roundUsd(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

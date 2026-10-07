import "server-only";

import { authSecret } from "../auth/identity";
import { getDemoPassLedger } from "../data/demo-signups";
import { demoPassBudgetUsd, demoPassEnabled } from "./config";
import { readDemoPassCookie } from "./cookie";
import { demoPassState, type DemoPassState } from "./state";
import { verifyDemoPass } from "./token";

/**
 * The demo pass a request carries, or null (demo pass spec 2026-10-07 §5.2).
 *
 * Null for every way there is no usable pass: the feature switched off
 * (`DEMO_PASS=off`), no cookie, a cookie that fails its signature or is past
 * its own expiry (no query is made for either), a row that is gone, a row past
 * `pass_expires_at`, or a database that cannot answer — in which case the
 * visitor is an ordinary anonymous one for this request (Article 4: a public
 * page must not fail because a lookup did).
 *
 * Reads the ledger only (`getDemoPassLedger`): nothing a visitor typed into
 * the sign-up form leaves the database through here.
 */
export async function resolveDemoPass(
  headers: { get(name: string): string | null },
  options: { now?: Date } = {}
): Promise<DemoPassState | null> {
  if (!demoPassEnabled()) return null;
  const now = options.now ?? new Date();
  const claim = await verifyDemoPass(readDemoPassCookie(headers), authSecret(), now);
  if (!claim) return null;
  try {
    const ledger = await getDemoPassLedger(claim.passId);
    if (!ledger || ledger.passExpiresAt.getTime() <= now.getTime()) return null;
    return demoPassState(ledger, demoPassBudgetUsd());
  } catch (err) {
    console.warn("[demo-pass] could not read a pass; treating the visitor as anonymous", err instanceof Error ? err.name : "error");
    return null;
  }
}

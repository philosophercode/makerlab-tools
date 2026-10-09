import type { Identity } from "../auth/identity";
import type { DemoPassState } from "./state";

/**
 * The identity a chat turn runs as when the visitor holds a demo pass (demo
 * pass spec 2026-10-07 §3, §5.3). Still `anonymous` to `can()` — a pass holds
 * no permission — but marked, so the limiter, `report_issue` and Usage Insight
 * can tell.
 *
 * - **Unspent:** the limiter counts the pass (`demo:<id>`), not the IP the
 *   whole conference Wi-Fi shares, and `checkRateLimit("chat")` gives it the
 *   pass's tier.
 * - **Spent:** the IP key and the anonymous tier, exactly as a visitor without
 *   a pass — but still marked, so its turns and tickets count as demo traffic.
 *
 * A signed-in caller's pass is ignored: the session is the better credential.
 */
export function identityWithDemoPass(identity: Identity, pass: DemoPassState | null): Identity {
  if (!pass || identity.role !== "anonymous") return identity;
  if (pass.exhausted) return { ...identity, demoPass: { id: pass.id, exhausted: true } };
  return { ...identity, rateLimitKey: `demo:${pass.id}`, demoPass: { id: pass.id, exhausted: false } };
}

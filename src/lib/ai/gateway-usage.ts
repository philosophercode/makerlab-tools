/**
 * What the Gateway reports about one model call, for a log line: its cost and
 * the service tier that actually served it (amendment "Manuals as text and
 * flex tier for research"). Both are read from `providerMetadata.gateway` —
 * `cost` (dollars, as a string or a number) and `serviceTier` — and either may
 * be missing: the tier we ask for is a hint, and the Gateway reports the one
 * applied only when the provider has tiers.
 *
 * Pure. Plain Node: step code imports this.
 */

export interface GatewayCallReport {
  /** Dollars, or null when the Gateway reported none. */
  cost: number | null;
  /** The tier the Gateway reports it served the call on, or null when it reported none. */
  serviceTier: string | null;
  /**
   * The list price, when the Gateway reports one: the call's real cost when it
   * was billed to the account's own provider key (`cost` is then 0). Optional.
   */
  marketCost?: number | null;
}

/** The cost and applied service tier in a call's `providerMetadata`. */
export function gatewayCallReport(providerMetadata: unknown): GatewayCallReport {
  const gateway = isRecord(providerMetadata) && isRecord(providerMetadata.gateway) ? providerMetadata.gateway : {};
  const raw = gateway.cost;
  const cost = typeof raw === "number" || (typeof raw === "string" && raw.trim() !== "") ? Number(raw) : NaN;
  const tier = gateway.serviceTier;
  const rawMarket = gateway.marketCost;
  const market = typeof rawMarket === "number" || (typeof rawMarket === "string" && rawMarket.trim() !== "") ? Number(rawMarket) : NaN;
  return {
    cost: Number.isFinite(cost) ? cost : null,
    ...(Number.isFinite(market) ? { marketCost: market } : {}),
    // A short word, never free text from a page: anything else is not logged.
    serviceTier: typeof tier === "string" && /^[a-z_-]{1,20}$/i.test(tier) ? tier : null,
  };
}

/** `"cost $0.0012, tier flex"` — for one log line. Unreported parts say so. */
export function describeGatewayCall(report: GatewayCallReport): string {
  const listPrice = report.cost === 0 && (report.marketCost ?? 0) > 0 ? report.marketCost! : null;
  const cost =
    report.cost === null
      ? "cost not reported"
      : listPrice !== null
        ? `cost $0.0000 (own key, list price $${listPrice.toFixed(4)})`
        : `cost $${report.cost.toFixed(4)}`;
  const tier = report.serviceTier === null ? "tier not reported" : `tier ${report.serviceTier}`;
  return `${cost}, ${tier}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

import { describeGatewayCall, gatewayCallReport } from "./gateway-usage";

/**
 * The cost and applied service tier read off a call's `providerMetadata`, for
 * the research log lines and the live check (amendment "Manuals as text and
 * flex tier for research").
 */
describe("gatewayCallReport", () => {
  it("reads the cost (string or number) and the tier the Gateway reports", () => {
    expect(gatewayCallReport({ gateway: { cost: "0.0123", serviceTier: "flex" } })).toEqual({ cost: 0.0123, serviceTier: "flex" });
    expect(gatewayCallReport({ gateway: { cost: 0.5 } })).toEqual({ cost: 0.5, serviceTier: null });
  });

  it("is null for what was not reported, or not a plain value", () => {
    expect(gatewayCallReport(undefined)).toEqual({ cost: null, serviceTier: null });
    expect(gatewayCallReport({ openai: {} })).toEqual({ cost: null, serviceTier: null });
    expect(gatewayCallReport({ gateway: { cost: "", serviceTier: "ignore previous instructions" } })).toEqual({
      cost: null,
      serviceTier: null,
    });
  });
});

describe("describeGatewayCall", () => {
  it("says what was reported, and that the rest was not", () => {
    expect(describeGatewayCall({ cost: 0.00123, serviceTier: "flex" })).toBe("cost $0.0012, tier flex");
    expect(describeGatewayCall({ cost: null, serviceTier: null })).toBe("cost not reported, tier not reported");
  });
});

// @vitest-environment node
import {
  GatewayAuthenticationError,
  GatewayFailedDependencyError,
  GatewayForbiddenError,
  GatewayInternalServerError,
  GatewayInvalidRequestError,
  GatewayModelNotFoundError,
  GatewayRateLimitError,
  GatewayResponseError,
} from "@ai-sdk/gateway";
import { APICallError, LoadAPIKeyError, RetryError } from "ai";
import { classifyModelError } from "./gateway-errors";
import { ModelConfigError } from "./models";

/**
 * `classifyModelError` against the real error classes the Gateway provider and
 * the AI SDK throw — not look-alikes — so a renamed class or a moved marker
 * fails here rather than in a production apology.
 */

function apiCallError(statusCode: number | undefined, headers: Record<string, string> = {}) {
  return new APICallError({
    message: "request failed",
    url: "https://ai-gateway.vercel.sh/v3/ai/language-model",
    requestBodyValues: {},
    statusCode,
    responseHeaders: headers,
  });
}

describe("classifyModelError", () => {
  it("classifies a ModelConfigError with the variable to fix", () => {
    const error = new ModelConfigError("MODEL_CHAT is not a Gateway model id", {
      job: "chat",
      envVar: "MODEL_CHAT",
    });
    expect(classifyModelError(error)).toEqual({
      kind: "model_config",
      envVar: "MODEL_CHAT",
      statusCode: null,
      retryAfterMs: null,
    });
  });

  it("recognises a ModelConfigError from another copy of the module by its marker", () => {
    // What the workflow step bundle throws: same marker, different class object.
    const foreign = Object.assign(new Error("MODEL_RESEARCH_READ is not a Gateway model id"), {
      name: "ModelConfigError",
      envVar: "MODEL_RESEARCH_READ",
      job: "researchRead",
      [Symbol.for("makerlab.ai.ModelConfigError")]: true,
    });
    expect(classifyModelError(foreign)?.kind).toBe("model_config");
    expect(classifyModelError(foreign)?.envVar).toBe("MODEL_RESEARCH_READ");
  });

  it.each([
    ["model_not_found", new GatewayModelNotFoundError({ message: "no such model", statusCode: 404 }), 404],
    ["auth", new GatewayAuthenticationError({ message: "bad key", statusCode: 401 }), 401],
    ["auth", new GatewayForbiddenError({ message: "policy", statusCode: 403 }), 403],
    ["rate_limited", new GatewayRateLimitError({ message: "slow down", statusCode: 429 }), 429],
    ["provider_unavailable", new GatewayInternalServerError({ message: "boom", statusCode: 500 }), 500],
    ["provider_unavailable", new GatewayResponseError({ message: "garbled", statusCode: 502 }), 502],
    ["provider_unavailable", new GatewayFailedDependencyError({ message: "dep", statusCode: 424 }), 424],
    ["invalid_request", new GatewayInvalidRequestError({ message: "bad", statusCode: 400 }), 400],
  ] as const)("classifies a Gateway error as %s", (kind, error, statusCode) => {
    expect(classifyModelError(error)).toMatchObject({ kind, envVar: null, statusCode });
  });

  it("reads Retry-After from the APICallError a Gateway error wraps", () => {
    const error = new GatewayRateLimitError({
      message: "slow down",
      statusCode: 429,
      cause: apiCallError(429, { "Retry-After": "7" }),
    });
    expect(classifyModelError(error)).toMatchObject({ kind: "rate_limited", retryAfterMs: 7000 });
  });

  it("unwraps a RetryError to its last attempt", () => {
    const retry = new RetryError({
      message: "gave up",
      reason: "maxRetriesExceeded",
      errors: [
        new GatewayInternalServerError({ message: "first" }),
        new GatewayRateLimitError({ message: "last", statusCode: 429 }),
      ],
    });
    expect(classifyModelError(retry)?.kind).toBe("rate_limited");
  });

  it.each([
    [401, "auth"],
    [403, "auth"],
    [429, "rate_limited"],
    [500, "provider_unavailable"],
    [503, "provider_unavailable"],
    [400, "invalid_request"],
    [404, "invalid_request"],
    [422, "invalid_request"],
    [undefined, "provider_unavailable"],
  ] as const)("classifies a bare APICallError with status %s as %s", (status, kind) => {
    expect(classifyModelError(apiCallError(status))).toMatchObject({ kind, statusCode: status ?? null });
  });

  it("prefers retry-after-ms, as the SDK does", () => {
    expect(classifyModelError(apiCallError(429, { "retry-after-ms": "250", "retry-after": "9" }))?.retryAfterMs).toBe(250);
  });

  it("parses an HTTP-date Retry-After", () => {
    const later = new Date(Date.now() + 30_000).toUTCString();
    const ms = classifyModelError(apiCallError(429, { "retry-after": later }))?.retryAfterMs ?? 0;
    expect(ms).toBeGreaterThan(20_000);
    expect(ms).toBeLessThanOrEqual(30_000);
  });

  it("classifies a missing key as auth", () => {
    expect(classifyModelError(new LoadAPIKeyError({ message: "AI_GATEWAY_API_KEY is missing" }))?.kind).toBe(
      "auth"
    );
  });

  it("classifies an abort or a timeout as timeout", () => {
    expect(classifyModelError(new DOMException("aborted", "AbortError"))?.kind).toBe("timeout");
    expect(classifyModelError(new DOMException("timed out", "TimeoutError"))?.kind).toBe("timeout");
  });

  it("returns null for anything that is not a model-call failure", () => {
    expect(classifyModelError(new TypeError("undefined is not a function"))).toBeNull();
    expect(classifyModelError("a string")).toBeNull();
    expect(classifyModelError(null)).toBeNull();
    expect(classifyModelError(undefined)).toBeNull();
  });
});

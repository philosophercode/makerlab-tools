// @vitest-environment node
import {
  GatewayAuthenticationError,
  GatewayInternalServerError,
  GatewayInvalidRequestError,
  GatewayModelNotFoundError,
  GatewayRateLimitError,
} from "@ai-sdk/gateway";
import { APICallError, RetryError } from "ai";
import { modelIdFor, ModelConfigError } from "../ai/models";
import { describeChatError } from "./describe-chat-error";

/**
 * The chat's apology for every kind of model failure (gateway spec §5.3),
 * against the real error classes — the chat error row shows this text verbatim.
 */

const FAKE_KEY = "sk-live-abcdefghijklmnop1234";
const FAKE_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ2ZXJjZWwifQ.c2lnbmF0dXJlLXZhbHVl";

function apiCallError(statusCode: number | undefined, message = "request failed", headers: Record<string, string> = {}) {
  return new APICallError({
    message,
    url: "https://ai-gateway.vercel.sh/v3/ai/language-model",
    requestBodyValues: {},
    statusCode,
    responseHeaders: headers,
  });
}

describe("describeChatError", () => {
  it("names MODEL_CHAT, never its value, when the override is malformed", () => {
    vi.stubEnv("MODEL_CHAT", FAKE_KEY);
    let thrown: unknown;
    try {
      modelIdFor("chat");
    } catch (error) {
      thrown = error;
    }
    expect(ModelConfigError.isInstance(thrown)).toBe(true);

    const message = describeChatError(thrown);
    expect(message).toContain("(MODEL_CHAT)");
    expect(message).toMatch(/not available/);
    expect(message).not.toContain(FAKE_KEY);
    expect(message).not.toContain("sk-");
  });

  it("names MODEL_CHAT for a model the Gateway does not know, without echoing the id", () => {
    const message = describeChatError(
      new GatewayModelNotFoundError({ message: "Model openai/gpt-6-lunaa not found", statusCode: 404 })
    );
    expect(message).toBe("The assistant's model is not available (MODEL_CHAT). Please let a lab admin know.");
    expect(message).not.toContain("gpt-6-lunaa");
  });

  it("says authentication failed, without the provider's text", () => {
    const message = describeChatError(
      new GatewayAuthenticationError({ message: `Invalid key ${FAKE_KEY}`, statusCode: 401 })
    );
    expect(message).toMatch(/misconfigured \(authentication with the model provider failed\)/);
    expect(message).not.toContain(FAKE_KEY);
  });

  it("asks for patience on a rate limit, with the wait the Gateway named", () => {
    expect(describeChatError(new GatewayRateLimitError({ message: "slow down", statusCode: 429 }))).toBe(
      "Too many requests right now — please wait a moment and try again."
    );
    const withWait = new GatewayRateLimitError({
      message: "slow down",
      statusCode: 429,
      cause: apiCallError(429, "slow down", { "retry-after": "12" }),
    });
    expect(describeChatError(withWait)).toContain("please wait about 12 seconds");
  });

  it("blames the provider, not the student, when it is down or overloaded", () => {
    for (const error of [
      new GatewayInternalServerError({ message: "boom", statusCode: 500 }),
      apiCallError(529, "Overloaded"),
      apiCallError(undefined, "socket hang up"),
    ]) {
      expect(describeChatError(error)).toMatch(/temporarily unavailable or overloaded \(this is on the provider's side/);
    }
  });

  it("says it timed out", () => {
    const timeout = new DOMException("The operation timed out.", "TimeoutError");
    expect(describeChatError(timeout)).toBe("The request took too long and timed out. Please try again.");
  });

  it("suggests a new chat when the provider refuses the request itself", () => {
    expect(describeChatError(new GatewayInvalidRequestError({ message: "prompt too long", statusCode: 400 }))).toMatch(
      /could not process this request\. Try starting a new chat/
    );
  });

  it("classifies a RetryError by its last attempt", () => {
    const error = new RetryError({
      message: "Failed after 3 attempts",
      reason: "maxRetriesExceeded",
      errors: [apiCallError(503), apiCallError(429)],
    });
    expect(describeChatError(error)).toMatch(/^Too many requests right now/);
  });

  it("names no provider in any apology", () => {
    const errors = [
      new GatewayModelNotFoundError({ message: "x", statusCode: 404 }),
      new GatewayAuthenticationError({ message: "x", statusCode: 401 }),
      new GatewayRateLimitError({ message: "x", statusCode: 429 }),
      new GatewayInternalServerError({ message: "x", statusCode: 500 }),
      new GatewayInvalidRequestError({ message: "x", statusCode: 400 }),
    ];
    for (const error of errors) {
      expect(describeChatError(error)).not.toMatch(/anthropic|claude|openai|gpt/i);
    }
  });

  describe("an error nobody classified", () => {
    it("passes its own message through, scrubbed of anything key-shaped", () => {
      const message = describeChatError(
        new Error(`tool blew up with ${FAKE_KEY}, Authorization: Bearer ${FAKE_JWT} and token ${FAKE_JWT}`)
      );
      expect(message).toMatch(/^Something went wrong: tool blew up with \[redacted\]/);
      expect(message).not.toContain(FAKE_KEY);
      expect(message).not.toContain(FAKE_JWT);
      expect(message).not.toContain("eyJ");
    });

    it("clips a long message to one short line", () => {
      const message = describeChatError(new Error(`first line\n${"x".repeat(500)}`));
      expect(message).not.toContain("\n");
      expect(message.length).toBeLessThan(260);
      expect(message.endsWith("…")).toBe(true);
    });

    it("falls back to a plain apology when there is no message at all", () => {
      expect(describeChatError(undefined)).toBe("Something went wrong. Please try again.");
      expect(describeChatError({})).toBe("Something went wrong. Please try again.");
    });
  });
});

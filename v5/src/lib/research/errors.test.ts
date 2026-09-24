// @vitest-environment node
import { APICallError, LoadAPIKeyError, RetryError } from "ai";
import { FatalError, RetryableError } from "workflow";
import { z } from "zod";
import { classifyResearchError, scrub } from "./errors";
import { ModelOutputError } from "./model-output";

/**
 * Which failures a research step retries and which it gives up on (spec §3.7
 * "Errors"). The message matters as much as the class: it is what
 * `research_error` will say once the workflow gives up (2026-09-22 amendment).
 */

function apiError(statusCode: number | undefined, message = "boom", headers?: Record<string, string>) {
  return new APICallError({
    message,
    url: "https://api.anthropic.com/v1/messages",
    requestBodyValues: { secret: "the whole prompt" },
    statusCode,
    responseHeaders: headers,
    responseBody: '{"type":"error"}',
  });
}

describe("classifyResearchError", () => {
  it.each([429, 500, 502, 503, 529])("retries HTTP %i from the model provider", (status) => {
    const classified = classifyResearchError(apiError(status), "search");
    expect(RetryableError.is(classified)).toBe(true);
    expect(classified.message).toContain(`HTTP ${status}`);
    expect(classified.message).toContain("Research (search)");
  });

  it("honours a 429's retry-after, within the step's budget", () => {
    const soon = classifyResearchError(apiError(429, "slow down", { "retry-after": "7" }), "fetch");
    expect(RetryableError.is(soon)).toBe(true);
    const wait = (soon as RetryableError).retryAfter.getTime() - Date.now();
    expect(wait).toBeGreaterThan(5_000);
    expect(wait).toBeLessThanOrEqual(7_000);

    const tooLong = classifyResearchError(apiError(429, "slow down", { "retry-after": "3600" }), "fetch");
    expect((tooLong as RetryableError).retryAfter.getTime() - Date.now()).toBeLessThanOrEqual(60_000);
  });

  it("retries a connection that never answered", () => {
    expect(RetryableError.is(classifyResearchError(apiError(undefined, "socket hang up"), "search"))).toBe(true);
  });

  it.each([400, 401, 403, 404, 413])("gives up on HTTP %i", (status) => {
    const classified = classifyResearchError(apiError(status, "invalid request: bad tool"), "fetch");
    expect(FatalError.is(classified)).toBe(true);
    expect(classified.message).toContain(`HTTP ${status}`);
    expect(classified.message).toContain("invalid request: bad tool");
  });

  it("judges the last error inside generateText's RetryError", () => {
    const wrapped = new RetryError({
      message: "Failed after 3 attempts",
      reason: "maxRetriesExceeded",
      errors: [apiError(500), apiError(400)],
    });
    expect(FatalError.is(classifyResearchError(wrapped, "search"))).toBe(true);
  });

  it("retries the step's own timeout — a slow provider", () => {
    const timeout = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    const abort = new DOMException("This operation was aborted", "AbortError");
    for (const error of [timeout, abort]) {
      const classified = classifyResearchError(error, "verify");
      expect(RetryableError.is(classified)).toBe(true);
      expect(classified.message).toContain("timed out");
    }
  });

  it("gives up when there is no API key", () => {
    const classified = classifyResearchError(new LoadAPIKeyError({ message: "missing ANTHROPIC_API_KEY" }), "search");
    expect(FatalError.is(classified)).toBe(true);
    expect(classified.message).toContain("no model API key");
  });

  it("gives up on an answer that does not parse, or does not fit the schema", () => {
    const unparseable = classifyResearchError(new ModelOutputError("no JSON object"), "search");
    expect(FatalError.is(unparseable)).toBe(true);
    expect(unparseable.message).toContain("no JSON object");

    const zodError = z.object({ name: z.string() }).safeParse({ name: 1 }).error;
    const invalid = classifyResearchError(zodError, "assemble");
    expect(FatalError.is(invalid)).toBe(true);
    expect(invalid.message).toContain("name");
  });

  it("classifies a fetch-style { status } error", () => {
    expect(RetryableError.is(classifyResearchError(Object.assign(new Error("x"), { status: 503 }), "verify"))).toBe(
      true
    );
    expect(FatalError.is(classifyResearchError(Object.assign(new Error("x"), { status: 404 }), "verify"))).toBe(true);
  });

  it("passes an already-classified error through unchanged", () => {
    const fatal = new FatalError("already decided");
    const retryable = new RetryableError("try later");
    expect(classifyResearchError(fatal, "search")).toBe(fatal);
    expect(classifyResearchError(retryable, "search")).toBe(retryable);
  });

  it("treats an unknown error as fatal, so a bug does not burn three attempts", () => {
    const classified = classifyResearchError(new TypeError("cannot read properties of undefined"), "fetch");
    expect(FatalError.is(classified)).toBe(true);
    expect(classified.message).toContain("cannot read properties of undefined");
  });

  it("keeps the message short, one line, and free of the request and of keys", () => {
    const noisy = apiError(400, `bad key sk-ant-api03-${"x".repeat(40)}\n\n${"detail ".repeat(100)}`);
    const { message } = classifyResearchError(noisy, "search");
    expect(message).not.toContain("sk-ant");
    expect(message).not.toContain("\n");
    expect(message).not.toContain("the whole prompt");
    expect(message.length).toBeLessThan(260);
  });
});

describe("scrub", () => {
  it("removes key-shaped text and bearer tokens", () => {
    expect(scrub("key sk-ant-abcdefghijklmnop failed")).toBe("key [redacted] failed");
    expect(scrub("Authorization: Bearer abc.def")).toBe("Authorization: Bearer [redacted]");
    expect(scrub("x-api-key: 12345")).toBe("x-api-key [redacted]");
  });
});

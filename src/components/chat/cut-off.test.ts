import { describe, expect, it } from "vitest";
import { isCutOff } from "./cut-off";

const base = { isAbort: false, isDisconnect: false, isError: false };

describe("isCutOff", () => {
  it("is false for a normal finish", () => {
    expect(isCutOff({ ...base, finishReason: "stop" })).toBe(false);
  });
  it("is true when the stream ended with no finish reason (the function timed out)", () => {
    expect(isCutOff({ ...base })).toBe(true);
  });
  it("is true on a network disconnect", () => {
    expect(isCutOff({ ...base, isDisconnect: true, finishReason: "stop" })).toBe(true);
  });
  it("is false when the person stopped it, or an error is shown instead", () => {
    expect(isCutOff({ ...base, isAbort: true })).toBe(false);
    expect(isCutOff({ ...base, isError: true })).toBe(false);
  });
});

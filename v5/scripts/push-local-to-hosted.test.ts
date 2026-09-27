// @vitest-environment node
import { describeError, parseArgs } from "./push-local-to-hosted.ts";

/** The command line of `npm run data:push`; the work itself is tested in src/lib/push-hosted/. */

describe("parseArgs", () => {
  it("reads the target file and the flags", () => {
    expect(parseArgs(["--to", ".env.hosted", "--dry-run"])).toEqual({
      to: ".env.hosted",
      dryRun: true,
      yes: false,
      allowMissingFiles: false,
    });
    expect(parseArgs(["--to=.env.hosted", "--yes", "--allow-missing-files"])).toMatchObject({
      to: ".env.hosted",
      yes: true,
      allowMissingFiles: true,
    });
  });

  it("rejects anything else", () => {
    expect(() => parseArgs(["--force"])).toThrow(/Unknown argument/);
  });
});

describe("describeError", () => {
  it("finds a message on an Error, a wrapped error or a cause", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
    expect(describeError({ type: "error", error: new TypeError("socket closed") })).toBe("socket closed");
    expect(describeError(new Error("", { cause: { code: "ECONNREFUSED" } }))).toBe("ECONNREFUSED");
  });

  it("falls back to a sentence when a connection failure carries nothing", () => {
    expect(describeError({ type: "error", message: "", error: new TypeError("") })).toMatch(/could not connect/);
  });
});

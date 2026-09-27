import type { EvalCase } from "./cases";
import { evalFixture } from "./fixtures";
import {
  formatReport,
  runCase,
  runSuite,
  type CaseExecution,
  type CaseExecutor,
} from "./runner";

// The runner's control flow — retry, flaky classification, reporting — verified
// against a **stubbed model response** (design spec §10). No API key, no model
// call, no cost: the executor is injected, which is the whole reason it is a
// parameter.

function testCase(overrides: Partial<EvalCase> = {}): EvalCase {
  return {
    id: "laser-by-capability",
    prompt: "I need to cut 3mm acrylic. What should I use?",
    context: {},
    assert: [{ kind: "mentions_tool", value: "Trotec Speedy 400" }],
    file: "t.yaml",
    ...overrides,
  };
}

function stubModel(...answers: string[]): CaseExecutor {
  let call = 0;
  return async (): Promise<CaseExecution> => {
    const text = answers[Math.min(call, answers.length - 1)];
    call++;
    return { text, toolCalls: [], usage: { inputTokens: 100, outputTokens: 20 } };
  };
}

describe("runCase", () => {
  it("passes on the first attempt without retrying", async () => {
    const executor = vi.fn(stubModel("Use the Trotec Speedy 400."));
    const result = await runCase(testCase(), executor, evalFixture);

    expect(result.status).toBe("pass");
    expect(result.attempts).toHaveLength(1);
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it("reports FLAKY — never a pass — when a case only passes on retry", async () => {
    const executor = vi.fn(stubModel("Use a laser cutter.", "Use the Trotec Speedy 400."));
    const result = await runCase(testCase(), executor, evalFixture);

    expect(result.status).toBe("flaky");
    expect(result.attempts).toHaveLength(2);
    expect(executor).toHaveBeenCalledTimes(2);
  });

  it("retries once and then fails", async () => {
    const executor = vi.fn(stubModel("Use a laser cutter."));
    const result = await runCase(testCase(), executor, evalFixture);

    expect(result.status).toBe("fail");
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0].assertions[0].detail).toContain("Trotec Speedy 400");
  });

  it("records an executor throw as an error rather than crashing the run", async () => {
    const executor: CaseExecutor = async () => {
      throw new Error("529 overloaded");
    };
    const result = await runCase(testCase(), executor, evalFixture);

    expect(result.status).toBe("error");
    expect(result.attempts[0].error).toContain("529");
  });

  it("runs every assertion of a case, not just the first", async () => {
    const evalCase = testCase({
      assert: [
        { kind: "mentions_tool", value: "Trotec Speedy 400" },
        { kind: "no_unknown_tools" },
      ],
    });
    const result = await runCase(
      evalCase,
      stubModel("Use the Trotec Speedy 400, or the Glowforge Pro."),
      evalFixture
    );

    expect(result.status).toBe("fail");
    expect(result.attempts[0].assertions.map((a) => a.ok)).toEqual([true, false]);
  });

  it("scopes spec assertions to the focused machine", async () => {
    const evalCase = testCase({
      context: { page: "tool", toolId: "form-4" },
      assert: [{ kind: "no_fabricated_specs", fields: ["build_volume"] }],
    });
    const result = await runCase(
      evalCase,
      stubModel("The build volume is 145 x 145 x 185 mm."),
      evalFixture
    );

    expect(result.status).toBe("fail");
    expect(result.attempts[0].assertions[0].detail).toContain("145");
  });
});

describe("runSuite", () => {
  const passing = testCase();
  const failing = testCase({
    id: "bambu-printer-absent",
    assert: [{ kind: "no_unknown_tools" }],
  });

  it("summarizes totals, usage and overall status", async () => {
    const report = await runSuite(
      [passing, failing],
      stubModel("Use the Trotec Speedy 400 — not the Bambu Lab X1-Carbon we do not have."),
      evalFixture
    );

    expect(report.totals).toMatchObject({ total: 2, passed: 2, failed: 0 });
    expect(report.ok).toBe(true);
    // Two cases, one attempt each, at the stub's 100/20 tokens.
    expect(report.usage).toEqual({ inputTokens: 200, outputTokens: 40 });
  });

  it("is not ok when a case fails, and reports each case as it finishes", async () => {
    const seen: string[] = [];
    const report = await runSuite([passing, failing], stubModel("Try the Glowforge Pro."), evalFixture, {
      onCase: (result) => seen.push(`${result.id}:${result.status}`),
    });

    expect(report.ok).toBe(false);
    expect(report.totals.failed).toBe(2);
    expect(seen).toEqual(["laser-by-capability:fail", "bambu-printer-absent:fail"]);
  });

  it("stays ok when a case is merely flaky", async () => {
    const report = await runSuite(
      [passing],
      stubModel("Use a laser cutter.", "Use the Trotec Speedy 400."),
      evalFixture
    );

    expect(report.totals).toMatchObject({ flaky: 1, passed: 0, failed: 0 });
    expect(report.ok).toBe(true);
  });
});

describe("formatReport", () => {
  it("prints the prompt, the assertion, why it failed and the answer", async () => {
    const report = await runSuite([testCase()], stubModel("Use a laser cutter."), evalFixture);
    const output = formatReport(report);

    expect(output).toContain("FAIL  laser-by-capability");
    expect(output).toContain("prompt: I need to cut 3mm acrylic");
    expect(output).toContain("mentions_tool");
    expect(output).toContain('never mentions "Trotec Speedy 400"');
    expect(output).toContain("full answer: Use a laser cutter.");
    expect(output).toContain("0/1 passed · 0 flaky · 1 failed · 0 errored");
  });

  it("marks a flaky case as flaky in the summary line", async () => {
    const report = await runSuite(
      [testCase()],
      stubModel("Use a laser cutter.", "Use the Trotec Speedy 400."),
      evalFixture
    );
    const output = formatReport(report);

    expect(output).toContain("FLAKY laser-by-capability");
    expect(output).toContain("passed on retry");
  });
});

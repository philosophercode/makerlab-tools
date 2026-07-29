import { nextCacheMock } from "../test/mocks/next-cache";
import { CAPABILITIES } from "@/lib/capabilities";
import { getNotionEnvContract } from "@/lib/notion";
import type { EvalCase } from "./cases";
import { composeCase, stubWrites } from "./harness";

vi.mock("next/cache", () => nextCacheMock());

// Blank the Notion contract so the catalog is the mock catalog no matter what
// the developer has in their shell — the same rail `npm run eval` applies.
beforeEach(() => {
  for (const key of getNotionEnvContract()) vi.stubEnv(key, "");
});

// The harness must exercise the *real* path: the same capability registry and
// the same prompt composition `/api/chat` uses (design spec §3). These tests
// check that offline — no API key, no model call — and that the write tools are
// genuinely inert, which is the rail that keeps an eval from creating a Notion
// record (design spec §8).

function testCase(overrides: Partial<EvalCase> = {}): EvalCase {
  return {
    id: "t",
    prompt: "What should I use to cut acrylic?",
    context: {},
    assert: [{ kind: "no_unknown_tools" }],
    file: "t.yaml",
    ...overrides,
  };
}

describe("stubWrites", () => {
  it("leaves read tools untouched", () => {
    const stubbed = stubWrites(CAPABILITIES);
    const reads = CAPABILITIES.flatMap((c) => c.tools).filter((t) => t.kind === "read");
    const stubbedReads = stubbed.flatMap((c) => c.tools).filter((t) => t.kind === "read");

    expect(stubbedReads).toHaveLength(reads.length);
    for (const [index, tool] of stubbedReads.entries()) {
      expect(tool).toBe(reads[index]);
    }
  });

  it("keeps the write tools' name, description and schema so the surface is unchanged", () => {
    const original = CAPABILITIES.flatMap((c) => c.tools).filter((t) => t.kind === "write");
    const stubbed = stubWrites(CAPABILITIES).flatMap((c) => c.tools).filter((t) => t.kind === "write");

    expect(original.length).toBeGreaterThan(0);
    expect(stubbed.map((t) => t.name)).toEqual(original.map((t) => t.name));
    for (const [index, tool] of stubbed.entries()) {
      expect(tool.description).toBe(original[index].description);
      expect(tool.inputSchema).toBe(original[index].inputSchema);
      expect(tool.run).not.toBe(original[index].run);
    }
  });

  it("makes every write tool a recorded no-op", async () => {
    const writes = stubWrites(CAPABILITIES)
      .flatMap((c) => c.tools)
      .filter((t) => t.kind === "write");

    for (const tool of writes) {
      const result = await tool.run({ any: "input" }, {});
      expect(result).toMatchObject({ stubbed: true, tool: tool.name });
    }
  });
});

describe("composeCase", () => {
  it("composes the real system prompt over the fixture catalog", async () => {
    const { system, tools } = await composeCase(testCase());

    // Composed by the registry, not by this harness.
    expect(system).toContain("MakerLab catalog");
    expect(system).toContain("Form 4");
    expect(system).toContain("Trotec Speedy 400");
    expect(Object.keys(tools)).toEqual(
      CAPABILITIES.flatMap((c) => c.tools).map((t) => t.name)
    );
  });

  it("focuses the machine a case is asked from", async () => {
    const { system } = await composeCase(
      testCase({ context: { page: "tool", toolId: "form-4" }, prompt: "How do I use this?" })
    );

    expect(system).toContain("Active tool context");
    expect(system).toContain("Form 4");
  });

  it("refuses a case that focuses a machine the fixture does not have", async () => {
    await expect(
      composeCase(testCase({ context: { page: "tool", toolId: "bambu-x1-carbon" } }))
    ).rejects.toThrow(/not in the fixture catalog/);
  });
});

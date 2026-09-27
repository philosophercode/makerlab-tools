import { nextCacheMock } from "../test/mocks/next-cache";
import { CAPABILITIES } from "@/lib/capabilities";
import type { Capability } from "@/lib/capabilities";
import { getNotionEnvContract } from "@/lib/notion";
import { z } from "zod";
import type { EvalCase } from "./cases";
import { caseMessages, composeCase, evalIdentity, stubLiveReads, stubWrites } from "./harness";

vi.mock("next/cache", () => nextCacheMock());

// Blank `DATABASE_URL` so the catalog is the demo seed, and the Notion contract
// so no write path can reach Notion, no matter what the developer has in their
// shell — the same rails `npm run eval` applies.
beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
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

/** A minimal capability, for testing `stubLiveReads` without depending on a
 * `read_page` tool actually landing in `CAPABILITIES` yet (gateway spec §3.3 —
 * another part of this migration owns adding it). */
function fakeCapability(toolName: string, kind: "read" | "write"): Capability {
  return {
    id: `fake-${toolName}`,
    promptFragment: () => "",
    tools: [
      {
        name: toolName,
        description: "fake",
        inputSchema: z.unknown(),
        kind,
        run: async () => ({ real: true }),
      },
    ],
  };
}

describe("stubLiveReads", () => {
  it("records a read_page tool as a no-op, the same shape a write tool gets", async () => {
    const [capability] = stubLiveReads([fakeCapability("read_page", "read")]);
    const result = await capability.tools[0].run({ url: "http://example.com" }, {});
    expect(result).toMatchObject({ stubbed: true, tool: "read_page" });
  });

  it("keeps read_page's name, description and schema so the surface is unchanged", () => {
    const [original] = [fakeCapability("read_page", "read")];
    const [stubbed] = stubLiveReads([original]);
    expect(stubbed.tools[0].name).toBe(original.tools[0].name);
    expect(stubbed.tools[0].description).toBe(original.tools[0].description);
    expect(stubbed.tools[0].inputSchema).toBe(original.tools[0].inputSchema);
    expect(stubbed.tools[0].run).not.toBe(original.tools[0].run);
  });

  it("leaves every other read tool — including CAPABILITIES' real ones — untouched", () => {
    // `read_page` itself is excluded from this "untouched" expectation: once
    // it lands in the real registry (gateway spec §3.3), it is exactly the
    // tool this function exists to intercept — proved separately below.
    const reads = CAPABILITIES.flatMap((c) => c.tools).filter(
      (t) => t.kind === "read" && t.name !== "read_page"
    );
    const stubbedReads = stubLiveReads(CAPABILITIES)
      .flatMap((c) => c.tools)
      .filter((t) => t.kind === "read" && t.name !== "read_page");

    expect(stubbedReads).toHaveLength(reads.length);
    for (const [index, tool] of stubbedReads.entries()) {
      expect(tool).toBe(reads[index]);
    }
  });

  it("intercepts CAPABILITIES' own read_page too, once it exists there", () => {
    const real = CAPABILITIES.flatMap((c) => c.tools).find((t) => t.name === "read_page");
    if (!real) return; // Not landed yet in this run of the tree — nothing to prove.
    const stubbed = stubLiveReads(CAPABILITIES)
      .flatMap((c) => c.tools)
      .find((t) => t.name === "read_page");
    expect(stubbed?.run).not.toBe(real.run);
    expect(stubbed?.description).toBe(real.description);
  });

  it("leaves a tool not named read_page untouched, whatever its kind", () => {
    const original = fakeCapability("some_write", "write");
    const [stubbed] = stubLiveReads([original]);
    expect(stubbed.tools[0].run).toBe(original.tools[0].run);
  });
});

describe("composeCase", () => {
  it("composes the real system prompt over the fixture catalog", async () => {
    const { system, tools } = await composeCase(testCase());

    // Composed by the registry, not by this harness.
    expect(system).toContain("MakerLab catalog");
    expect(system).toContain("Form 4");
    expect(system).toContain("Trotec Speedy 400");
    // Every chat tool, and nothing marked MCP-only (create_tool).
    expect(Object.keys(tools)).toEqual(
      CAPABILITIES.flatMap((c) => c.tools)
        .filter((t) => !t.mcpOnly)
        .map((t) => t.name)
    );
  });

  it("composes a staff case's tools and prompt for the demo SuperMaker", async () => {
    const { system, tools } = await composeCase(testCase({ context: { page: "gallery", as: "staff" } }));
    expect(Object.keys(tools)).toEqual(expect.arrayContaining(["list_open_tickets", "update_ticket", "list_intake_queue"]));
    expect(system).toMatch(/state the exact change and ask for confirmation/);
    // update_ticket is a write: recorded, never run.
    const execute = tools.update_ticket.execute as (input: unknown, options: unknown) => Promise<unknown>;
    const result = await execute({ ticket_id: "x", status: "resolved" }, {});
    expect(result).toMatchObject({ stubbed: true, tool: "update_ticket" });
  });

  it("gives a student case none of the staff tools, through the route's own filter", async () => {
    const { system, tools } = await composeCase(testCase({ context: { page: "gallery", as: "student" } }));
    for (const name of ["list_open_tickets", "update_ticket", "list_intake_queue", "identify_tools"]) {
      expect(Object.keys(tools)).not.toContain(name);
    }
    expect(system).not.toContain("Lab staff tools");
  });

  it("sends a case's history before its prompt", () => {
    expect(
      caseMessages(
        testCase({
          prompt: "Yes",
          history: [
            { role: "user", text: "Mark it resolved" },
            { role: "assistant", text: "Shall I?" },
          ],
        })
      )
    ).toEqual([
      { role: "user", content: "Mark it resolved" },
      { role: "assistant", content: "Shall I?" },
      { role: "user", content: "Yes" },
    ]);
    expect(caseMessages(testCase())).toEqual([{ role: "user", content: "What should I use to cut acrylic?" }]);
  });

  it("asks as the demo seed's accounts", () => {
    expect(evalIdentity("staff")).toMatchObject({ role: "admin", userId: "demo-user-niti" });
    expect(evalIdentity("student")).toMatchObject({ role: "user", userId: "demo-user-casey" });
  });

  it("focuses the machine a case is asked from", async () => {
    const { system } = await composeCase(
      testCase({ context: { page: "tool", toolId: "form-4" }, prompt: "How do I use this?" })
    );

    expect(system).toContain("Active tool context");
    expect(system).toContain("Form 4");
  });

  it("composes curation for a curate case, with propose_change stubbed like every write", async () => {
    const { system, tools } = await composeCase(
      testCase({ context: { page: "tool", toolId: "form-4", curate: true }, prompt: "Curate this entry" })
    );
    expect(system).toContain("## Curating: Form 4");
    expect(Object.keys(tools)).toEqual(expect.arrayContaining(["get_record", "propose_change"]));
    const { system: plain, tools: plainTools } = await composeCase(testCase({ context: { page: "tool", toolId: "form-4" } }));
    expect(plain).not.toContain("Curating:");
    expect(Object.keys(plainTools)).not.toContain("propose_change");
  });

  it("refuses a case that focuses a machine the fixture does not have", async () => {
    await expect(
      composeCase(testCase({ context: { page: "tool", toolId: "bambu-x1-carbon" } }))
    ).rejects.toThrow(/not in the fixture catalog/);
  });
});

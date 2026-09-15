// @vitest-environment node
// `nextCacheMock` is imported first on purpose: `vi.mock` is hoisted above
// every import, and its factory can only reach a module imported before the one
// it replaces.
import { nextCacheMock } from "../../../test/mocks/next-cache";
import { getCatalogTools } from "../catalog";
import { resetDbForTests } from "../db/client";
import { catalog } from "./catalog";
import type { CapabilityCtx, CapabilityTool } from "./types";

vi.mock("next/cache", () => nextCacheMock());

/**
 * The `catalog` capability against the demo-seeded PGlite database — the same
 * two tools (`form-4`, `trotec-speedy-400`) the mock catalogue used to supply,
 * now real rows. Nothing here writes, so the seed is read as-is.
 */

const ctx: CapabilityCtx = {};

function tool(name: string): CapabilityTool {
  const found = catalog.tools.find((t) => t.name === name);
  if (!found) throw new Error(`No such tool: ${name}`);
  return found;
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
});

afterAll(() => {
  resetDbForTests();
});

// ── list_tools ─────────────────────────────────────────────────────

describe("list_tools", () => {
  it("lists the whole catalogue with a one-line summary each", async () => {
    const result = (await tool("list_tools").run({}, ctx)) as {
      count: number;
      tools: { name: string; slug: string; summary: string }[];
    };

    expect(result.count).toBe(2);
    expect(result.tools.map((t) => t.slug)).toEqual(["form-4", "trotec-speedy-400"]);
    expect(result.tools[0].summary).toContain("Form 4");
    expect(result.tools[0].summary).toContain("training: Intermediate");
  });

  it("narrows by category and by location, on a partial match", async () => {
    const byCategory = (await tool("list_tools").run({ category: "laser" }, ctx)) as {
      tools: { name: string }[];
    };
    expect(byCategory.tools.map((t) => t.name)).toEqual(["Trotec Speedy 400"]);

    const byLocation = (await tool("list_tools").run({ location: "Resin" }, ctx)) as {
      tools: { name: string }[];
    };
    expect(byLocation.tools.map((t) => t.name)).toEqual(["Form 4"]);
  });
});

// ── search_tools ───────────────────────────────────────────────────

describe("search_tools", () => {
  it("matches on materials as well as names and descriptions", async () => {
    const result = (await tool("search_tools").run({ query: "acrylic" }, ctx)) as {
      count: number;
      tools: { name: string; short_description: string }[];
    };

    expect(result.count).toBe(1);
    expect(result.tools[0].name).toBe("Trotec Speedy 400");
    expect(result.tools[0].short_description).toMatch(/laser/i);
  });

  it("returns an empty result set rather than a guess on a miss", async () => {
    const result = (await tool("search_tools").run(
      { query: "nonexistent-widget-xyz" },
      ctx
    )) as { query: string; count: number; tools: unknown[] };

    expect(result).toMatchObject({ query: "nonexistent-widget-xyz", count: 0, tools: [] });
  });
});

// ── get_tool_details ───────────────────────────────────────────────

describe("get_tool_details", () => {
  it("resolves a tool by slug and returns its full record", async () => {
    const result = (await tool("get_tool_details").run(
      { id_or_name: "form-4" },
      ctx
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      found: true,
      slug: "form-4",
      name: "Form 4",
      category: "3D Printing",
      category_sub: "Resin",
      location: "MakerLab",
      zone: "Resin Bench",
      training_level: "Intermediate",
      status: "In Use",
      detail_page: "/tools/form-4",
    });
    expect(result.links).not.toEqual([]);
    expect(result.units).toHaveLength(1);
  });

  it("resolves a tool by the Postgres id it hands back in `list_tools`", async () => {
    // The round trip that matters: the model reads an id out of one tool result
    // and passes it to another. Ids are uuids now, not Notion page ids.
    const [form4] = await getCatalogTools();
    const result = (await tool("get_tool_details").run(
      { id_or_name: form4.id },
      ctx
    )) as { found: boolean; slug: string };

    expect(result).toMatchObject({ found: true, slug: "form-4" });
  });

  it("falls back to a partial name when the value is neither id nor slug", async () => {
    const result = (await tool("get_tool_details").run(
      { id_or_name: "Trotec" },
      ctx
    )) as { found: boolean; slug: string };

    expect(result).toMatchObject({ found: true, slug: "trotec-speedy-400" });
  });

  it("says so plainly when there is no such tool", async () => {
    const result = (await tool("get_tool_details").run(
      { id_or_name: "no-such-tool-id" },
      ctx
    )) as { found: boolean; message: string };

    expect(result.found).toBe(false);
    expect(result.message).toMatch(/Tool not found: no-such-tool-id/);
  });
});

// ── Prompt fragment ────────────────────────────────────────────────

describe("promptFragment", () => {
  it("lists every catalogue tool with the slug the linking rule tells the model to use", async () => {
    const tools = await getCatalogTools();
    const fragment = catalog.promptFragment?.({ tools }) ?? "";

    expect(fragment).toContain("## MakerLab catalog (2 tools)");
    expect(fragment).toContain("**Form 4** — slug: `form-4`");
    expect(fragment).toContain("units: Form 4 // A [In Use]");
  });

  it("names the focused tool and tells the model not to link it", async () => {
    const tools = await getCatalogTools();
    const fragment = catalog.promptFragment?.({ tools, focusedTool: tools[0] }) ?? "";

    expect(fragment).toContain("Active tool context");
    expect(fragment).toContain("already on its page");
  });
});

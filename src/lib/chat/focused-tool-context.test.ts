// @vitest-environment node
const reads = vi.hoisted(() => ({
  manuals: vi.fn(),
  resources: vi.fn(),
  skill: vi.fn(),
}));

vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }));
vi.mock("../db/client", () => ({ getDb: vi.fn(async () => ({})) }));
vi.mock("../data/manual-chunks", () => ({ listToolManualsForChat: reads.manuals }));
vi.mock("../data/resources", () => ({ listResourcesForTool: reads.resources }));
vi.mock("../skills/read", () => ({ readCurrentSkill: reads.skill }));

import { cacheLife, cacheTag } from "next/cache";
import { TOOL_CHAT_CACHE } from "../cache";
import { loadFocusedToolContext } from "./focused-tool-context";

const TOOL = { id: "3f2a9c10-0000-4000-8000-000000000001", name: "Form 4" };
const STUDENT = { role: "user" } as never;
const STAFF = { role: "admin" } as never;

const manualRow = (resourceId: string, searchable: boolean) => ({
  resourceId,
  documentId: "d1",
  title: "Form 4 Manual",
  searchable,
  status: searchable ? "ready" : "no_text",
  pageCount: 80,
  outline: [{ level: 1, title: "Setup", page: 4 }],
  pdfUrl: "https://blob.test/form4.pdf",
});

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  reads.manuals.mockReset().mockResolvedValue([manualRow("r1", true), manualRow("r2", false)]);
  reads.resources.mockReset().mockResolvedValue([{ id: "r1", title: "Form 4 Manual" }]);
  reads.skill.mockReset().mockResolvedValue({
    version: 3,
    generatedAt: "2026-10-20T12:00:00.000Z",
    content: "# Form 4 skill",
    sections: null,
    sources: [],
  });
});

describe("loadFocusedToolContext", () => {
  it("reads the tool's manuals, resources and skill, each as a cached read", async () => {
    const context = await loadFocusedToolContext(TOOL, STUDENT);

    expect(context.toolManuals.outlines.map((o) => o.title)).toEqual(["Form 4 Manual"]);
    expect([...context.toolManuals.searchableResourceIds]).toEqual(["r1"]);
    expect(context.resources).toEqual([{ id: "r1", title: "Form 4 Manual" }]);
    expect(context.toolSkill).toMatchObject({ toolName: "Form 4", version: 3, text: "# Form 4 skill" });
    // Three cached reads, each under the catalogue tag and the tool-chat profile.
    expect(vi.mocked(cacheTag).mock.calls.filter(([tag]) => tag === "catalog").length).toBeGreaterThanOrEqual(3);
    expect(vi.mocked(cacheLife)).toHaveBeenCalledWith(TOOL_CHAT_CACHE);
  });

  it("keys the manuals by access: staff see private ones, students do not", async () => {
    await loadFocusedToolContext(TOOL, STUDENT);
    await loadFocusedToolContext(TOOL, STAFF);
    expect(reads.manuals.mock.calls.map(([, , access]) => access)).toEqual([{ includePrivate: false }, { includePrivate: true }]);
  });

  it("gives each part's fallback when its read fails, and still answers the rest", async () => {
    reads.manuals.mockRejectedValue(new Error("db down"));
    reads.resources.mockRejectedValue(new Error("db down"));
    reads.skill.mockRejectedValue(new Error("db down"));

    const context = await loadFocusedToolContext(TOOL, STUDENT);

    expect(context.toolManuals.outlines).toEqual([]);
    expect(context.toolManuals.searchableResourceIds.size).toBe(0);
    expect(context.resources).toEqual([]);
    expect(context.toolSkill).toBeNull();
  });
});

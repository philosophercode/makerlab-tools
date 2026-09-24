// @vitest-environment node
import { mockTools } from "../../components/mock-catalog";
import type { MakerLabTool } from "../../components/catalog-types";
import { buildSystemPrompt, hasUsableUrl } from "./chat-adapter";

/**
 * The chat adapter's own prompt sections — the rules added when the chat
 * prompt was tuned for `openai/gpt-6-luna` (gateway spec amendment "Chat
 * prompt tuning for Luna"). No capability fragments are composed here
 * (`capabilities: []`), so each assertion is about the adapter alone.
 */

function fixtureTool(slug: string): MakerLabTool {
  const found = mockTools.find((tool) => tool.slug === slug);
  if (!found) throw new Error(`No mock tool: ${slug}`);
  return found;
}

const trotec = fixtureTool("trotec-speedy-400");

function withLinks(tool: MakerLabTool, links: MakerLabTool["links"]): MakerLabTool {
  return { ...tool, links };
}

function promptFor(focusedTool: MakerLabTool | null): string {
  return buildSystemPrompt([], { tools: mockTools, focusedTool, locale: "en" });
}

describe("hasUsableUrl", () => {
  it.each([
    ["https://docs.maker.test/sop", true],
    ["http://docs.maker.test/sop", true],
    ["/files/sop.pdf", true],
    ["#", false],
    ["", false],
    ["/", false],
    [undefined, false],
    ["javascript:alert(1)", false],
  ])("%s → %s", (href, expected) => {
    expect(hasUsableUrl(href as string | undefined)).toBe(expected);
  });
});

describe("resources for the focused tool", () => {
  it("tells the assistant to name the matching resource by its exact title", () => {
    const prompt = promptFor(trotec);

    expect(prompt).toContain("**Point to these by name.**");
    expect(prompt).toContain("by its exact title");
    expect(prompt).toContain('not just "the SOP" or "the manual"');
    // The example is the tool's own SOP, not a made-up document.
    expect(prompt).toContain('"follow the **Trotec Speedy 400 SOP**"');
  });

  it("covers setup and safety questions, the ones that need the SOP", () => {
    const prompt = promptFor(trotec);

    expect(prompt).toMatch(/how to use, set up, operate, maintain or troubleshoot the Trotec Speedy 400, or how to do it safely/);
  });

  it("shows a placeholder link as 'no link on file' rather than a raw '#'", () => {
    const prompt = promptFor(trotec);

    expect(prompt).toContain("- [SOP] Trotec Speedy 400 SOP — no link on file");
    expect(prompt).toContain("  - SOP: Trotec Speedy 400 SOP — no link on file");
    expect(prompt).not.toMatch(/Trotec Speedy 400 SOP — #/);
    expect(prompt).toContain('when it says "no link on file", name it by title and tell the student to ask staff for a copy');
  });

  it("keeps a real URL exactly as it is", () => {
    const url = "https://docs.maker.test/trotec/sop";
    const prompt = promptFor(withLinks(trotec, [{ label: "Trotec Speedy 400 SOP", href: url, kind: "SOP" }]));

    expect(prompt).toContain(`- [SOP] Trotec Speedy 400 SOP — ${url}`);
    expect(prompt).not.toContain("no link on file —");
  });

  it("stays honest: never invent a URL, never claim to know an unread resource", () => {
    const prompt = promptFor(trotec);

    expect(prompt).toContain("Never invent a URL for it");
    expect(prompt).toContain("do not claim to know what a resource says unless you have read it");
    expect(prompt).toContain("Do not invent page numbers or URLs.");
  });

  it("falls back to the first resource as the example when there is no SOP", () => {
    const prompt = promptFor(
      withLinks(trotec, [{ label: "Approved material list", href: "#", kind: "Safety" }])
    );

    expect(prompt).toContain('"follow the **Approved material list**"');
  });

  it("adds no resource rules when no tool is focused", () => {
    const prompt = promptFor(null);

    expect(prompt).not.toContain("## Resources for this tool");
    expect(prompt).not.toContain("Point to these by name");
  });
});

describe("citing sources", () => {
  it("has a third format for a resource with no link: its bold title", () => {
    const prompt = promptFor(trotec);

    expect(prompt).toContain("Three formats:");
    expect(prompt).toContain('3. A resource with "no link on file": its exact title in bold, `**Trotec Speedy 400 SOP**`, with no link.');
  });
});

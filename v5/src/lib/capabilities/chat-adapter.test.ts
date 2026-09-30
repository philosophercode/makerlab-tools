// @vitest-environment node
import { mockTools } from "../../components/mock-catalog";
import type { MakerLabTool } from "../../components/catalog-types";
import { buildSystemPrompt, CONVERSATION_HEADING, hasUsableUrl } from "./chat-adapter";
// The real registry, as the chat route composes it.
import { CAPABILITIES } from "./index";

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

describe("prompt order for the provider's prefix cache (performance plan)", () => {
  const form4 = fixtureTool("form-4");
  const ada = { role: "user", userId: "u-1", name: "Ada Lovelace", email: "ada@cornell.edu" } as never;

  function stablePart(prompt: string): string {
    const at = prompt.indexOf(CONVERSATION_HEADING);
    expect(at).toBeGreaterThan(0);
    return prompt.slice(0, at);
  }

  it("keeps the part before 'This conversation' identical across pages, people and locales", () => {
    const gallery = buildSystemPrompt(CAPABILITIES, { tools: mockTools, locale: "en" });
    const onTrotec = buildSystemPrompt(CAPABILITIES, { tools: mockTools, focusedTool: trotec, locale: "fr" });
    const onForm4 = buildSystemPrompt(CAPABILITIES, { tools: mockTools, focusedTool: form4, locale: "en", identity: ada });

    // Signed in, the prompt varies by role only (the floor-map rules, #98) — not by person.
    const grace = { role: "user", userId: "u-2", name: "Grace Hopper", email: "grace@cornell.edu" } as never;
    const graceOnGallery = buildSystemPrompt(CAPABILITIES, { tools: mockTools, locale: "ja", identity: grace });

    expect(stablePart(onTrotec)).toBe(stablePart(gallery));
    expect(stablePart(onForm4)).toBe(stablePart(graceOnGallery));
    expect(stablePart(onForm4)).not.toContain("Ada Lovelace");
    expect(stablePart(onTrotec)).not.toContain("## Active tool context");
  });

  it("puts the per-request parts after the heading", () => {
    const prompt = buildSystemPrompt(CAPABILITIES, { tools: mockTools, focusedTool: trotec, locale: "fr", identity: ada });
    const tail = prompt.slice(prompt.indexOf(CONVERSATION_HEADING));

    expect(tail).toContain("## Response language");
    expect(tail).toContain("## Active tool context");
    expect(tail).toContain("## Resources for this tool");
    expect(tail).toContain("Ada Lovelace");
  });

  it("lists the catalog and the linking rules once, not twice (quick win 4)", () => {
    const prompt = buildSystemPrompt(CAPABILITIES, { tools: mockTools, focusedTool: trotec, locale: "en" });

    expect(prompt.match(/## MakerLab catalog \(/g)).toHaveLength(1);
    expect(prompt.match(/## Linking tools/g)).toHaveLength(1);
    expect(prompt.match(/## Active tool context/g)).toHaveLength(1);
  });

  it("tells the model how to identify a machine in a photo, in the stable part (photo identification eval)", () => {
    const stable = stablePart(buildSystemPrompt(CAPABILITIES, { tools: mockTools, locale: "en" }));
    expect(stable.match(/## A photo of a machine/g)).toHaveLength(1);
    expect(stable).toContain("ask which one it is, naming those candidates");
    expect(stable).toContain("the lab does not seem to have one");
  });

  it("keeps the lab context and the manual citation rules in the stable part", () => {
    const stable = stablePart(buildSystemPrompt(CAPABILITIES, { tools: mockTools, focusedTool: trotec, locale: "fr", identity: ada }));

    expect(stable).toContain("## Where you are");
    expect(stable).toContain("## Searching manuals");
    expect(stable).toContain("#cite-");
    expect(stable).toContain("## Citing sources");
  });

  it("cites manual passages only by #cite-<ref>, never by a #page= URL (#102 over the old rule)", () => {
    const prompt = buildSystemPrompt(CAPABILITIES, { tools: mockTools, focusedTool: trotec, locale: "en", identity: ada });
    const citing = prompt.slice(prompt.indexOf("## Citing sources")).split("\n## ")[0];

    expect(citing).toContain("#cite-<ref>");
    expect(citing).not.toMatch(/ends in `#page=N`|append it so browser PDF viewers/);
    expect(citing).not.toMatch(/\.pdf#page=\d/);
    expect(prompt).not.toMatch(/\.pdf#page=\d/);
  });
});

describe("where you are (identity spec 2026-09-28 §5)", () => {
  it("tells the assistant what it is, where the lab is and who runs it", () => {
    const prompt = promptFor(null);

    expect(prompt).toContain("## Where you are");
    expect(prompt).toContain("MakerLAB Assistant");
    expect(prompt).toContain("**MakerLAB Tools**");
    expect(prompt).toContain("**first floor of the Tata Innovation Center**");
    expect(prompt).toContain("Roosevelt Island");
    expect(prompt).toContain("**Niti Parikh**");
    expect(prompt).toContain("**Luis Rodrigo Navarro**");
    expect(prompt).toContain("Cornell University's graduate campus in New York City");
  });

  it("names its purpose — operate, debug, create — without forcing it", () => {
    const prompt = promptFor(null);

    expect(prompt).toMatch(/\*\*operate\*\*.*\*\*debug\*\*.*\*\*create\*\*/);
    expect(prompt).toContain("Stay flexible");
  });

  it("sends the unconfirmed to staff instead of guessing, and states nothing we could not source", () => {
    const prompt = promptFor(null);

    expect(prompt).toContain("never guess about the lab");
    for (const unconfirmed of ["1,200", "Studio 101", "square feet", "sq ft"]) expect(prompt).not.toContain(unconfirmed);
  });

  it("sits in the static prefix: right after the intro, and the same whatever the page or locale", () => {
    const general = promptFor(null);
    const onTool = buildSystemPrompt([], { tools: mockTools, focusedTool: trotec, locale: "fr" });
    const where = general.indexOf("## Where you are");

    expect(where).toBeGreaterThan(0);
    expect(where).toBeLessThan(general.indexOf(CONVERSATION_HEADING));
    expect(onTool.slice(0, onTool.indexOf(CONVERSATION_HEADING))).toBe(general.slice(0, general.indexOf(CONVERSATION_HEADING)));
  });
});

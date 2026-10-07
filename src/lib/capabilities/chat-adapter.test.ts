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

    expect(prompt).toContain("Four formats:");
    expect(prompt).toContain('3. A resource with "no link on file": its exact title in bold, `**Trotec Speedy 400 SOP**`, with no link.');
  });

  it("has a fourth format for a lab note: bold Lab note, no link (identity spec amendment \"Lab notes\")", () => {
    const citing = promptFor(trotec).slice(promptFor(trotec).indexOf("## Citing sources")).split("\n## ")[0];

    expect(citing).toContain("4. A lab note: `**Lab note:**` in bold before it, with no link");
  });
});

describe("lab notes (identity spec amendment \"Lab notes\", 2026-10-06)", () => {
  const cutter = withLinks({ ...trotec, notes: "- Always put a cutting mat underneath so you don't scratch the table.\n\nReturn the blade to the drawer." }, []);
  const plain = { ...trotec, notes: null };

  it("puts the rules in the stable part, right after Where you are, even with no notes anywhere", () => {
    const prompt = buildSystemPrompt([], { tools: mockTools, locale: "en" });
    const rules = prompt.indexOf("## Lab notes");

    expect(rules).toBeGreaterThan(prompt.indexOf("## Where you are"));
    expect(rules).toBeLessThan(prompt.indexOf(CONVERSATION_HEADING));
    expect(prompt).toContain("**They win.**");
    expect(prompt).toContain("follow the lab note and say it is how this lab does it");
    expect(prompt).toContain("Never attribute a lab note to a manual or a web page");
    expect(prompt).toContain("**Never invent one.**");
    expect(prompt).not.toContain("### Lab-wide notes");
  });

  it("does not seed a real-sounding rule the model could repeat for a tool that has none", () => {
    const prompt = buildSystemPrompt([], { tools: [], locale: "en" });
    const rules = prompt.slice(prompt.indexOf("## Lab notes")).split("\n## ")[0];

    expect(rules).not.toMatch(/cutting mat/i);
    expect(rules).toContain("**Lab note:** <what the note says>");
  });

  it("lists the lab-wide notes in the stable part, one bullet each, the same on every page and locale", () => {
    const labNotes = ["Clean your station before you leave.", "Ask a SuperMaker before using a machine for the first time."];
    const gallery = buildSystemPrompt([], { tools: mockTools, locale: "en", labNotes });
    const onTool = buildSystemPrompt([], { tools: mockTools, focusedTool: cutter, locale: "fr", labNotes });
    const stable = gallery.slice(0, gallery.indexOf(CONVERSATION_HEADING));

    expect(stable).toContain("### Lab-wide notes\n\n- Clean your station before you leave.\n- Ask a SuperMaker before using a machine for the first time.");
    expect(onTool.slice(0, onTool.indexOf(CONVERSATION_HEADING))).toBe(stable);
  });

  it("gives the focused tool's lab notes first in its description, one per line, list markers dropped", () => {
    const prompt = buildSystemPrompt([], { tools: mockTools, focusedTool: cutter, locale: "en" });
    const tail = prompt.slice(prompt.indexOf(CONVERSATION_HEADING));
    const notes = tail.indexOf("- Lab notes (from the lab's staff; give these first and cite each as **Lab note:**):");

    expect(notes).toBeGreaterThan(tail.indexOf(`**${cutter.name}**`));
    expect(notes).toBeLessThan(tail.indexOf("- Category:"));
    expect(tail).toContain("  - Always put a cutting mat underneath so you don't scratch the table.\n  - Return the blade to the drawer.");
  });

  it("says nothing about lab notes in the description of a tool that has none", () => {
    const tail = buildSystemPrompt([], { tools: mockTools, focusedTool: plain, locale: "en" }).split(CONVERSATION_HEADING)[1];

    expect(tail).not.toContain("- Lab notes");
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

describe("the lab first, then its people (identity spec amendment 2026-10-06)", () => {
  it("leads with the lab's own knowledge, then the manual, and says when they differ", () => {
    const prompt = promptFor(null);

    expect(prompt).toContain("## The lab first, then its people");
    expect(prompt).toContain("a companion to the MakerLAB community, not a replacement for its people");
    expect(prompt).toContain("the tool's lab notes, its SOP and safety documents");
    expect(prompt).toContain("searched and cited as usual");
    expect(prompt).toContain("follow the lab's rule and say they differ");
  });

  it("points students to people for first use, safety and technique, and invents nobody", () => {
    const prompt = promptFor(null);

    expect(prompt).toContain("For first use, safety and hands-on technique");
    expect(prompt).toContain('"ask a SuperMaker to show you the first time"');
    expect(prompt).toContain("Never invent a name, a schedule or who is on shift.");
  });

  it("never weakens citations or the honest 'I don't know'", () => {
    expect(promptFor(null)).toContain("It never replaces the steps, a citation, or saying you don't know.");
  });

  it("sits in the static prefix, right after 'Where you are'", () => {
    const general = promptFor(null);
    const onTool = buildSystemPrompt([], { tools: mockTools, focusedTool: trotec, locale: "fr" });
    const where = general.indexOf("## Where you are");
    const companion = general.indexOf("## The lab first, then its people");

    expect(companion).toBeGreaterThan(where);
    expect(companion).toBeLessThan(general.indexOf(CONVERSATION_HEADING));
    expect(onTool.slice(0, onTool.indexOf(CONVERSATION_HEADING))).toBe(general.slice(0, general.indexOf(CONVERSATION_HEADING)));
  });

  it("comes before the lab notes rules and leaves citing a lab note to them", () => {
    const prompt = promptFor(trotec);

    expect(prompt.indexOf("## The lab first, then its people")).toBeLessThan(prompt.indexOf("## Lab notes"));
    expect(prompt).toContain('cite a lab note as the "Lab notes" section says');
  });

  it("adds no notes line of its own: the focused tool's lab notes come once, from the lab notes block", () => {
    const prompt = promptFor(trotec);
    const tail = prompt.slice(prompt.indexOf(CONVERSATION_HEADING));

    expect(tail).toContain("  - Run exhaust for 60 seconds after cuts before opening the lid.");
    expect(tail.split("Run exhaust for 60 seconds").length - 1).toBe(1);
    expect(tail).not.toContain("- Lab notes: ");
  });
});

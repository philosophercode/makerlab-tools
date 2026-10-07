// @vitest-environment node
import { LAB_NOTE_CITATION, labNotesSection, toolLabNotesLines } from "./lab-notes-prompt";

/**
 * The lab notes' part of the chat prompt (identity spec amendment "Lab
 * notes"). Where it sits in the whole prompt is `chat-adapter.test.ts`'s.
 */

describe("labNotesSection", () => {
  it("states the rules: read first, give first, they win over the manual, cite as a lab note, never invent", () => {
    const section = labNotesSection([]);

    expect(section.startsWith("## Lab notes\n")).toBe(true);
    for (const rule of ["**Read them first.**", "**Give them first.**", "**They win.**", "**Cite each one as a lab note.**", "**Never invent one.**"]) {
      expect(section).toContain(rule);
    }
    expect(section).toContain("call `get_tool_details`");
    expect(section).toContain("Keep a manual's safety warning as well.");
  });

  it("adds the lab-wide notes as bullets only when there are some", () => {
    expect(labNotesSection([])).not.toContain("### Lab-wide notes");
    expect(labNotesSection(["Clean your station.", "Ask before your first cut."])).toMatch(
      /\n### Lab-wide notes\n\n- Clean your station\.\n- Ask before your first cut\.$/
    );
  });
});

describe("toolLabNotesLines", () => {
  it("is a header line and one indented bullet per note", () => {
    expect(toolLabNotesLines("Use a mat.\n- Return the blade.")).toEqual([
      `- Lab notes (from the lab's staff; give these first and cite each as ${LAB_NOTE_CITATION}):`,
      "  - Use a mat.",
      "  - Return the blade.",
    ]);
  });

  it("is nothing for a tool with no notes", () => {
    expect(toolLabNotesLines(null)).toEqual([]);
    expect(toolLabNotesLines("  \n ")).toEqual([]);
  });
});

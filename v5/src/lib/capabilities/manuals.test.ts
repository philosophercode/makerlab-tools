import { MANUAL_OUTLINE_MAX_CHARS, manuals, OCR_NOTE, outlineSection, passageCitation, SEARCH_MANUAL_TOOL, toModelPassage } from "./manuals";

/**
 * The `manuals` capability's pure parts (manual text spec §3.6): how a passage
 * is cited, and the capped outline the prompt carries on a tool's page. The
 * tool's run is exercised end to end through the chat route
 * (`app/api/chat/manual-search.route.test.ts`).
 */

describe("passageCitation", () => {
  it("names the document and the page, a range, and a printed label when it differs", () => {
    const base = { documentTitle: "Form 4 Manual", pageStart: 42, pageEnd: 42, pageLabel: null };
    expect(passageCitation(base)).toBe("Form 4 Manual, p. 42");
    expect(passageCitation({ ...base, pageEnd: 43 })).toBe("Form 4 Manual, pp. 42–43");
    expect(passageCitation({ ...base, pageLabel: "3-12" })).toBe("Form 4 Manual, p. 42 (printed 3-12)");
    expect(passageCitation({ ...base, pageLabel: "42" })).toBe("Form 4 Manual, p. 42");
  });
});

describe("toModelPassage", () => {
  const passage = {
    documentId: "d",
    toolId: null,
    toolName: "X2D",
    toolSlug: "x2d",
    documentTitle: "X2D Manual",
    sectionPath: ["Nozzle", "Replacing it"],
    pageStart: 12,
    pageEnd: 12,
    pageLabel: null,
    content: "Heat the nozzle to 220 °C.",
    pdfUrl: "https://b.test/m.pdf#page=12",
    score: 1,
    ordinals: [0],
    ocr: false,
  };

  it("fences the text and carries the citation and the page link", () => {
    const out = toModelPassage(passage);
    expect(out).toMatchObject({
      ref: "d-12",
      citation: "X2D Manual, p. 12",
      url: "https://b.test/m.pdf#page=12",
      section: "Nozzle › Replacing it",
    });
    expect(out.text).toContain("<untrusted-page");
    expect(out.transcribed).toBeUndefined();
  });

  it("says when the page was read by OCR from a scan (phase 3), keeping its own page", () => {
    const out = toModelPassage({ ...passage, ocr: true });
    expect(out.transcribed).toBe(OCR_NOTE);
    expect(out.url).toBe("https://b.test/m.pdf#page=12");
  });
});

describe("outlineSection", () => {
  it("lists each searchable manual's chapters with their pages, levels 1–2", () => {
    const section = outlineSection("Form 4", [
      {
        title: "Form 4 Manual",
        pageCount: 58,
        pdfUrl: "https://b.test/m.pdf",
        outline: [
          { title: "Maintenance", page: 38, level: 1 },
          { title: "Replacing the resin tank", page: 42, level: 2 },
          { title: "Tabs", page: 43, level: 3 },
        ],
      },
    ]);
    expect(section).toContain("## Manuals for the Form 4 (searchable)");
    expect(section).toContain("### Form 4 Manual (58 pages)");
    expect(section).toContain("- Maintenance — p. 38\n  - Replacing the resin tank — p. 42");
    expect(section).not.toContain("Tabs");
  });

  it("stays within about 2k tokens: level 2 goes first, then the list is cut", () => {
    const outline = Array.from({ length: 400 }, (_, i) => ({ title: `Chapter heading number ${i} with words`, page: i + 1, level: i % 2 ? 2 : 1 }));
    const section = outlineSection("X2D", [{ title: "X2D Manual", pageCount: 400, pdfUrl: null, outline }]);
    expect(section.length).toBeLessThan(MANUAL_OUTLINE_MAX_CHARS + 400);
    expect(section).toContain("(contents cut short)");
    expect(section).not.toContain("number 1 with");
  });
});

describe("the capability", () => {
  it("offers search_manual as a read tool on both surfaces, to everyone", () => {
    expect(manuals.requiredPermission).toBeUndefined();
    const [tool] = manuals.tools;
    expect(tool).toMatchObject({ name: SEARCH_MANUAL_TOOL, kind: "read" });
    expect(tool.chatOnly).toBeFalsy();
    expect(tool.mcpOnly).toBeFalsy();
  });

  it("adds the outline section only on a tool page with searchable manuals", () => {
    const env = { tools: [], locale: "en" };
    expect(manuals.conversationFragment?.(env)).not.toContain("(searchable)");
    const focused = { name: "Form 4" } as never;
    const withOutline = manuals.conversationFragment?.({
      ...env,
      focusedTool: focused,
      manualOutlines: [{ title: "Form 4 Manual", pageCount: 2, pdfUrl: null, outline: [{ title: "Care", page: 1, level: 1 }] }],
    });
    expect(withOutline).toContain("## Manuals for the Form 4 (searchable)");
  });
});

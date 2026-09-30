import { CHUNK_OVERLAP_CHARS, CHUNK_TARGET_CHARS, chunkManual, contextualHeader, splitSections } from "./chunk";

/**
 * The passage splitter (manual text spec §3.3): sections are never crossed,
 * pages are recorded, passages are about the target size with overlap, and the
 * contextual header leads the indexed text.
 */

/** `n` numbered sentences of ~60 characters each. */
function sentences(prefix: string, n: number): string {
  return Array.from({ length: n }, (_, i) => `${prefix} sentence number ${i + 1} explains one more step clearly.`).join("\n");
}

describe("contextualHeader", () => {
  it("joins tool, document and section path", () => {
    expect(contextualHeader("Form 4", "Form 4 Manual", ["Maintenance", "Resin tank"])).toBe(
      "Form 4 — Form 4 Manual › Maintenance › Resin tank"
    );
  });

  it("drops the tool when the title already is it, and the path when there is none", () => {
    expect(contextualHeader("Form 4", "form 4", [])).toBe("form 4");
    expect(contextualHeader(null, "Guide", ["Setup"])).toBe("Guide › Setup");
  });
});

describe("splitSections", () => {
  it("cuts at the heading line on the entry's page and carries the chapter trail", () => {
    const pages = [
      { pageNumber: 1, text: "Cover page\nAcme Laser" },
      { pageNumber: 2, text: "Intro text before.\n3.1 Maintenance\nClean the lens weekly.\nReplacing the tank\nLift the tank out." },
    ];
    const sections = splitSections(pages, [
      { title: "Maintenance", page: 2, level: 1 },
      { title: "Replacing the tank", page: 2, level: 2 },
    ]);
    expect(sections.map((s) => s.path)).toEqual([[], ["Maintenance"], ["Maintenance", "Replacing the tank"]]);
    expect(sections[0].lines.map((l) => l.text)).toEqual(["Cover page", "Acme Laser", "Intro text before."]);
    expect(sections[1].lines.map((l) => l.text)).toEqual(["3.1 Maintenance", "Clean the lens weekly."]);
    expect(sections[2].lines.map((l) => l.text)).toEqual(["Replacing the tank", "Lift the tank out."]);
  });

  it("falls back to the top of the page when the heading is not found there", () => {
    const sections = splitSections(
      [
        { pageNumber: 1, text: "Front." },
        { pageNumber: 2, text: "Body of the chapter." },
      ],
      [{ title: "A title the page never prints", page: 2, level: 1 }]
    );
    expect(sections.map((s) => [s.path, s.lines.map((l) => l.page)])).toEqual([
      [[], [1]],
      [["A title the page never prints"], [2]],
    ]);
  });

  it("pops the trail back to the right level", () => {
    const pages = [1, 2, 3].map((n) => ({ pageNumber: n, text: `Page ${n} words.` }));
    const sections = splitSections(pages, [
      { title: "Setup", page: 1, level: 1 },
      { title: "Unboxing", page: 2, level: 2 },
      { title: "Printing", page: 3, level: 1 },
    ]);
    expect(sections.map((s) => s.path)).toEqual([["Setup"], ["Setup", "Unboxing"], ["Printing"]]);
  });
});

describe("chunkManual", () => {
  it("never crosses a section, and records the pages each passage spans", () => {
    const pages = [
      { pageNumber: 1, text: `Safety\n${sentences("Safety", 20)}` },
      { pageNumber: 2, text: sentences("More safety", 20) },
      { pageNumber: 3, text: `Maintenance\n${sentences("Care", 10)}` },
    ];
    const chunks = chunkManual({
      toolName: "Acme Laser",
      documentTitle: "Acme Manual",
      pages,
      outline: [
        { title: "Safety", page: 1, level: 1 },
        { title: "Maintenance", page: 3, level: 1 },
      ],
    });
    const safety = chunks.filter((c) => c.sectionPath[0] === "Safety");
    const care = chunks.filter((c) => c.sectionPath[0] === "Maintenance");
    expect(safety.length).toBeGreaterThan(0);
    expect(care).toHaveLength(1);
    for (const chunk of safety) {
      expect(chunk.content).not.toMatch(/Care sentence/);
      expect(chunk.pageEnd).toBeLessThanOrEqual(2);
    }
    expect(care[0]).toMatchObject({ pageStart: 3, pageEnd: 3 });
    expect(safety[0].pageStart).toBe(1);
    expect(safety[safety.length - 1].pageEnd).toBe(2);
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i));
  });

  it("packs to about the target size, splits a long paragraph at sentences, and overlaps", () => {
    const chunks = chunkManual({
      toolName: "Acme",
      documentTitle: "Manual",
      pages: [{ pageNumber: 5, text: sentences("Long", 150) }],
      outline: [],
    });
    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) expect(chunk.content.length).toBeLessThanOrEqual(CHUNK_TARGET_CHARS + CHUNK_OVERLAP_CHARS);
    for (const chunk of chunks.slice(0, -1)) expect(chunk.content.length).toBeGreaterThan(CHUNK_TARGET_CHARS * 0.8);
    // Each passage after the first opens with the tail of the one before.
    for (let i = 1; i < chunks.length; i += 1) {
      const previous = chunks[i - 1].content;
      let overlap = 0;
      for (let size = CHUNK_OVERLAP_CHARS; size >= 20; size -= 1) {
        if (chunks[i].content.startsWith(previous.slice(-size))) {
          overlap = size;
          break;
        }
      }
      expect(overlap).toBeGreaterThan(40);
      expect(overlap).toBeLessThanOrEqual(CHUNK_OVERLAP_CHARS);
    }
  });

  it("splits a single sentence longer than a passage at words", () => {
    const giant = Array.from({ length: 900 }, (_, i) => `word${i}`).join(" ");
    const chunks = chunkManual({ toolName: null, documentTitle: "Doc", pages: [{ pageNumber: 1, text: giant }], outline: [] });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.content.length).toBeLessThanOrEqual(CHUNK_TARGET_CHARS + CHUNK_OVERLAP_CHARS + 1);
    expect(chunks.map((c) => c.content).join(" ")).toContain("word899");
  });

  it("prefixes the contextual header to the indexed text, not to the content", () => {
    const [chunk] = chunkManual({
      toolName: "Form 4",
      documentTitle: "Form 4 Manual",
      pages: [{ pageNumber: 42, text: "Replacing the resin tank\nLift the tank straight up and set it aside on a flat surface." }],
      outline: [{ title: "Replacing the resin tank", page: 42, level: 2 }],
    });
    expect(chunk.searchText).toBe(`Form 4 — Form 4 Manual › Replacing the resin tank\n\n${chunk.content}`);
    expect(chunk.content).not.toContain("Form 4 Manual");
    expect(chunk).toMatchObject({ pageStart: 42, pageEnd: 42, sectionPath: ["Replacing the resin tank"] });
  });

  it("drops a section that is only a stray heading, and returns nothing for an empty manual", () => {
    const chunks = chunkManual({
      toolName: null,
      documentTitle: "Doc",
      pages: [
        { pageNumber: 1, text: "Chapter 1" },
        { pageNumber: 2, text: "Real content lives on this page and is long enough to keep." },
      ],
      outline: [
        { title: "Chapter 1", page: 1, level: 1 },
        { title: "Details", page: 2, level: 2 },
      ],
    });
    expect(chunks.map((c) => c.sectionPath)).toEqual([["Chapter 1", "Details"]]);
    expect(chunkManual({ toolName: null, documentTitle: "Doc", pages: [], outline: [] })).toEqual([]);
  });
});

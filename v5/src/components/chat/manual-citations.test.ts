import { fenceUntrusted } from "../../lib/web/fence";
import {
  attachedManualLinks,
  attachedManuals,
  attachedPagePassage,
  linkAttachedPageMentions,
  citationPhrase,
  citedPassages,
  classifyLink,
  manualPassages,
  pageMark,
  passageExcerpt,
} from "./manual-citations";

const URL_42 = "https://blob.example/manuals/form-4.pdf#page=42";
const URL_44 = "https://blob.example/manuals/form-4.pdf#page=44";

function searchPart(passages: unknown[], state = "output-available", status = "ok") {
  return { type: "tool-search_manual", state, output: { status, scope: "Form 4 manuals", passages } };
}

const P42 = { ref: "3f2a9c10-42", citation: "Form 4 Manual, p. 42", url: URL_42, tool: "Form 4", section: "Maintenance › Resin tank", text: fenceUntrusted("Form 4 Manual, p. 42", "Lift the front edge of the tank.") };
const P44 = { ref: "3f2a9c10-44", citation: "Form 4 Manual, pp. 44–45", url: URL_44, tool: "Form 4", section: "", text: "plain" };

describe("manualPassages", () => {
  it("collects the passages a finished search_manual call returned, by URL and by #cite- ref", () => {
    const byKey = manualPassages([{ type: "text" }, searchPart([P42, P44])]);
    expect([...byKey.keys()]).toEqual([URL_42, "#cite-3f2a9c10-42", URL_44, "#cite-3f2a9c10-44"]);
    expect(byKey.get(URL_42)).toEqual({
      ref: "3f2a9c10-42",
      citation: "Form 4 Manual, p. 42",
      url: URL_42,
      section: "Maintenance › Resin tank",
      excerpt: "Lift the front edge of the tank.",
    });
    expect(byKey.get("#cite-3f2a9c10-42")).toBe(byKey.get(URL_42));
  });

  it("ignores a call still running, one that found nothing, and passages with no URL", () => {
    expect(manualPassages([searchPart([P42], "input-available")]).size).toBe(0);
    expect(manualPassages([searchPart([], "output-available", "no_results")]).size).toBe(0);
    expect(manualPassages([searchPart([{ ...P42, url: null }])]).size).toBe(0);
  });

  it("reads only search_manual, never another tool's links", () => {
    expect(manualPassages([{ type: "tool-read_page", state: "output-available", output: { status: "ok", passages: [P42] } } as never]).size).toBe(0);
  });
});

describe("citedPassages", () => {
  const byUrl = manualPassages([searchPart([P42, P44])]);

  it("lists the passages the text links to, in the order it first links them", () => {
    const text = `Slide it in ([Installing](${URL_44})). First lift it ([Replacing](${URL_42})), then again ([x](${URL_44})).`;
    expect(citedPassages(text, byUrl).map((p) => p.url)).toEqual([URL_44, URL_42]);
  });

  it("leaves out passages read but not cited, and addresses nobody returned", () => {
    expect(citedPassages(`See [the manual](${URL_42}).`, byUrl).map((p) => p.url)).toEqual([URL_42]);
    expect(citedPassages("See [a page](https://example.com/manual.pdf#page=42).", byUrl)).toEqual([]);
  });

  it("counts a #cite- ref and the same passage's URL once, at its first link", () => {
    const text = `First ([a](#cite-3f2a9c10-44)), then ([b](${URL_42})), again ([c](${URL_44})).`;
    expect(citedPassages(text, byUrl).map((p) => p.url)).toEqual([URL_44, URL_42]);
  });
});

describe("classifyLink (amendment 2026-09-28: only a tool's address is a manual link)", () => {
  const passages = manualPassages([searchPart([P42, P44])]);
  const documents = attachedManualLinks([
    { type: "data-manual-links", data: { kind: "manual-links", links: [{ title: "Quick start", url: "https://b.test/q.pdf" }] } } as never,
  ]);

  it("resolves a ref or an exact passage URL to the passage", () => {
    expect(classifyLink("#cite-3f2a9c10-42", passages)).toEqual({ kind: "citation", passage: passages.get(URL_42) });
    expect(classifyLink(URL_44, passages)).toMatchObject({ kind: "citation", passage: { url: URL_44 } });
  });

  it("marks every other manual-looking address unverified: an unknown ref, another page, a PDF, a Blob file", () => {
    for (const href of [
      "#cite-3f2a9c10-43",
      "https://blob.example/manuals/form-4.pdf#page=43",
      "https://maker.example/manual.pdf",
      "https://ehlhvy4tr3zposou.public.blob.vercel-storage.com/manuals/x-abc",
      "http://localhost:3001/api/dev-blob/manuals/x.pdf",
    ]) {
      expect(classifyLink(href, passages, documents)).toEqual({ kind: "unverified" });
    }
  });

  it("lets an attached manual through as a document, without the page the model added", () => {
    expect(classifyLink("https://b.test/q.pdf#page=9", passages, documents)).toEqual({
      kind: "document",
      url: "https://b.test/q.pdf",
      title: "Quick start",
    });
  });

  it("leaves site paths and ordinary web pages alone", () => {
    expect(classifyLink("/tools/form-4", passages)).toEqual({ kind: "internal", href: "/tools/form-4" });
    expect(classifyLink("https://formlabs.example/form-4", passages)).toEqual({ kind: "external", href: "https://formlabs.example/form-4" });
  });
});

describe("pageMark", () => {
  it("keeps the page part of a citation", () => {
    expect(pageMark("Form 4 Manual, p. 42")).toBe("p. 42");
    expect(pageMark("Form 4 Manual, pp. 44–45")).toBe("pp. 44–45");
    expect(pageMark("Form 4 Manual, p. 42 (printed 3-12)")).toBe("p. 42");
  });

  it("falls back to the whole citation when it names no page", () => {
    expect(pageMark("Form 4 Manual")).toBe("Form 4 Manual");
  });
});

describe("citationPhrase", () => {
  it("drops the citation the model repeated in the linked words", () => {
    expect(citationPhrase("Replacing the resin tank (Form 4 Manual, p. 42)", "Form 4 Manual, p. 42")).toBe("Replacing the resin tank");
  });

  it("keeps the manual's name when the words are only the citation", () => {
    expect(citationPhrase("Form 4 Manual, pp. 44–45", "Form 4 Manual, pp. 44–45")).toBe("Form 4 Manual");
  });

  it("leaves other words alone", () => {
    expect(citationPhrase("the resin tank section", "Form 4 Manual, p. 42")).toBe("the resin tank section");
  });

  it("drops a citation naming another document or page: only the passage's own label is drawn (amendment 2026-09-28)", () => {
    const quickStart = "Quick Start Guide for X1-Carbon, p. 9";
    expect(citationPhrase("Bed adhesion (Bambu Lab X1-Carbon Combo 3D Printer - SOP, p. 9)", quickStart)).toBe("Bed adhesion");
    expect(citationPhrase("Bambu Lab X1-Carbon Combo 3D Printer - SOP, p. 9", quickStart)).toBe("Quick Start Guide for X1-Carbon");
    expect(citationPhrase("Tank (Form 4 Manual, p. 42 (printed 3-12))", "Form 4 Manual, p. 42 (printed 3-12)")).toBe("Tank");
  });
});

describe("passageExcerpt", () => {
  it("unwraps a fenced passage and folds its whitespace", () => {
    expect(passageExcerpt(fenceUntrusted("Form 4 Manual, p. 42", "Lift the\n\nfront   edge."))).toBe("Lift the front edge.");
  });

  it("shortens a long passage", () => {
    const excerpt = passageExcerpt(fenceUntrusted("x", "word ".repeat(200)));
    expect(excerpt.length).toBeLessThanOrEqual(280);
    expect(excerpt.endsWith("…")).toBe(true);
  });
});

describe("pages of an attached manual (amendment 2026-09-28b)", () => {
  const URL = "https://cdn.example/X1C%20Quick%20Start.pdf";
  const TITLE = "Bambu Lab X1-Carbon Combo 3D Printer - SOP";
  const linksPart = (link: Record<string, unknown>) => ({ type: "data-manual-links", data: { kind: "manual-links", links: [link] } });
  const manual = { title: TITLE, url: URL, ref: "09e38acb", pageCount: 20 };

  it("reads the ref and page count the route streamed, dropping a fragment and a malformed ref", () => {
    expect(attachedManuals([linksPart({ ...manual, url: `${URL}#page=3` })])).toEqual([manual]);
    expect(attachedManuals([linksPart({ title: TITLE, url: URL, ref: "not a ref!", pageCount: -1 })])).toEqual([
      { title: TITLE, url: URL, ref: "", pageCount: null },
    ]);
  });

  it("builds a page's passage from the stored address and title, only at a page the PDF has", () => {
    expect(attachedPagePassage(manual, 8)).toEqual({
      ref: "09e38acb-8",
      citation: `${TITLE}, p. 8`,
      url: `${URL}#page=8`,
      section: "",
      excerpt: "",
    });
    expect(attachedPagePassage(manual, 0)).toBeNull();
    expect(attachedPagePassage(manual, 21)).toBeNull();
    expect(attachedPagePassage({ ...manual, pageCount: null }, 300)?.url).toBe(`${URL}#page=300`);
  });

  it("links a plain-text page reference by the exact title, never inside a link's words", () => {
    expect(linkAttachedPageMentions(`Soap it (${TITLE}, p. 8).`, [manual])).toBe(`Soap it ([${TITLE}, p. 8](#cite-09e38acb-8)).`);
    expect(linkAttachedPageMentions(`See ${TITLE}, pp. 8–9.`, [manual])).toBe(`See [${TITLE}, pp. 8–9](#cite-09e38acb-8).`);
    const linked = `[Plate (${TITLE}, p. 8)](#cite-09e38acb-8)`;
    expect(linkAttachedPageMentions(linked, [manual])).toBe(linked);
    expect(linkAttachedPageMentions(`(${TITLE}, p. 40)`, [manual])).toBe(`(${TITLE}, p. 40)`);
    expect(linkAttachedPageMentions(`(Another Manual, p. 8)`, [manual])).toBe(`(Another Manual, p. 8)`);
    expect(linkAttachedPageMentions(`(${TITLE}, p. 8)`, [{ ...manual, ref: "" }])).toBe(`(${TITLE}, p. 8)`);
  });

  it("keys the cited pages by ref and by the stored address at that page, beside a search's passages", () => {
    const parts = [
      searchPart([P42]),
      linksPart(manual),
      { type: "text", text: `A [x](#cite-09e38acb-8), B [y](${URL}#page=12), C [z](#cite-09e38acb-99), D (${TITLE}, p. 3)` },
    ];
    const passages = manualPassages(parts);
    expect(classifyLink("#cite-09e38acb-8", passages)).toMatchObject({ kind: "citation", passage: { url: `${URL}#page=8` } });
    expect(classifyLink(`${URL}#page=12`, passages)).toMatchObject({ kind: "citation", passage: { citation: `${TITLE}, p. 12` } });
    expect(classifyLink("#cite-09e38acb-3", passages)).toMatchObject({ kind: "citation", passage: { url: `${URL}#page=3` } });
    expect(classifyLink("#cite-09e38acb-99", passages)).toEqual({ kind: "unverified" });
    expect(classifyLink("#cite-3f2a9c10-42", passages)).toMatchObject({ kind: "citation", passage: { url: URL_42 } });
  });
});

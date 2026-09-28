import { fenceUntrusted } from "../../lib/web/fence";
import { citationPhrase, citedPassages, manualPassages, pageMark, passageExcerpt } from "./manual-citations";

const URL_42 = "https://blob.example/manuals/form-4.pdf#page=42";
const URL_44 = "https://blob.example/manuals/form-4.pdf#page=44";

function searchPart(passages: unknown[], state = "output-available", status = "ok") {
  return { type: "tool-search_manual", state, output: { status, scope: "Form 4 manuals", passages } };
}

const P42 = { citation: "Form 4 Manual, p. 42", url: URL_42, tool: "Form 4", section: "Maintenance › Resin tank", text: fenceUntrusted("Form 4 Manual, p. 42", "Lift the front edge of the tank.") };
const P44 = { citation: "Form 4 Manual, pp. 44–45", url: URL_44, tool: "Form 4", section: "", text: "plain" };

describe("manualPassages", () => {
  it("collects the passages a finished search_manual call returned, by URL", () => {
    const byUrl = manualPassages([{ type: "text" }, searchPart([P42, P44])]);
    expect([...byUrl.keys()]).toEqual([URL_42, URL_44]);
    expect(byUrl.get(URL_42)).toEqual({
      citation: "Form 4 Manual, p. 42",
      url: URL_42,
      section: "Maintenance › Resin tank",
      excerpt: "Lift the front edge of the tank.",
    });
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

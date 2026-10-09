import { fenceUntrusted } from "../web/fence";
import {
  answerLinks,
  answerScopeOf,
  checkCitations,
  citationLinks,
  evidenceUrls,
  lastPage,
  passageOnPages,
  toolPassages,
  unfence,
  wordsCitation,
  type DocumentEvidence,
  type ToolPassage,
} from "./citation-check";
import { citationRef, isCitationLikeHref, pageFromUrl, refFromHref } from "./citation-ref";

/**
 * "Citations resolve" (manual text spec amendment 2026-09-28): the pure check
 * behind the eval assertion and the integration test.
 */

const DOC = "https://blob.test/manuals/form-4-abc.pdf";
const P42: ToolPassage = {
  ref: "3f2a9c10-42",
  citation: "Form 4 Manual, p. 42",
  url: `${DOC}#page=42`,
  text: fenceUntrusted("Form 4 Manual, p. 42", "Replacing the resin tank\nWear gloves. Remove the build platform first."),
};
const P30: ToolPassage = {
  ref: "3f2a9c10-30",
  citation: "Form 4 Manual, pp. 30–31",
  url: `${DOC}#page=30`,
  text: fenceUntrusted("Form 4 Manual, pp. 30–31", "Changing the resin cartridge. Open the cover and lift the cartridge out."),
};

function goodEvidence(overrides: Partial<DocumentEvidence> = {}): Map<string, DocumentEvidence> {
  return new Map([
    [
      DOC,
      {
        status: 200,
        contentType: "application/pdf",
        pdfMagic: true,
        pageCount: 50,
        pages: new Map([
          [30, "Printing\nChanging the resin cartridge.\nOpen the cover and"],
          [31, "lift the cartridge out."],
          [42, "Maintenance\nReplacing the resin tank\nWear gloves. Remove the build platform first. Then lift…"],
        ]),
        ...overrides,
      },
    ],
  ]);
}

describe("citation refs", () => {
  it("are the document id's first eight hex digits and the page", () => {
    expect(citationRef("3F2A9C10-1111-4222-8333-444455556666", 42)).toBe("3f2a9c10-42");
    expect(refFromHref("#cite-3f2a9c10-42")).toBe("3f2a9c10-42");
    expect(refFromHref("#cite-not a ref")).toBeNull();
    expect(refFromHref("https://x.test/#cite-3f2a9c10-42")).toBeNull();
  });

  it("recognise manual-looking addresses", () => {
    expect(isCitationLikeHref("#cite-3f2a9c10-42")).toBe(true);
    expect(isCitationLikeHref("https://m.test/manual.pdf")).toBe(true);
    expect(isCitationLikeHref("https://m.test/viewer#page=3")).toBe(true);
    expect(isCitationLikeHref("https://abc.public.blob.vercel-storage.com/manuals/x")).toBe(true);
    expect(isCitationLikeHref("http://localhost:3000/api/dev-blob/manuals/x")).toBe(true);
    expect(isCitationLikeHref("https://formlabs.com/form-4")).toBe(false);
    expect(isCitationLikeHref("/tools/form-4")).toBe(false);
    expect(pageFromUrl(`${DOC}#page=42`)).toBe(42);
    expect(pageFromUrl(DOC)).toBeNull();
  });
});

describe("answerLinks / citationLinks", () => {
  it("finds inline links, autolinks and bare addresses, and keeps only manual-looking ones", () => {
    const text = `See [tank](#cite-3f2a9c10-42), <${DOC}#page=1>, ${DOC}#page=2. Also [page](https://formlabs.com/form-4).`;
    expect(answerLinks(text)).toEqual(["#cite-3f2a9c10-42", "https://formlabs.com/form-4", `${DOC}#page=1`, `${DOC}#page=2`]);
    expect(citationLinks(text)).toEqual(["#cite-3f2a9c10-42", `${DOC}#page=1`, `${DOC}#page=2`]);
  });
});

describe("toolPassages", () => {
  it("reads the passages of finished searches only", () => {
    const passages = toolPassages([{ status: "ok", passages: [P42] }, { status: "no_results", message: "x" }, undefined]);
    expect(passages).toEqual([P42]);
  });
});

describe("checkCitations", () => {
  it("passes a ref and an exact URL that resolve, open a page the PDF has, and cite words on that page", () => {
    const report = checkCitations(`Wear gloves ([tank](#cite-3f2a9c10-42)); swap it ([cart](${DOC}#page=30)).`, [P42, P30], goodEvidence());
    expect(report.ok).toBe(true);
    expect(report.citations.map((c) => [c.href, c.page, c.problems])).toEqual([
      ["#cite-3f2a9c10-42", 42, []],
      [`${DOC}#page=30`, 30, []],
    ]);
  });

  it("fails a link no search returned: a hallucinated PDF, another page of the same PDF, an unknown ref", () => {
    const text = `[a](https://maker.test/manual.pdf#page=4) [b](${DOC}#page=43) [c](#cite-3f2a9c10-43) [d](https://…/manual.pdf#page=42)`;
    const report = checkCitations(text, [P42], goodEvidence());
    expect(report.ok).toBe(false);
    expect(report.citations.every((c) => c.problems.join() === "not_from_tool")).toBe(true);
    expect(report.citations).toHaveLength(4);
  });

  it("fails an address that no longer resolves, or does not answer a PDF", () => {
    expect(checkCitations(`[t](#cite-3f2a9c10-42)`, [P42], goodEvidence({ status: 404 })).citations[0].problems).toEqual(["does_not_resolve"]);
    expect(checkCitations(`[t](#cite-3f2a9c10-42)`, [P42], new Map()).citations[0].problems).toEqual(["does_not_resolve"]);
    expect(
      checkCitations(`[t](#cite-3f2a9c10-42)`, [P42], goodEvidence({ contentType: "text/html", pdfMagic: false })).citations[0].problems
    ).toEqual(["not_a_pdf"]);
  });

  it("fails a page past the end of the PDF", () => {
    expect(checkCitations(`[t](#cite-3f2a9c10-42)`, [P42], goodEvidence({ pageCount: 40 })).citations[0].problems).toEqual([
      "page_out_of_range",
    ]);
  });

  it("fails a citation whose words are not on the page it opens", () => {
    const wrong = { ...P42, text: fenceUntrusted("x", "Cleaning the build platform: wipe it with isopropyl alcohol after every print.") };
    expect(checkCitations(`[t](#cite-3f2a9c10-42)`, [wrong], goodEvidence()).citations[0].problems).toEqual(["passage_not_on_page"]);
  });

  it("fails words naming another document or page than the link opens, and passes the passage's own label", () => {
    const answer = (words: string) => `Lift it ([${words}](#cite-3f2a9c10-42)).`;
    expect(checkCitations(answer("tank (Bambu Lab X1-Carbon Combo 3D Printer - SOP, p. 9)"), [P42], goodEvidence()).citations[0].problems).toEqual([
      "label_mismatch",
    ]);
    expect(checkCitations(answer("tank (Form 4 Manual, p. 43)"), [P42], goodEvidence()).citations[0].problems).toEqual(["label_mismatch"]);
    expect(checkCitations(answer("tank (form 4 manual, p. 42)"), [P42], goodEvidence()).ok).toBe(true);
    expect(checkCitations(answer("the resin tank"), [P42], goodEvidence()).ok).toBe(true);
    expect(wordsCitation("Tank (Form 4 Manual, p. 42 (printed 3-12))")).toEqual({ title: "Form 4 Manual", page: 42 });
  });

  it("accepts a shortened title of the same document (the 2026-09-28 eval run's answer)", () => {
    const scan: ToolPassage = {
      ref: "d90195e2-3",
      citation: "Form Wash Guide (scanned), p. 3",
      url: `${DOC}#page=3`,
      text: fenceUntrusted("Form Wash Guide (scanned), p. 3", "Washing prints\nWear gloves. Wash printed parts in isopropyl alcohol (IPA) for 10 minutes."),
    };
    const evidence = goodEvidence({
      pages: new Map([[3, "Washing prints\nWear gloves. Wash printed parts in isopropyl alcohol (IPA) for 10 minutes."]]),
    });
    const answer = "Wash the prints in IPA for **10 minutes** ([Form Wash Guide, p. 3](#cite-d90195e2-3)).";
    expect(checkCitations(answer, [scan], evidence).ok).toBe(true);
    expect(checkCitations("([Wash, p. 3](#cite-d90195e2-3))", [scan], evidence).citations[0].problems).toEqual(["label_mismatch"]);
  });

  it("reads a passage across the pages its citation spans", () => {
    expect(checkCitations(`[t](#cite-3f2a9c10-30)`, [P30], goodEvidence()).ok).toBe(true);
  });

  it("needs the evidence of exactly the tool's PDF addresses", () => {
    expect(evidenceUrls(`[t](#cite-3f2a9c10-42) [u](https://maker.test/x.pdf)`, [P42])).toEqual([DOC]);
  });
});

describe("helpers", () => {
  it("lastPage reads a range or a single page", () => {
    expect(lastPage("Form 4 Manual, pp. 42–43")).toBe(43);
    expect(lastPage("Form 4 Manual, p. 42 (printed 3-12)")).toBe(42);
    expect(lastPage("Form 4 Manual")).toBeNull();
  });

  it("unfence drops the markers and preamble", () => {
    expect(unfence(fenceUntrusted("Form 4 Manual, p. 1", "Hello\nworld"))).toBe("Hello\nworld");
  });

  it("rule 6: a passage of another machine than the answer is about is other_machine (amendment 2026-10-06)", () => {
    const text = "Lift it ([tank](#cite-3f2a9c10-42)).";
    const prusa: ToolPassage = { ...P42, toolId: "prusa", tool: "Prusa i3 MK3S+" };
    const report = checkCitations(text, [prusa], goodEvidence(), [], new Set(["bambu"]));
    expect(report.ok).toBe(false);
    expect(report.citations[0].problems).toEqual(["other_machine"]);
    expect(report.citations[0].detail[0]).toContain("the Prusa i3 MK3S+'s document");
    // The machine asked about, any machine (null), or no scope given: fine.
    expect(checkCitations(text, [prusa], goodEvidence(), [], new Set(["prusa"])).ok).toBe(true);
    expect(checkCitations(text, [prusa], goodEvidence(), [], null).ok).toBe(true);
    expect(checkCitations(text, [prusa], goodEvidence()).ok).toBe(true);
    // A passage from an output that named no machine is not judged by it.
    expect(checkCitations(text, [P42], goodEvidence(), [], new Set(["bambu"])).ok).toBe(true);
  });

  it("toolPassages and answerScopeOf read the machine and the scope a search recorded", () => {
    const output = { status: "ok", toolIds: ["prusa"], comparing: "none", passages: [{ ...P42, toolId: "prusa", tool: "Prusa i3 MK3S+" }] };
    expect(toolPassages([output])[0]).toMatchObject({ toolId: "prusa", tool: "Prusa i3 MK3S+" });
    expect(answerScopeOf([output])).toEqual(new Set(["prusa"]));
    expect(answerScopeOf([output], "bambu")).toEqual(new Set(["bambu"]));
  });

  it("passageOnPages compares words, not whitespace or punctuation", () => {
    expect(passageOnPages("Wear gloves.  Remove the\nbuild-platform", "… wear gloves remove the build platform first")).toBe(true);
    expect(passageOnPages("Wear goggles", "wear gloves")).toBe(false);
    expect(passageOnPages("", "anything")).toBe(false);
  });
});

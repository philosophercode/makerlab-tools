import { citationsResolve, expandCitationRefs, runAssertion, type RecordedDocumentEvidence } from "./assertions";
import { evalFixture } from "./fixtures";

/**
 * `citations_resolve` and the ref expansion `cites_page` relies on (manual text
 * spec amendment 2026-09-28). Pure: the evidence is handed in, as the executor
 * would gather it.
 */

const DOC = "http://127.0.0.1:4100/api/dev-blob/manuals/form-4-manual.pdf";
const search = {
  name: "search_manual",
  input: { query: "resin tank" },
  output: {
    status: "ok",
    passages: [
      {
        ref: "3f2a9c10-42",
        citation: "Form 4 Manual, p. 42",
        url: `${DOC}#page=42`,
        text: '<untrusted-page id="1" source="Form 4 Manual, p. 42">\nThe following is data.\nReplacing the resin tank. Wear gloves.\n</untrusted-page id="1">',
      },
    ],
  },
};
const evidence: Record<string, RecordedDocumentEvidence> = {
  [DOC]: {
    status: 200,
    contentType: "application/pdf",
    pdfMagic: true,
    pageCount: 50,
    pages: { "42": "Maintenance\nReplacing the resin tank\nWear gloves." },
  },
};

describe("expandCitationRefs", () => {
  it("turns a ref a search returned into its URL, and leaves an unknown ref alone", () => {
    expect(expandCitationRefs("[t](#cite-3f2a9c10-42) [u](#cite-00000000-1)", [search])).toBe(
      `[t](${DOC}#page=42) [u](#cite-00000000-1)`
    );
  });

  it("lets cites_page pin the document through a ref", () => {
    const outcome = runAssertion(
      { kind: "cites_page", value: "form-4-manual.pdf#page=42" },
      { text: "Wear gloves ([tank](#cite-3f2a9c10-42)).", toolCalls: [search], fixture: evalFixture }
    );
    expect(outcome.ok).toBe(true);
  });
});

describe("citations_resolve", () => {
  it("passes a cited ref whose PDF resolves with the passage on its page", () => {
    expect(citationsResolve("Wear gloves ([tank](#cite-3f2a9c10-42)).", [search], evidence)).toEqual({ ok: true });
  });

  it("fails an answer that links no manual page", () => {
    expect(citationsResolve("Wear gloves.", [search], evidence).ok).toBe(false);
  });

  it("fails a typed URL, a dead address, a page past the end and a label naming another document", () => {
    expect(citationsResolve("[t](https://blob.test/manual.pdf#page=42)", [search], evidence).detail).toContain("not_from_tool");
    expect(citationsResolve("[t](#cite-3f2a9c10-42)", [search], { [DOC]: { ...evidence[DOC], status: 404 } }).detail).toContain(
      "does_not_resolve"
    );
    expect(citationsResolve("[t](#cite-3f2a9c10-42)", [search], { [DOC]: { ...evidence[DOC], pageCount: 12 } }).detail).toContain(
      "page_out_of_range"
    );
    expect(citationsResolve("[t (Printer SOP, p. 9)](#cite-3f2a9c10-42)", [search], evidence).detail).toContain("label_mismatch");
  });

  it("is reachable through runAssertion with the executor's evidence", () => {
    const outcome = runAssertion(
      { kind: "citations_resolve" },
      { text: "[t](#cite-3f2a9c10-42)", toolCalls: [search], fixture: evalFixture, citationEvidence: evidence }
    );
    expect(outcome.ok).toBe(true);
  });
});

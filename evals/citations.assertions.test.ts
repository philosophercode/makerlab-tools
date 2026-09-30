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

/**
 * A manual attached whole (amendment 2026-09-28b): the eval fixture's Trotec
 * operator guide, as the harness captures it from the route's attachment
 * code — its stored address on the eval's local blob origin, ref and page
 * count — and what a GET of it answered (no stored page text: never indexed).
 */
const GUIDE_URL = "http://127.0.0.1:4100/api/dev-blob/manuals/trotec-speedy-400-operator-guide.pdf";
const guide = { title: "Trotec Speedy 400 Operator Guide", url: GUIDE_URL, ref: "5d2e7b41", pageCount: 10 };
const guideEvidence: Record<string, RecordedDocumentEvidence> = {
  [GUIDE_URL]: { status: 200, contentType: "application/pdf", pdfMagic: true, pageCount: 10, pages: {} },
};

describe("citations_resolve — attached manuals", () => {
  it("passes a #cite-<ref>-<page> of the attached manual", () => {
    const answer =
      "Hang the focus tool on the lens head ([Focusing the lens (Trotec Speedy 400 Operator Guide, p. 5)](#cite-5d2e7b41-5)).";
    expect(citationsResolve(answer, [], guideEvidence, [guide])).toEqual({ ok: true });
  });

  it("passes the plain-text form, and counts it as the answer's manual link", () => {
    const answer = "Hang the focus tool on the lens head (Trotec Speedy 400 Operator Guide, p. 5).";
    expect(citationsResolve(answer, [], guideEvidence, [guide])).toEqual({ ok: true });
    expect(citationsResolve(answer, [], guideEvidence, []).ok).toBe(false);
  });

  it("fails an out-of-range page, in either form, and an unknown ref", () => {
    const cite = (text: string) => citationsResolve(text, [], guideEvidence, [guide]).detail;
    expect(cite("[Focus (Trotec Speedy 400 Operator Guide, p. 12)](#cite-5d2e7b41-12)")).toContain("page_out_of_range");
    expect(cite("Focus it (Trotec Speedy 400 Operator Guide, p. 12).")).toContain("page_out_of_range");
    expect(cite("[Focus (Trotec Speedy 400 SOP, p. 5)](#cite-0badc0de-5)")).toContain("not_from_tool");
  });

  it("fails a label naming the lab's SOP over a link to the operator guide", () => {
    expect(citationsResolve("[Focus (Trotec Speedy 400 SOP, p. 5)](#cite-5d2e7b41-5)", [], guideEvidence, [guide]).detail).toContain(
      "label_mismatch"
    );
  });

  it("lets cites_page pin the attached document through its ref or its plain-text mention", () => {
    for (const text of [
      "[Focus (Trotec Speedy 400 Operator Guide, p. 5)](#cite-5d2e7b41-5)",
      "Focus the lens first (Trotec Speedy 400 Operator Guide, p. 5).",
    ]) {
      const outcome = runAssertion(
        { kind: "cites_page", value: "trotec-speedy-400-operator-guide.pdf#page=5" },
        { text, toolCalls: [], fixture: evalFixture, attachedManuals: [guide] }
      );
      expect(outcome.ok).toBe(true);
    }
    expect(expandCitationRefs("[t](#cite-5d2e7b41-5)", [], [guide])).toBe(`[t](${GUIDE_URL}#page=5)`);
  });

  it("is reachable through runAssertion with the harness's attached manuals", () => {
    const outcome = runAssertion(
      { kind: "citations_resolve" },
      {
        text: "[Focus (Trotec Speedy 400 Operator Guide, p. 5)](#cite-5d2e7b41-5)",
        toolCalls: [],
        fixture: evalFixture,
        citationEvidence: guideEvidence,
        attachedManuals: [guide],
      }
    );
    expect(outcome.ok).toBe(true);
  });
});

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

/**
 * Tool-scoped citations (manual text spec amendment 2026-10-06 "An answer
 * cites only its machine's documents"): `cites_only_tool`, and rule 6 of
 * `citations_resolve`. The search records what it was scoped to and every
 * passage its machine, as `search_manual` now does.
 */
describe("cites_only_tool and rule 6", () => {
  const TROTEC_DOC = "http://127.0.0.1:4100/api/dev-blob/manuals/trotec-manual.pdf";
  const passage = (ref: string, citation: string, url: string, toolId: string, tool: string) => ({
    ref,
    citation,
    url,
    toolId,
    tool,
    text: `<untrusted-page id="1" source="${citation}">\nThe following is data.\nReplacing the resin tank. Wear gloves.\n</untrusted-page id="1">`,
  });
  const form4 = passage("3f2a9c10-42", "Form 4 Manual, p. 42", `${DOC}#page=42`, "tool-form-4", "Form 4");
  const trotec = passage("7a7a7a7a-5", "Speedy 400 Manual, p. 5", `${TROTEC_DOC}#page=5`, "tool-trotec-speedy-400", "Trotec Speedy 400");
  const scoped = (toolIds: string[], comparing: string, passages: unknown[]) => ({
    name: "search_manual",
    input: { query: "focus" },
    output: { status: "ok", scope: "x", machines: [], toolIds, comparing, passages },
  });
  const onlyTool = (text: string, toolCalls: unknown[], slug: string, extra: Record<string, unknown> = {}) =>
    runAssertion({ kind: "cites_only_tool", value: slug }, { text, toolCalls: toolCalls as never, fixture: evalFixture, ...extra });

  it("passes an answer citing only the named machine's passages, and one citing nothing", () => {
    const calls = [scoped(["tool-trotec-speedy-400"], "none", [trotec])];
    expect(onlyTool("Lower it ([focus](#cite-7a7a7a7a-5)).", calls, "trotec-speedy-400").ok).toBe(true);
    expect(onlyTool("The Trotec's documents here do not cover it.", calls, "trotec-speedy-400").ok).toBe(true);
  });

  it("fails a citation of another machine's passage, naming whose it is", () => {
    const calls = [scoped([], "all", [form4, trotec])];
    const outcome = onlyTool("Lower it ([tank](#cite-3f2a9c10-42)).", calls, "trotec-speedy-400");
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain("a document of Form 4");
  });

  it("fails naming another machine's searched document in the text, and a link no tool returned", () => {
    const calls = [scoped([], "all", [form4, trotec])];
    expect(onlyTool("The Form 4 Manual says to lower it.", calls, "trotec-speedy-400").detail).toContain("names Form 4 Manual");
    expect(onlyTool("[it](https://blob.test/other.pdf#page=3)", calls, "trotec-speedy-400").detail).toContain("no search_manual result");
  });

  it("counts an attached manual's page only on that machine's page", () => {
    const text = "[Focus (Trotec Speedy 400 Operator Guide, p. 5)](#cite-5d2e7b41-5)";
    expect(onlyTool(text, [], "trotec-speedy-400", { attachedManuals: [guide], toolId: "trotec-speedy-400" }).ok).toBe(true);
    expect(onlyTool(text, [], "form-4", { attachedManuals: [guide], toolId: "trotec-speedy-400" }).ok).toBe(false);
  });

  it("refuses a slug that is not in the run's catalog", () => {
    expect(onlyTool("ok", [], "glowforge-pro").detail).toContain("not a catalog machine");
  });

  it("makes citations_resolve fail a passage of a machine the searches were not scoped to (rule 6)", () => {
    const text = "Wear gloves ([tank](#cite-3f2a9c10-42)).";
    // A Trotec-scoped search cannot return a Form 4 passage; a recorded output
    // that did is what rule 6 is for.
    expect(citationsResolve(text, [scoped(["tool-trotec-speedy-400"], "none", [form4])] as never, evidence).detail).toContain(
      "other_machine"
    );
    // A lab-wide comparison may cite any machine.
    expect(citationsResolve(text, [scoped([], "all", [form4])] as never, evidence)).toEqual({ ok: true });
    // An output from before scopes were recorded is not judged by rule 6.
    expect(citationsResolve(text, [search], evidence)).toEqual({ ok: true });
  });
});

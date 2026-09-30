import { fenceUntrusted } from "../web/fence";
import { attachedCiteTarget, linkAttachedPageMentions, type AttachedManualLink } from "./attached-citations";
import {
  attachedForHref,
  checkCitations,
  evidenceUrls,
  withAttachedMentionsLinked,
  type DocumentEvidence,
  type ToolPassage,
} from "./citation-check";
import { documentRefPrefix } from "./citation-ref";

/**
 * "Citations resolve" for manuals attached whole (manual text spec amendment
 * 2026-09-28b "Attached manuals cite pages too"). The fixture is the case that
 * prompted it: the X1-Carbon's Bambu quick-start guide, stored in the lab's
 * Blob store with no searchable text, attached to the turn and cited as
 * `#cite-<ref>-<page>` or as plain "(<title>, p. N)".
 */

const RESOURCE_ID = "8C1F2E9A-5B7D-4E21-9A0C-3D4E5F607182";
const GUIDE_URL = "https://abc123.public.blob.vercel-storage.com/manuals/bambu-x1c-quick-start.pdf";
const GUIDE: AttachedManualLink = {
  title: "Bambu Lab X1-Carbon Quick Start Guide",
  url: GUIDE_URL,
  ref: documentRefPrefix(RESOURCE_ID),
  pageCount: 24,
};
const REF = "8c1f2e9a";

/** What the stored address answered: a 24-page PDF with no stored page text (never indexed). */
function guideEvidence(overrides: Partial<DocumentEvidence> = {}): Map<string, DocumentEvidence> {
  return new Map([
    [GUIDE_URL, { status: 200, contentType: "application/pdf", pdfMagic: true, pageCount: 24, pages: new Map(), ...overrides }],
  ]);
}

function problems(markdown: string, evidence = guideEvidence(), attached: AttachedManualLink[] = [GUIDE]) {
  return checkCitations(markdown, [], evidence, attached).citations.flatMap((c) => c.problems);
}

describe("attached-manual refs", () => {
  it("are the resource id's first eight hex digits, cited with a page", () => {
    expect(GUIDE.ref).toBe(REF);
    expect(attachedCiteTarget(`#cite-${REF}-8`, [GUIDE])).toEqual({ manual: GUIDE, page: 8 });
    expect(attachedCiteTarget(`#CITE-${REF.toUpperCase()}-8`, [GUIDE])).toEqual({ manual: GUIDE, page: 8 });
    expect(attachedCiteTarget("#cite-deadbeef-8", [GUIDE])).toBeNull();
    expect(attachedCiteTarget(`#cite-${REF}`, [GUIDE])).toBeNull();
  });

  it("resolve a link to the stored address, at a page or whole", () => {
    expect(attachedForHref(`${GUIDE_URL}#page=8`, [GUIDE])).toEqual({ manual: GUIDE, page: 8 });
    expect(attachedForHref(GUIDE_URL, [GUIDE])).toEqual({ manual: GUIDE, page: null });
    expect(attachedForHref("https://abc123.public.blob.vercel-storage.com/manuals/other.pdf#page=8", [GUIDE])).toBeNull();
  });
});

describe("checkCitations with attached manuals", () => {
  it("passes a #cite-<ref>-<page> whose words name the manual at that page", () => {
    const answer = `Load the AMS spool first ([Loading filament (${GUIDE.title}, p. 8)](#cite-${REF}-8)).`;
    const report = checkCitations(answer, [], guideEvidence(), [GUIDE]);
    expect(report.ok).toBe(true);
    expect(report.citations).toEqual([
      { href: `#cite-${REF}-8`, url: `${GUIDE_URL}#page=8`, page: 8, problems: [], detail: [] },
    ]);
  });

  it("passes the plain-text form, the way the chat links it", () => {
    const answer = `Remove the foam packing from the toolhead before powering on (${GUIDE.title}, p. 4).`;
    expect(withAttachedMentionsLinked(answer, [GUIDE])).toContain(`[${GUIDE.title}, p. 4](#cite-${REF}-4)`);
    expect(checkCitations(answer, [], guideEvidence(), [GUIDE])).toMatchObject({
      ok: true,
      citations: [{ href: `#cite-${REF}-4`, page: 4, problems: [] }],
    });
  });

  it("fails a page past the end, whichever form it is written in", () => {
    expect(problems(`[Calibration (${GUIDE.title}, p. 40)](#cite-${REF}-40)`)).toEqual(["page_out_of_range"]);
    expect(problems(`See ${GUIDE.title}, p. 40.`)).toEqual(["page_out_of_range"]);
    expect(problems(`[x](#cite-${REF}-0)`)).toEqual(["page_out_of_range"]);
  });

  it("fails a page the route allowed but the stored PDF does not have", () => {
    expect(problems(`[x](#cite-${REF}-8)`, guideEvidence({ pageCount: 6 }))).toEqual(["page_out_of_range"]);
    expect(problems(`[x](#cite-${REF}-8)`, guideEvidence({ pageCount: null }))).toEqual(["page_out_of_range"]);
  });

  it("fails a ref no attached manual (and no search) has", () => {
    const report = checkCitations("[Levelling (Quick Start Guide, p. 3)](#cite-deadbeef-3)", [], guideEvidence(), [GUIDE]);
    expect(report.citations[0].problems).toEqual(["not_from_tool"]);
    expect(report.citations[0].detail[0]).toContain("#cite-deadbeef-3");
  });

  it("fails an attached ref when the turn attached nothing", () => {
    expect(problems(`[x](#cite-${REF}-8)`, guideEvidence(), [])).toEqual(["not_from_tool"]);
  });

  it("fails words naming another document, or another page, than the link opens", () => {
    expect(problems(`[Loading (Bambu Lab X1-Carbon SOP, p. 8)](#cite-${REF}-8)`)).toEqual(["label_mismatch"]);
    expect(problems(`[Loading (${GUIDE.title}, p. 9)](#cite-${REF}-8)`)).toEqual(["label_mismatch"]);
  });

  it("fails a stored address that does not answer, or answers something that is not a PDF", () => {
    expect(problems(`[x](#cite-${REF}-8)`, guideEvidence({ status: 404 }))).toEqual(["does_not_resolve"]);
    expect(problems(`[x](#cite-${REF}-8)`, new Map())).toEqual(["does_not_resolve"]);
    expect(problems(`[x](#cite-${REF}-8)`, guideEvidence({ contentType: "text/html", pdfMagic: false }))).toEqual(["not_a_pdf"]);
  });

  it("accepts the stored address itself, at a page it has or as the whole document", () => {
    expect(problems(`[p. 8](${GUIDE_URL}#page=8)`)).toEqual([]);
    expect(problems(`[${GUIDE.title}](${GUIDE_URL})`)).toEqual([]);
    expect(problems(`[p. 30](${GUIDE_URL}#page=30)`)).toEqual(["page_out_of_range"]);
  });

  it("judges an answer citing a searched passage and an attached page together", () => {
    const formDoc = "http://127.0.0.1:4100/api/dev-blob/manuals/form-4-manual.pdf";
    const passage: ToolPassage = {
      ref: "3f2a9c10-42",
      citation: "Form 4 Manual, p. 42",
      url: `${formDoc}#page=42`,
      text: fenceUntrusted("Form 4 Manual, p. 42", "Replacing the resin tank\nWear gloves."),
    };
    const evidence = guideEvidence();
    evidence.set(formDoc, {
      status: 200,
      contentType: "application/pdf",
      pdfMagic: true,
      pageCount: 50,
      pages: new Map([[42, "Maintenance\nReplacing the resin tank\nWear gloves."]]),
    });
    const answer = `[Tank (Form 4 Manual, p. 42)](#cite-3f2a9c10-42) and [AMS (${GUIDE.title}, p. 8)](#cite-${REF}-8)`;
    expect(checkCitations(answer, [passage], evidence, [GUIDE]).ok).toBe(true);
    expect(evidenceUrls(answer, [passage], [GUIDE])).toEqual([formDoc, GUIDE_URL]);
  });

  it("asks for the evidence of the attached manual's stored address, for either form", () => {
    expect(evidenceUrls(`[x](#cite-${REF}-8)`, [], [GUIDE])).toEqual([GUIDE_URL]);
    expect(evidenceUrls(`(${GUIDE.title}, p. 8)`, [], [GUIDE])).toEqual([GUIDE_URL]);
    expect(evidenceUrls("[x](#cite-deadbeef-8)", [], [GUIDE])).toEqual([]);
  });
});

describe("linkAttachedPageMentions", () => {
  it("links only at pages the PDF has for the chat, and at any page for the check", () => {
    expect(linkAttachedPageMentions(`(${GUIDE.title}, p. 40)`, [GUIDE])).toBe(`(${GUIDE.title}, p. 40)`);
    expect(linkAttachedPageMentions(`(${GUIDE.title}, p. 40)`, [GUIDE], { onlyPagesItHas: false })).toBe(
      `([${GUIDE.title}, p. 40](#cite-${REF}-40))`
    );
  });

  it("leaves a mention that is already a link's words alone", () => {
    const linked = `[${GUIDE.title}, p. 8](#cite-${REF}-8)`;
    expect(linkAttachedPageMentions(linked, [GUIDE])).toBe(linked);
  });
});

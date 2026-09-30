// @vitest-environment node
import { ENGLISH, FRENCH, GERMAN, repeat } from "./language-samples.test-helpers";
import { isPdfUrl, modelWords, pickManualPdfs, withManualPdf } from "./manual-pdfs";

/**
 * A manual PDF the search saw but did not list (manual text spec §3.7): the
 * live X2D run's manual was on Bambu Lab's CDN at a hashed path.
 */

const X2D = { brand: "Bambu Lab", name: "Bambu Lab X2D" };
const CDN_MANUAL = "https://csm.bblcdn.cn/hub/bcef71ed8da34c49a7fc5c7b93a26cfa.pdf";
const result = (url: string, text: string, title: string | null = null) => ({ url, title, text });

describe("pickManualPdfs", () => {
  it("picks a PDF whose captured text names the model, whatever its host", () => {
    const results = [
      result("https://bambulab.com/en/x2d", "X2D product page"),
      result(CDN_MANUAL, "X2D User Manual. Unboxing the X2D. Specifications..."),
      result("https://example.test/other.pdf", "A manual for the P1S printer"),
    ];
    expect(pickManualPdfs(results, X2D)).toEqual([CDN_MANUAL]);
  });

  it("ranks a model match over a brand match, and falls back to the brand when the name has no model word", () => {
    expect(modelWords(X2D)).toEqual(["x2d"]);
    expect(modelWords({ brand: "Formlabs", name: "Form 4" })).toEqual([]);
    const formlabs = [
      result("https://formlabs.test/a.pdf", "Formlabs Form 4 manual"),
      result("https://elsewhere.test/b.pdf", "Unrelated"),
    ];
    expect(pickManualPdfs(formlabs, { brand: "Formlabs", name: "Form 4" })).toEqual(["https://formlabs.test/a.pdf"]);
  });

  it("does not match a model word inside another word, and carries at most two", () => {
    const results = [
      result("https://a.test/1.pdf", "the X2DX series"),
      result("https://a.test/2.pdf", "X2D manual"),
      result("https://a.test/3.pdf", "X2D quick start"),
      result("https://a.test/4.pdf", "X2D safety"),
    ];
    expect(pickManualPdfs(results, X2D)).toEqual(["https://a.test/2.pdf", "https://a.test/3.pdf"]);
  });

  it("knows a PDF URL by its path", () => {
    expect(isPdfUrl("https://a.test/m.PDF?x=1")).toBe(true);
    expect(isPdfUrl("https://a.test/pdf-viewer")).toBe(false);
    expect(isPdfUrl("ftp://a.test/m.pdf")).toBe(false);
  });
});

describe("withManualPdf", () => {
  const product = "https://bambulab.com/en/x2d";
  const docs = "https://bambulab.com/en/support/documentation/1";
  const specs = "https://bambulab.com/en/x2d/specs";
  const video = "https://www.youtube.com/watch?v=abc";

  it("appends the manual when there is room", () => {
    expect(withManualPdf([product, docs], [CDN_MANUAL], 4)).toEqual([product, docs, CDN_MANUAL]);
  });

  it("takes a video's place when the list is full, else the last page's — never the product page's", () => {
    expect(withManualPdf([product, docs, video, specs], [CDN_MANUAL], 4)).toEqual([product, docs, CDN_MANUAL, specs]);
    expect(withManualPdf([product, docs, specs, "https://x.test/"], [CDN_MANUAL], 4)).toEqual([product, docs, specs, CDN_MANUAL]);
    expect(withManualPdf([product], [CDN_MANUAL], 1)).toEqual([product]);
  });

  it("changes nothing when a PDF is already being read, or there is none to add", () => {
    const withPdf = [product, "https://bambulab.com/x2d.pdf"];
    expect(withManualPdf(withPdf, [CDN_MANUAL], 4)).toEqual(withPdf);
    expect(withManualPdf([product], [], 4)).toEqual([product]);
  });
});

describe('pickManualPdfs — English only (amendment "English resources only")', () => {
  it("never picks a PDF whose captured text or file name is not English; a multilingual one with English is picked", () => {
    const german = result("https://cdn.test/a.pdf", `X2D ${repeat(GERMAN, 3)}`);
    const byName = result("https://cdn.test/X2D_FR.pdf", "X2D");
    const multilingual = result("https://cdn.test/b.pdf", `X2D ${repeat(GERMAN, 3)}${repeat(ENGLISH, 3)}${repeat(FRENCH, 3)}`);
    expect(pickManualPdfs([german, byName, multilingual], X2D)).toEqual(["https://cdn.test/b.pdf"]);
  });
});

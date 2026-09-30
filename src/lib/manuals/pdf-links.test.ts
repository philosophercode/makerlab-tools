import { readFileSync } from "node:fs";
import { join } from "node:path";
import { directDownloadUrl, findPdfCandidates, isAllowedHost, siteOf } from "./pdf-links";

/**
 * Finding a manual's PDF on the page research saved instead (manual text spec
 * amendment 2026-09-28), over saved pages written to look like the real ones:
 * a viewer in an iframe, a PDF.js viewer, a Download button, a Drive link, a
 * support hub one hop from the manual, and a page with no manual at all.
 */

const page = (name: string) => readFileSync(join(__dirname, "../../../test/fixtures/manual-pages", name), "utf8");

describe("findPdfCandidates", () => {
  it("finds the PDF in an iframe viewer, without its viewer anchor, and skips the German page", () => {
    const found = findPdfCandidates(page("iframe-viewer.html"), "https://bambulab.com/en-us/support/x1c/manual");
    expect(found[0]).toEqual({
      url: "https://bambulab.com/media/manuals/x1-carbon-user-manual-en.pdf",
      reason: "<iframe> src",
      score: 100,
      direct: true,
    });
    expect(found.map((c) => c.url)).not.toContain("https://bambulab.com/de-de/support/x1c/manual");
    expect(found.some((c) => c.url.includes("youtube.com"))).toBe(false);
  });

  it("reads a PDF.js viewer's file parameter", () => {
    const found = findPdfCandidates(page("pdfjs-viewer.html"), "https://www.troteclaser.com/en-us/service/speedy-400-manual");
    expect(found[0]).toMatchObject({
      url: "https://www.troteclaser.com/static/pdf/speedy-400/8086-operating-manual-speedy-400-C-EN.pdf",
      score: 95,
      direct: true,
    });
  });

  it("offers a Download button to follow, drops the German file and the off-site tracker", () => {
    const found = findPdfCandidates(page("download-button.html"), "https://www.bosch-professional.com/gb/en/products/gst-150-bce");
    expect(found.map((c) => c.url)).toEqual([
      "https://www.bosch-professional.com/gb/en/downloads/get?id=1609929W41&lang=en",
    ]);
    expect(found[0]).toMatchObject({ direct: false, score: 50 });
  });

  it("turns a Google Drive viewer link into its direct download", () => {
    const found = findPdfCandidates(page("drive-link.html"), "https://www.eversewn.com/support/sparrow-x2");
    expect(found[0]).toMatchObject({
      url: "https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOpQrStUvWxYz012345",
      direct: true,
    });
  });

  it("offers the hub's manual card as a page to follow", () => {
    const found = findPdfCandidates(page("support-hub.html"), "https://bambulab.com/en-us/support/x1c");
    expect(found.map((c) => c.url)).toEqual(["https://bambulab.com/en-us/support/x1c/manual"]);
  });

  it("finds nothing on a page with no manual", () => {
    expect(findPdfCandidates(page("no-pdf.html"), "https://mayku.me/formbox")).toEqual([]);
  });

  it("reads a download attribute, a data-pdf button, a meta refresh and an <object>", () => {
    const html = `
      <a href="/files/get/771" download>Save</a>
      <button data-pdf="/assets/guide.pdf">Open the guide</button>
      <meta http-equiv="refresh" content="0; url=/redirect/manual.pdf">
      <object data="/docs/sheet.pdf" type="application/pdf"></object>`;
    const found = findPdfCandidates(html, "https://maker.example/p/1");
    // The button's words say "guide", so it ties the <object> and comes first on the page.
    expect(found.map((c) => [c.url, c.reason])).toEqual([
      ["https://maker.example/assets/guide.pdf", "data-pdf attribute"],
      ["https://maker.example/docs/sheet.pdf", "<object> data"],
      ["https://maker.example/files/get/771", "link with a download attribute"],
      ["https://maker.example/redirect/manual.pdf", "meta refresh"],
    ]);
  });
});

describe("directDownloadUrl", () => {
  it("handles Drive, Dropbox and PDF.js viewers, and nothing else", () => {
    expect(directDownloadUrl("https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp")).toBe(
      "https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOp"
    );
    expect(directDownloadUrl("https://www.dropbox.com/s/abc123/manual.pdf?dl=0")).toBe("https://www.dropbox.com/s/abc123/manual.pdf?dl=1");
    expect(directDownloadUrl("https://x.example/pdfjs/web/viewer.html?file=https%3A%2F%2Fcdn.x.example%2Fm.pdf")).toBe(
      "https://cdn.x.example/m.pdf"
    );
    expect(directDownloadUrl("https://x.example/manual.pdf")).toBeNull();
  });
});

describe("host rule", () => {
  it("keeps to the landing page's site and the known file hosts", () => {
    expect(siteOf("support.prusa3d.com")).toBe("prusa3d.com");
    expect(siteOf("www.bosch.co.uk")).toBe("bosch.co.uk");
    expect(isAllowedHost("https://cdn.prusa3d.com/m.pdf", "https://help.prusa3d.com/x")).toBe(true);
    expect(isAllowedHost("https://d1abc.cloudfront.net/m.pdf", "https://maker.example/x")).toBe(true);
    expect(isAllowedHost("https://evil.example/m.pdf", "https://maker.example/x")).toBe(false);
  });
});

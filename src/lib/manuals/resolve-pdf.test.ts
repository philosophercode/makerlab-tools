// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw/server";
import { MAX_MANUAL_BYTES as ARCHIVE_MAX } from "./archive";
import { MAX_HOPS, MAX_MANUAL_BYTES, resolveManualPdf } from "./resolve-pdf";

/**
 * Following a manual link to the PDF (manual text spec amendment 2026-09-28),
 * over the saved pages in `test/fixtures/manual-pages/`, served by MSW. Every
 * request goes through the SSRF-guarded fetch; the test resolver answers a
 * public address for every name.
 */

const page = (name: string) => readFileSync(join(__dirname, "../../../test/fixtures/manual-pages", name), "utf8");
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n");

const html = (name: string) => () => new HttpResponse(page(name), { headers: { "content-type": "text/html; charset=utf-8" } });
const pdf = (type = "application/pdf", headers: Record<string, string> = {}) => () =>
  HttpResponse.arrayBuffer(PDF.slice().buffer, { headers: { "content-type": type, ...headers } });

describe("resolveManualPdf", () => {
  it("keeps a link that is the PDF already", async () => {
    server.use(http.get("https://maker.example/manual.pdf", pdf()));
    expect(await resolveManualPdf("https://maker.example/manual.pdf")).toEqual({
      status: "pdf",
      pdfUrl: "https://maker.example/manual.pdf",
      landingUrl: null,
      via: "the link itself",
      hops: 0,
    });
  });

  it("opens the PDF an iframe viewer shows", async () => {
    server.use(
      http.get("https://bambulab.com/en-us/support/x1c/manual", html("iframe-viewer.html")),
      http.get("https://bambulab.com/media/manuals/x1-carbon-user-manual-en.pdf", pdf())
    );
    expect(await resolveManualPdf("https://bambulab.com/en-us/support/x1c/manual")).toMatchObject({
      status: "pdf",
      pdfUrl: "https://bambulab.com/media/manuals/x1-carbon-user-manual-en.pdf",
      landingUrl: "https://bambulab.com/en-us/support/x1c/manual",
      hops: 1,
    });
  });

  it("opens a PDF.js viewer's file", async () => {
    server.use(
      http.get("https://www.troteclaser.com/en-us/service/speedy-400-manual", html("pdfjs-viewer.html")),
      http.get("https://www.troteclaser.com/static/pdf/speedy-400/8086-operating-manual-speedy-400-C-EN.pdf", pdf())
    );
    expect(await resolveManualPdf("https://www.troteclaser.com/en-us/service/speedy-400-manual")).toMatchObject({
      status: "pdf",
      pdfUrl: "https://www.troteclaser.com/static/pdf/speedy-400/8086-operating-manual-speedy-400-C-EN.pdf",
    });
  });

  it("clicks the Download button: a generic binary type counts when the file is named .pdf and opens %PDF-", async () => {
    server.use(
      http.get("https://www.bosch-professional.com/gb/en/products/gst-150-bce", html("download-button.html")),
      http.get(
        "https://www.bosch-professional.com/gb/en/downloads/get",
        pdf("application/octet-stream", { "content-disposition": 'attachment; filename="GST150BCE_EN.pdf"' })
      )
    );
    expect(await resolveManualPdf("https://www.bosch-professional.com/gb/en/products/gst-150-bce")).toMatchObject({
      status: "pdf",
      pdfUrl: "https://www.bosch-professional.com/gb/en/downloads/get?id=1609929W41&lang=en",
      via: expect.stringContaining("Download PDF"),
    });
  });

  it("downloads a Google Drive file directly", async () => {
    server.use(
      http.get("https://www.eversewn.com/support/sparrow-x2", html("drive-link.html")),
      http.get("https://drive.google.com/uc", ({ request }) =>
        new URL(request.url).searchParams.get("id") === "1AbCdEfGhIjKlMnOpQrStUvWxYz012345" ? pdf()() : new HttpResponse(null, { status: 404 })
      )
    );
    expect(await resolveManualPdf("https://www.eversewn.com/support/sparrow-x2")).toMatchObject({
      status: "pdf",
      pdfUrl: "https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOpQrStUvWxYz012345",
    });
  });

  it("follows a support hub two hops to the manual, and no further", async () => {
    server.use(
      http.get("https://bambulab.com/en-us/support/x1c", html("support-hub.html")),
      http.get("https://bambulab.com/en-us/support/x1c/manual", html("iframe-viewer.html")),
      http.get("https://bambulab.com/media/manuals/x1-carbon-user-manual-en.pdf", pdf())
    );
    expect(MAX_HOPS).toBe(2);
    expect(await resolveManualPdf("https://bambulab.com/en-us/support/x1c")).toMatchObject({
      status: "pdf",
      pdfUrl: "https://bambulab.com/media/manuals/x1-carbon-user-manual-en.pdf",
      landingUrl: "https://bambulab.com/en-us/support/x1c",
      hops: 2,
    });
  });

  it("says so when the page has no manual", async () => {
    server.use(http.get("https://mayku.me/formbox", html("no-pdf.html")));
    expect(await resolveManualPdf("https://mayku.me/formbox")).toMatchObject({ status: "not_found", reason: "no PDF on the page" });
  });

  it("refuses a 'PDF' that is really a page, a file declared over the archive's limit, and a German link", async () => {
    server.use(
      http.get("https://maker.example/fake.pdf", () => new HttpResponse("<html>Not found</html>", { headers: { "content-type": "application/pdf" } })),
      http.get("https://maker.example/huge.pdf", () =>
        HttpResponse.arrayBuffer(PDF.slice().buffer, {
          headers: { "content-type": "application/pdf", "content-length": String(MAX_MANUAL_BYTES + 1) },
        })
      )
    );
    expect((await resolveManualPdf("https://maker.example/fake.pdf")).status).toBe("not_found");
    expect(await resolveManualPdf("https://maker.example/huge.pdf")).toMatchObject({ status: "not_found", reason: "too large" });
    expect(await resolveManualPdf("https://maker.example/de-de/anleitung.pdf")).toMatchObject({ reason: "not English" });
    expect(MAX_MANUAL_BYTES).toBe(ARCHIVE_MAX);
  });

  it("never leaves the site for a host that is not a known file host, and never an inward address", async () => {
    server.use(
      http.get("https://maker.example/p", () =>
        new HttpResponse('<a href="https://elsewhere.example/manual.pdf">Manual</a><a href="http://169.254.169.254/manual.pdf">Manual</a>', {
          headers: { "content-type": "text/html" },
        })
      )
    );
    const result = await resolveManualPdf("https://maker.example/p");
    expect(result).toMatchObject({ status: "not_found" });
    expect(result.status === "not_found" && result.tried).toEqual(["https://maker.example/p"]);
  });
});

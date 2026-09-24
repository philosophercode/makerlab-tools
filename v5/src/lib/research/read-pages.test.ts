// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw/server";
import { setResolvedAddresses } from "../../../test/web/resolver";
import type { ReadPageResult } from "../web/read-page";
import { RESEARCH_ATTACH_PDFS, RESEARCH_MANUAL_TEXT_MAX_CHARS, RESEARCH_MAX_PDFS_READ } from "../intake/limits";
import { MANUAL_EXTRACT_MAX_BYTES } from "../manuals/extract";
import { parseSearchFindings } from "./model-output";
import {
  READ_CONCURRENCY,
  RESEARCH_PDF_READ_TIMEOUT_MS,
  buildReadMessages,
  candidatePageUrls,
  capManualText,
  manualTextUrls,
  readCandidatePages,
  readSourceUrls,
  searchTextUrls,
} from "./read-pages";

/**
 * The read step's server-side reading (gateway spec §3.3, §5.1 step 2): which
 * pages are read, how many and in what order, what a failure leaves behind, and
 * the one message the tool-less read model receives. Most tests inject a reader;
 * the last block goes through the real `readPage` with MSW and the DNS stand-in.
 */

const ITEM = { name: "Prusa MK4S", brand: "Prusa Research", categoryHint: null, locationHint: null };

function page(url: string, over: Partial<ReadPageResult> = {}): ReadPageResult {
  return {
    url,
    status: "ok",
    contentType: "text/html",
    title: `Title of ${url}`,
    text: `Text of ${url}`,
    pdf: null,
    images: [],
    ...over,
  };
}

function failed(url: string, status: ReadPageResult["status"], reason: string): ReadPageResult {
  return { url, status, contentType: null, title: null, text: null, pdf: null, images: [], reason };
}

const signal = new AbortController().signal;

describe("candidatePageUrls", () => {
  it("takes the candidate links first, then the sources, http(s) only, each once, at most four", () => {
    const findings = parseSearchFindings(
      JSON.stringify({
        candidateLinks: [
          { title: "Product", url: "https://maker.test/p", type: "Other" },
          { title: "Manual", url: "https://maker.test/manual.pdf", type: "Manual" },
          { title: "Bad", url: "javascript:alert(1)", type: "Other" },
          { title: "Again", url: "https://maker.test/p", type: "Other" },
        ],
        sourceUrls: ["https://maker.test/manual.pdf", "https://shop.test/p", "ftp://x.test/y", "https://a.test/", "https://b.test/"],
      })
    );
    expect(candidatePageUrls(findings)).toEqual([
      "https://maker.test/p",
      "https://maker.test/manual.pdf",
      "https://shop.test/p",
      "https://a.test/",
    ]);
    expect(candidatePageUrls(findings, 2)).toHaveLength(2);
  });
});

describe("readCandidatePages", () => {
  it("reads at most `max` pages, two at a time, and keeps candidate order whatever finishes first", async () => {
    let inFlight = 0;
    let peak = 0;
    const seen: string[] = [];
    const delays: Record<string, number> = { "https://a.test/": 30, "https://b.test/": 5, "https://c.test/": 1, "https://d.test/": 10 };
    const read = async (url: string) => {
      seen.push(url);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, delays[url] ?? 1));
      inFlight -= 1;
      return page(url);
    };

    const result = await readCandidatePages(
      ["https://a.test/", "https://b.test/", "https://c.test/", "https://d.test/", "https://e.test/"],
      { signal, allowedHosts: [], max: 4, read }
    );

    expect(READ_CONCURRENCY).toBe(2);
    expect(peak).toBe(2);
    expect(seen).not.toContain("https://e.test/");
    expect(result.pages.map((p) => p.url)).toEqual(["https://a.test/", "https://b.test/", "https://c.test/", "https://d.test/"]);
    expect(result.failures).toEqual([]);
  });

  it("passes the signal and the allowed hosts to every read", async () => {
    const read = vi.fn(async (url: string) => page(url));
    await readCandidatePages(["https://a.test/"], { signal, allowedHosts: ["a.test"], read });
    expect(read).toHaveBeenCalledWith("https://a.test/", { signal, allowedHosts: ["a.test"], maxPdfBytes: MANUAL_EXTRACT_MAX_BYTES });
    // A URL that names a PDF gets the manual archive's download time.
    await readCandidatePages(["https://a.test/m.pdf"], { signal, allowedHosts: ["a.test"], read });
    expect(read).toHaveBeenLastCalledWith("https://a.test/m.pdf", {
      signal,
      allowedHosts: ["a.test"],
      maxPdfBytes: MANUAL_EXTRACT_MAX_BYTES,
      timeoutMs: RESEARCH_PDF_READ_TIMEOUT_MS,
    });
  });

  it("records a failure as host and status only — never the path or the query", async () => {
    const read = async (url: string) =>
      url.includes("secret")
        ? failed(url, "blocked", "forbidden_address")
        : url.includes("gone")
          ? failed(url, "failed", "http_404")
          : page(url, { text: "   " });
    const result = await readCandidatePages(
      ["https://intranet.test/secret/path?token=abc", "https://shop.test/gone?session=xyz", "https://thin.test/p"],
      { signal, allowedHosts: [], read }
    );
    expect(result.pages).toEqual([]);
    expect(result.failures).toEqual([
      "intranet.test: blocked (forbidden_address)",
      "shop.test: failed (http_404)",
      "thin.test: empty",
    ]);
    expect(result.failures.join(" ")).not.toMatch(/secret|token|session|gone/);
  });

  it("treats a reader that throws as one failed page", async () => {
    const read = async (url: string) => {
      if (url.includes("boom")) throw new Error("unexpected");
      return page(url);
    };
    const result = await readCandidatePages(["https://boom.test/", "https://ok.test/"], { signal, allowedHosts: [], read });
    expect(result.failures).toEqual(["boom.test: failed (unexpected)"]);
    expect(result.pages.map((p) => p.url)).toEqual(["https://ok.test/"]);
  });

  it("keeps at most two PDFs, as bytes, when PDFs are attached", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.4");
    const read = async (url: string) => page(url, { contentType: "application/pdf", text: null, title: null, pdf: bytes });
    const result = await readCandidatePages(["https://a.test/1.pdf", "https://a.test/2.pdf", "https://a.test/3.pdf"], {
      signal,
      allowedHosts: [],
      maxPdfs: 2,
      read,
      attachPdfs: true,
    });
    expect(result.pdfs.map((p) => p.url)).toEqual(["https://a.test/1.pdf", "https://a.test/2.pdf"]);
    expect(result.pdfs[0].data).toBe(bytes);
    expect(result.failures).toEqual(["a.test: skipped (PDF limit)"]);
  });

  it("unions the pages' declared images in page order, the first sighting kept", async () => {
    const read = async (url: string) =>
      page(url, {
        text: url.includes("thin") ? "" : "text",
        images:
          url === "https://a.test/"
            ? [
                { url: "https://cdn.test/og.jpg", source: "og", pageUrl: url },
                { url: "https://cdn.test/ld.jpg", source: "jsonld", pageUrl: url },
              ]
            : [
                { url: "https://cdn.test/og.jpg", source: "og", pageUrl: url },
                { url: "https://cdn.test/b.png", source: "twitter", pageUrl: url },
              ],
      });
    const result = await readCandidatePages(["https://a.test/", "https://thin.test/"], { signal, allowedHosts: [], read });
    expect(result.imageHints).toEqual([
      { url: "https://cdn.test/og.jpg", source: "og", pageUrl: "https://a.test/" },
      { url: "https://cdn.test/ld.jpg", source: "jsonld", pageUrl: "https://a.test/" },
      // A page with no body text still declared its image.
      { url: "https://cdn.test/b.png", source: "twitter", pageUrl: "https://thin.test/" },
    ]);
  });

  it("names the pages actually read as the sources", async () => {
    const read = async (url: string) =>
      url.endsWith(".pdf")
        ? page(url, { text: null, pdf: new Uint8Array([1]) })
        : url.includes("fail")
          ? failed(url, "failed", "timeout")
          : page(url, { url: `${url}final` });
    const result = await readCandidatePages(["https://a.test/", "https://fail.test/", "https://a.test/m.pdf"], {
      signal,
      allowedHosts: [],
      read,
      attachPdfs: true,
    });
    expect(readSourceUrls(result)).toEqual(["https://a.test/final", "https://a.test/m.pdf"]);
  });
});

describe('readCandidatePages — manuals as text (amendment "Manuals as text and flex tier for research")', () => {
  const MANUAL = "https://maker.test/x2d-manual.pdf";
  const MANUAL_2 = "https://maker.test/x2d-quick-start.pdf";
  const MANUAL_3 = "https://maker.test/x2d-safety.pdf";
  const bytes = new TextEncoder().encode("%PDF-1.4");
  const pdfPage = (url: string) => page(url, { contentType: "application/pdf", text: null, title: null, pdf: bytes });
  const manualCopy = (n: number) => `Chapter ${n}. Load filament into the AMS. Nozzle temperature 350 °C. `.repeat(10);

  it("is off: research attaches no PDF unless the constant is turned back on, and gives at most two manuals", () => {
    expect(RESEARCH_ATTACH_PDFS).toBe(false);
    expect(RESEARCH_MAX_PDFS_READ).toBe(2);
    expect(RESEARCH_MANUAL_TEXT_MAX_CHARS).toBeGreaterThanOrEqual(12_000);
    expect(RESEARCH_MANUAL_TEXT_MAX_CHARS).toBeLessThanOrEqual(20_000);
  });

  it("gives a PDF with no text of its own as the search's text of it, marked as a manual — no bytes kept", async () => {
    const searchTexts = [{ url: MANUAL, title: "X2D user manual", text: manualCopy(1) }];
    const result = await readCandidatePages([MANUAL], { signal, allowedHosts: [], read: async (url) => pdfPage(url), searchTexts });
    expect(result.pdfs).toEqual([]);
    expect(result.pages).toEqual([
      { url: MANUAL, title: "X2D user manual", text: manualCopy(1).trim(), via: "manual", manualSource: "search" },
    ]);
    expect(manualTextUrls(result)).toEqual([MANUAL]);
    // A source like any page read — and not "via search": the server did read the PDF.
    expect(readSourceUrls(result)).toEqual([MANUAL]);
    expect(searchTextUrls(result)).toEqual([]);
    expect(result.failures).toEqual([]);
  });

  it("caps each manual's text, and gives at most two manuals", async () => {
    const long = "word ".repeat(RESEARCH_MANUAL_TEXT_MAX_CHARS);
    const searchTexts = [
      { url: MANUAL, title: "Manual", text: long },
      { url: MANUAL_2, title: "Quick start", text: manualCopy(2) },
      { url: MANUAL_3, title: "Safety", text: manualCopy(3) },
    ];
    const result = await readCandidatePages([MANUAL, MANUAL_2, MANUAL_3], {
      signal,
      allowedHosts: [],
      read: async (url) => pdfPage(url),
      searchTexts,
    });
    expect(manualTextUrls(result)).toEqual([MANUAL, MANUAL_2]);
    expect(result.pages[0].text.length).toBeLessThanOrEqual(RESEARCH_MANUAL_TEXT_MAX_CHARS + 30);
    expect(result.pages[0].text).toMatch(/…\[manual text cut\]$/);
    expect(result.failures).toEqual(["maker.test: skipped (PDF limit)"]);
  });

  it("skips a PDF that gave no text when the search captured none either, and records why", async () => {
    const result = await readCandidatePages([MANUAL], { signal, allowedHosts: [], read: async (url) => pdfPage(url), searchTexts: [] });
    expect(result.pages).toEqual([]);
    expect(result.pdfs).toEqual([]);
    expect(result.failures).toEqual(["maker.test: skipped (PDF corrupt, no text)"]);
  });

  it("matches the copy by the URL tried or the PDF's final URL", async () => {
    const searchTexts = [{ url: "https://maker.test/files/x2d.pdf", title: null, text: manualCopy(4) }];
    const read = async () => ({ ...pdfPage(MANUAL), url: "https://maker.test/files/x2d.pdf" });
    const result = await readCandidatePages([MANUAL], { signal, allowedHosts: [], read, searchTexts });
    expect(result.pages).toEqual([
      { url: "https://maker.test/files/x2d.pdf", title: null, text: manualCopy(4).trim(), via: "manual", manualSource: "search" },
    ]);
  });

  it("builds no file part: the manual travels in the prompt text, fenced and labelled", async () => {
    const searchTexts = [{ url: MANUAL, title: "X2D user manual", text: manualCopy(5) }];
    const read = await readCandidatePages(["https://maker.test/p", MANUAL], {
      signal,
      allowedHosts: [],
      read: async (url) => (url.endsWith(".pdf") ? pdfPage(url) : page(url)),
      searchTexts,
    });
    const [message] = buildReadMessages(ITEM, parseSearchFindings("{}"), read, []);
    const content = message.content as Array<Record<string, unknown>>;
    expect(content.filter((part) => part.type === "file")).toEqual([]);
    expect(content).toHaveLength(1);
    const text = String(content[0].text);
    expect(text).toContain(`source="${MANUAL} (manual text)"`);
    expect(text).toContain("Chapter 5. Load filament into the AMS.");
    expect(text).not.toContain("PDFs attached to this message");
  });

  it("capManualText leaves a short text alone and cuts a long one at a word break", () => {
    expect(capManualText("  short  ", 100)).toBe("short");
    expect(capManualText("alpha beta gamma delta", 11)).toBe("alpha beta …[manual text cut]");
    // No break near the end: a plain cut.
    expect(capManualText("alphabetagammadelta", 5)).toBe("alpha …[manual text cut]");
  });
});

describe('readCandidatePages — the search\'s text as the fallback (amendment "Search text fallback")', () => {
  const PRODUCT = "https://bambulab.com/en/x2d";
  const SPECS = "https://bambulab.com/en/x2d/specs";
  const WIKI = "https://wiki.bambulab.com/en/x2d/manual";
  const PRODUCT_COPY = "X2D build volume 256 × 256 × 260 mm. Dual nozzle. ".repeat(8);
  const searchTexts = [
    { url: "https://bambulab.com/en-us/x2d", title: "Bambu Lab X2D", text: PRODUCT_COPY },
    { url: SPECS, title: "X2D specs", text: "Nozzle temperature 350 °C. ".repeat(12) },
  ];

  it("reads a page the server was refused (403) or timed out on from the search's copy, marked as such", async () => {
    const read = async (url: string) =>
      url === PRODUCT ? failed(url, "failed", "http_403") : url === SPECS ? failed(url, "failed", "timeout") : page(url);
    const result = await readCandidatePages([PRODUCT, SPECS, WIKI], { signal, allowedHosts: [], read, searchTexts });

    expect(result.pages).toEqual([
      // The copy of the same page at its locale variant, under the URL it was captured from.
      { url: "https://bambulab.com/en-us/x2d", title: "Bambu Lab X2D", text: PRODUCT_COPY, via: "search" },
      { url: SPECS, title: "X2D specs", text: searchTexts[1].text, via: "search" },
      { url: WIKI, title: `Title of ${WIKI}`, text: `Text of ${WIKI}` },
    ]);
    expect(result.failures).toEqual([]);
    expect(searchTextUrls(result)).toEqual(["https://bambulab.com/en-us/x2d", SPECS]);
    // They are pages the model had, so they are sources.
    expect(readSourceUrls(result)).toEqual(["https://bambulab.com/en-us/x2d", SPECS, WIKI]);
  });

  it("uses the copy for a page that answered with no text, and keeps the images it declared", async () => {
    const read = async (url: string) =>
      page(url, { text: "  ", images: [{ url: "https://cdn.test/x2d.jpg", source: "og", pageUrl: url }] });
    const result = await readCandidatePages([SPECS], { signal, allowedHosts: [], read, searchTexts });
    expect(result.pages.map((p) => p.via)).toEqual(["search"]);
    expect(result.imageHints.map((hint) => hint.url)).toEqual(["https://cdn.test/x2d.jpg"]);
  });

  it("never replaces a page the server read, and adds no request of its own", async () => {
    const seen: string[] = [];
    const read = async (url: string) => {
      seen.push(url);
      return page(url, { text: "The server's own read." });
    };
    const result = await readCandidatePages([PRODUCT, SPECS], { signal, allowedHosts: [], read, searchTexts });
    expect(result.pages.map((p) => [p.url, p.text, p.via])).toEqual([
      [PRODUCT, "The server's own read.", undefined],
      [SPECS, "The server's own read.", undefined],
    ]);
    expect(searchTextUrls(result)).toEqual([]);
    expect(seen).toEqual([PRODUCT, SPECS]);
  });

  it("does not second-guess the guard: a blocked page stays a failure, as does a page with no copy", async () => {
    const read = async (url: string) =>
      url === PRODUCT ? failed(url, "blocked", "forbidden_address") : failed(url, "failed", "http_403");
    const result = await readCandidatePages([PRODUCT, WIKI], { signal, allowedHosts: [], read, searchTexts });
    expect(result.pages).toEqual([]);
    expect(result.failures).toEqual(["bambulab.com: blocked (forbidden_address)", "wiki.bambulab.com: failed (http_403)"]);
  });

  it("uses one copy once, however many variants of its page were refused", async () => {
    const read = async (url: string) => failed(url, "failed", "http_403");
    const result = await readCandidatePages([PRODUCT, "https://bambulab.com/en-gb/x2d"], {
      signal,
      allowedHosts: [],
      read,
      searchTexts,
    });
    expect(result.pages).toHaveLength(1);
    expect(result.failures).toEqual(["bambulab.com: failed (http_403)"]);
  });
});

describe("buildReadMessages", () => {
  it("sends one user message: the fenced prompt, then each PDF as a plain file part", () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const messages = buildReadMessages(
      ITEM,
      parseSearchFindings("{}"),
      {
        pages: [{ url: "https://maker.test/p", title: "P", text: "Page words." }],
        pdfs: [{ url: "https://maker.test/m.pdf", data: pdf }],
        failures: [],
      },
      []
    );
    expect(messages).toHaveLength(1);
    const [message] = messages;
    expect(message.role).toBe("user");
    const content = message.content as Array<Record<string, unknown>>;
    expect(content).toHaveLength(2);
    expect(content[0].type).toBe("text");
    expect(content[0].text).toContain('source="https://maker.test/p"');
    expect(content[0].text).toContain("Page words.");
    expect(content[0].text).toContain("- Name: Prusa MK4S");
    expect(content[1]).toEqual({ type: "file", mediaType: "application/pdf", data: pdf });
  });
});

describe("readCandidatePages through the real reader", () => {
  it("reads HTML and a PDF over HTTP, and never fetches a host that resolves to a private address", async () => {
    let intranetHit = false;
    setResolvedAddresses({ "intranet.test": ["10.0.0.5"] });
    server.use(
      http.get("https://maker.test/p", () =>
        HttpResponse.html(
          `<html><head><title>MK4S</title><meta property="og:image" content="/img/mk4s.jpg"></head><body><main><p>An FDM printer.</p></main></body></html>`
        )
      ),
      http.get("https://maker.test/m.pdf", () =>
        HttpResponse.arrayBuffer(new TextEncoder().encode("%PDF-1.4 tiny").buffer, {
          headers: { "content-type": "application/pdf" },
        })
      ),
      http.get("https://intranet.test/admin", () => {
        intranetHit = true;
        return HttpResponse.text("secret");
      })
    );

    const result = await readCandidatePages(["https://maker.test/p", "https://intranet.test/admin", "https://maker.test/m.pdf"], {
      signal,
      allowedHosts: ["maker.test", "intranet.test"],
      attachPdfs: true,
    });

    expect(intranetHit).toBe(false);
    expect(result.failures).toEqual(["intranet.test: blocked (forbidden_address)"]);
    expect(result.pages).toEqual([{ url: "https://maker.test/p", title: "MK4S", text: expect.stringContaining("An FDM printer.") }]);
    expect(result.pdfs.map((p) => p.url)).toEqual(["https://maker.test/m.pdf"]);
    expect(result.imageHints).toEqual([{ url: "https://maker.test/img/mk4s.jpg", source: "og", pageUrl: "https://maker.test/p" }]);
  });

  it("refuses a page off the search's hosts", async () => {
    const result = await readCandidatePages(["https://elsewhere.test/p"], { signal, allowedHosts: ["maker.test"] });
    expect(result.failures).toEqual(["elsewhere.test: blocked (host_not_allowed)"]);
  });
});

describe('candidatePageUrls — the product page first (amendment "Product-page first")', () => {
  it("always reads the brand's product page when the search found one, and a video last", () => {
    const findings = parseSearchFindings(
      JSON.stringify({
        canonicalName: "Bambu Lab X2D",
        candidateLinks: [
          { title: "First print", url: "https://wiki.bambulab.com/en/x2d/manual/first-print", type: "Manual" },
          { title: "Unboxing", url: "https://www.youtube.com/watch?v=x2d", type: "Video" },
          { title: "Wiki home", url: "https://wiki.bambulab.com/en/x2d", type: "Other" },
          { title: "Calibration", url: "https://wiki.bambulab.com/en/x2d/manual/calibration", type: "Manual" },
        ],
        sourceUrls: ["https://bambulab.com/en/x2d"],
      })
    );
    expect(candidatePageUrls(findings, 4, { brand: "Bambu Lab", name: "Bambu Lab X2D" })).toEqual([
      "https://bambulab.com/en/x2d",
      "https://wiki.bambulab.com/en/x2d/manual/first-print",
      "https://wiki.bambulab.com/en/x2d",
      "https://wiki.bambulab.com/en/x2d/manual/calibration",
    ]);
  });
});


describe("readCandidatePages — our own extraction first (manual text spec §3.7)", () => {
  const MANUAL = "https://maker.test/acme-manual.pdf";
  const fixture = (name: string) => new Uint8Array(readFileSync(join(process.cwd(), "test/fixtures/manuals", name)));
  const pdfPage = (url: string, bytes: Uint8Array) =>
    page(url, { contentType: "application/pdf", text: null, title: null, pdf: bytes });

  it("extracts a downloaded PDF and gives its contents and spec pages, labelled with pages, ahead of the search's copy", async () => {
    const searchTexts = [{ url: MANUAL, title: "Acme manual", text: "Exa's copy of the cover and the safety notices. ".repeat(10) }];
    const result = await readCandidatePages([MANUAL], {
      signal,
      allowedHosts: [],
      read: async (url) => pdfPage(url, fixture("outline.pdf")),
      searchTexts,
    });
    expect(result.pages).toHaveLength(1);
    const [manual] = result.pages;
    expect(manual).toMatchObject({ url: MANUAL, via: "manual", manualSource: "pdf", title: "Acme Laser 40 User Manual" });
    expect(manual.text).toContain("Contents:\n- Introduction (p. 1)\n- Specifications (p. 2)\n  - Electrical (p. 3)");
    expect(manual.text).toContain("[page 2]\nSpecifications\nWork area: 400 x 300 mm");
    expect(manual.text).not.toContain("Exa's copy");
    expect(manualTextUrls(result)).toEqual([MANUAL]);
    expect(searchTextUrls(result)).toEqual([]);
  });

  it("falls back to the search's copy for a scan, and says so when there is none", async () => {
    const searchTexts = [{ url: MANUAL, title: "Scan", text: "Exa read this scan with OCR. Work area 400 x 300 mm. ".repeat(6) }];
    const scanned = fixture("scanned.pdf");
    const withCopy = await readCandidatePages([MANUAL], { signal, allowedHosts: [], read: async (url) => pdfPage(url, scanned), searchTexts });
    expect(withCopy.pages[0]).toMatchObject({ via: "manual", manualSource: "search" });

    const without = await readCandidatePages([MANUAL], { signal, allowedHosts: [], read: async (url) => pdfPage(url, scanned) });
    expect(without.pages).toEqual([]);
    expect(without.failures).toEqual(["maker.test: skipped (PDF scanned, no text)"]);
  });

  it("uses the lab's stored text of a manual without downloading it", async () => {
    const read = vi.fn(async (url: string) => page(url));
    const storedManual = vi.fn(async (url: string) =>
      url === MANUAL
        ? {
            outline: [{ title: "Specifications", page: 12, level: 1 }],
            pages: [
              { pageNumber: 11, label: null, text: "Welcome to your new laser." },
              { pageNumber: 12, label: "3-1", text: "Laser power: 40 W\nWork area: 400 x 300 mm" },
            ],
          }
        : null
    );
    const result = await readCandidatePages(["https://maker.test/p", MANUAL], { signal, allowedHosts: [], read, storedManual });
    expect(read.mock.calls.map(([url]) => url)).toEqual(["https://maker.test/p"]);
    expect(result.pages[1]).toMatchObject({ url: MANUAL, via: "manual", manualSource: "stored" });
    expect(result.pages[1].text).toContain("[page 12 (printed 3-1)]\nLaser power: 40 W");
    expect(readSourceUrls(result)).toEqual(["https://maker.test/p", MANUAL]);
  });

  it("labels extracted text as the lab's extraction in the read prompt, and the search's copy as before", async () => {
    const read = await readCandidatePages([MANUAL], {
      signal,
      allowedHosts: [],
      read: async (url) => pdfPage(url, fixture("outline.pdf")),
    });
    const [message] = buildReadMessages(ITEM, parseSearchFindings("{}"), read, []);
    const text = String((message.content as Array<Record<string, unknown>>)[0].text);
    expect(text).toContain(`source="${MANUAL} (manual text)"`);
    expect(text).toContain("extracted from this PDF manual by the lab's server");
    expect(text).not.toContain("as the search engine captured it");
  });
});

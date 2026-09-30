// @vitest-environment node
import { delay, http, HttpResponse } from "msw";
import { server } from "../../../test/msw/server";
import { setResolvedAddresses } from "../../../test/web/resolver";
import {
  READ_PAGE_MAX_CHARS,
  READ_PAGE_MAX_HTML_BYTES,
  READ_PAGE_MAX_PDF_BYTES,
  READ_PAGE_TIMEOUT_MS,
  readPage,
} from "./read-page";

/**
 * The server-side page reader (gateway spec §3.3, §10 "Unit"): text and images
 * from HTML, PDFs as bytes, the 5 MB / 10 MB caps, the 15-second budget,
 * redirects, and private addresses refused directly and after a redirect.
 */

const MB = 1024 * 1024;
const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj << >> endobj\n%%EOF\n");

function signal() {
  return AbortSignal.timeout(30_000);
}

function html(body: string, head = "") {
  return HttpResponse.html(`<!doctype html><html><head>${head}</head><body>${body}</body></html>`);
}

describe("readPage — HTML", () => {
  it("returns the title, the readable text and the declared images, attributed to the final URL", async () => {
    server.use(
      http.get("https://maker.test/p1s", () => new HttpResponse(null, { status: 301, headers: { Location: "/products/p1s" } })),
      http.get("https://maker.test/products/p1s", () =>
        html(
          "<nav>Menu</nav><main><h1>P1S</h1><p>Enclosed CoreXY.</p></main>",
          `<title>P1S</title><meta property="og:image" content="/og.jpg">`
        )
      )
    );

    const result = await readPage("https://maker.test/p1s", { signal: signal() });

    expect(result).toEqual({
      url: "https://maker.test/products/p1s",
      status: "ok",
      contentType: expect.stringContaining("text/html"),
      title: "P1S",
      text: "P1S\nEnclosed CoreXY.",
      pdf: null,
      images: [{ url: "https://maker.test/og.jpg", source: "og", pageUrl: "https://maker.test/products/p1s" }],
    });
  });

  it("caps the text at 40,000 characters", async () => {
    server.use(http.get("https://maker.test/long", () => html(`<p>${"word ".repeat(20_000)}</p>`)));
    const result = await readPage("https://maker.test/long", { signal: signal() });
    expect(result.status).toBe("ok");
    expect(result.text).toHaveLength(READ_PAGE_MAX_CHARS);
  });

  it("reads plain text as text", async () => {
    server.use(http.get("https://maker.test/notes.txt", () => HttpResponse.text("Line one\n\n\nLine   two")));
    expect(await readPage("https://maker.test/notes.txt", { signal: signal() })).toMatchObject({
      status: "ok",
      text: "Line one\nLine two",
      title: null,
      images: [],
    });
  });

  it("decodes the charset the server names", async () => {
    const latin1 = Uint8Array.from([0x3c, 0x70, 0x3e, 0x31, 0x32, 0x30, 0xb0, 0x43, 0x3c, 0x2f, 0x70, 0x3e]); // <p>120°C</p>
    server.use(
      http.get("https://maker.test/latin1", () => new HttpResponse(latin1, { headers: { "content-type": "text/html; charset=iso-8859-1" } }))
    );
    expect((await readPage("https://maker.test/latin1", { signal: signal() })).text).toBe("120°C");
  });

  it("reads unlabelled markup, and markup mislabelled as plain text, as HTML", async () => {
    const markup = "<!DOCTYPE html><html><body><p>bare</p></body></html>";
    server.use(
      http.get("https://maker.test/bare", () => new HttpResponse(new TextEncoder().encode(markup))),
      http.get("https://maker.test/mislabelled", () => HttpResponse.text(markup))
    );
    expect(await readPage("https://maker.test/bare", { signal: signal() })).toMatchObject({ status: "ok", contentType: null, text: "bare" });
    expect(await readPage("https://maker.test/mislabelled", { signal: signal() })).toMatchObject({ status: "ok", text: "bare" });
  });
});

describe("readPage — PDF and other types", () => {
  it("returns a PDF's bytes and no text", async () => {
    server.use(http.get("https://maker.test/manual.pdf", () => new HttpResponse(PDF, { headers: { "content-type": "application/pdf" } })));
    const result = await readPage("https://maker.test/manual.pdf", { signal: signal() });
    expect(result).toMatchObject({ status: "ok", text: null, title: null, images: [] });
    expect(result.pdf && new TextDecoder().decode(result.pdf)).toBe(new TextDecoder().decode(PDF));
  });

  it("recognises a PDF by its magic bytes whatever the header says", async () => {
    server.use(
      http.get("https://maker.test/download", () => new HttpResponse(PDF, { headers: { "content-type": "application/octet-stream" } }))
    );
    const result = await readPage("https://maker.test/download", { signal: signal() });
    expect(result.status).toBe("ok");
    expect(result.pdf).not.toBeNull();
  });

  it.each([
    ["image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47])],
    ["application/zip", new Uint8Array([0x50, 0x4b, 0x03, 0x04])],
    ["application/octet-stream", new Uint8Array([1, 2, 3])],
  ])("answers unsupported for %s", async (type, body) => {
    server.use(http.get("https://maker.test/file", () => new HttpResponse(body, { headers: { "content-type": type } })));
    expect(await readPage("https://maker.test/file", { signal: signal() })).toMatchObject({
      status: "unsupported",
      text: null,
      pdf: null,
    });
  });
});

describe("readPage — size caps", () => {
  it("refuses HTML over 5 MB", async () => {
    const body = new Uint8Array(READ_PAGE_MAX_HTML_BYTES + 1).fill(0x61);
    server.use(http.get("https://maker.test/huge.html", () => new HttpResponse(body, { headers: { "content-type": "text/html" } })));
    expect(await readPage("https://maker.test/huge.html", { signal: signal() })).toMatchObject({ status: "too_large", text: null });
  });

  it("accepts a PDF between 5 and 10 MB, and refuses one over 10 MB", async () => {
    const big = new Uint8Array(6 * MB);
    big.set(PDF);
    const huge = new Uint8Array(READ_PAGE_MAX_PDF_BYTES + 1);
    huge.set(PDF);
    server.use(
      http.get("https://maker.test/big.pdf", () => new HttpResponse(big, { headers: { "content-type": "application/pdf" } })),
      http.get("https://maker.test/huge.pdf", () => new HttpResponse(huge, { headers: { "content-type": "application/pdf" } }))
    );

    expect((await readPage("https://maker.test/big.pdf", { signal: signal() })).status).toBe("ok");
    expect(await readPage("https://maker.test/huge.pdf", { signal: signal() })).toMatchObject({ status: "too_large", pdf: null });
  });

  it("reads a larger PDF when the caller raises the limit (research: the archive's 25 MB), and HTML stays capped", async () => {
    const huge = new Uint8Array(READ_PAGE_MAX_PDF_BYTES + 1);
    huge.set(PDF);
    const page = new Uint8Array(6 * MB).fill(0x61);
    server.use(
      http.get("https://maker.test/huge.pdf", () => new HttpResponse(huge, { headers: { "content-type": "application/pdf" } })),
      http.get("https://maker.test/page.html", () => new HttpResponse(page, { headers: { "content-type": "text/html" } }))
    );
    const opts = { signal: signal(), maxPdfBytes: 25 * MB };
    expect((await readPage("https://maker.test/huge.pdf", opts)).status).toBe("ok");
    expect((await readPage("https://maker.test/page.html", opts)).status).toBe("too_large");
  });

  it("holds an unlabelled body to the HTML cap", async () => {
    const body = new TextEncoder().encode(`<html><body>${"a".repeat(READ_PAGE_MAX_HTML_BYTES)}</body></html>`);
    server.use(http.get("https://maker.test/unlabelled", () => new HttpResponse(body)));
    expect((await readPage("https://maker.test/unlabelled", { signal: signal() })).status).toBe("too_large");
  });
});

describe("readPage — the 15-second budget", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives up after 15 seconds", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    server.use(
      http.get("https://maker.test/slow", async () => {
        await delay("infinite");
        return html("<p>never</p>");
      })
    );

    const pending = readPage("https://maker.test/slow", { signal: new AbortController().signal });
    await vi.advanceTimersByTimeAsync(READ_PAGE_TIMEOUT_MS - 1);
    let settled = false;
    void pending.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(2);
    expect(await pending).toMatchObject({ status: "failed", reason: "timeout", text: null });
  });

  it("stops when the caller's own signal fires first", async () => {
    server.use(
      http.get("https://maker.test/slow", async () => {
        await delay("infinite");
        return html("<p>never</p>");
      })
    );
    const controller = new AbortController();
    const pending = readPage("https://maker.test/slow", { signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    expect(await pending).toMatchObject({ status: "failed", reason: "timeout" });
  });
});

describe("readPage — redirects and addresses", () => {
  it("follows three redirects and refuses a fourth", async () => {
    server.use(
      http.get("https://maker.test/r/:n", ({ params }) => {
        const n = Number(params.n);
        return n < 4 ? new HttpResponse(null, { status: 302, headers: { Location: `/r/${n + 1}` } }) : html("<p>end</p>");
      })
    );
    expect(await readPage("https://maker.test/r/1", { signal: signal() })).toMatchObject({ status: "ok", url: "https://maker.test/r/4" });
    expect(await readPage("https://maker.test/r/0", { signal: signal() })).toMatchObject({ status: "failed", reason: "too_many_redirects" });
  });

  it.each([
    "http://127.0.0.1/",
    "http://10.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://[fd00:ec2::254]/",
    "http://[::ffff:169.254.169.254]/",
  ])("refuses %s directly", async (url) => {
    expect(await readPage(url, { signal: signal() })).toMatchObject({ status: "blocked", text: null, pdf: null });
  });

  it("refuses the metadata address after a redirect", async () => {
    server.use(
      http.get("https://maker.test/innocent", () =>
        new HttpResponse(null, { status: 302, headers: { Location: "http://169.254.169.254/latest/meta-data/" } })
      )
    );
    expect(await readPage("https://maker.test/innocent", { signal: signal() })).toMatchObject({
      status: "blocked",
      url: "http://169.254.169.254/latest/meta-data/",
    });
  });

  it("refuses a public-looking name that resolves inward, after a redirect", async () => {
    setResolvedAddresses({ "intranet.test": ["192.168.10.5"] });
    server.use(
      http.get("https://maker.test/innocent", () =>
        new HttpResponse(null, { status: 302, headers: { Location: "https://intranet.test/admin" } })
      )
    );
    expect((await readPage("https://maker.test/innocent", { signal: signal() })).status).toBe("blocked");
  });

  it("enforces allowedHosts", async () => {
    server.use(http.get("https://elsewhere.test/", () => html("<p>x</p>")));
    expect(await readPage("https://elsewhere.test/", { signal: signal(), allowedHosts: ["maker.test"] })).toMatchObject({
      status: "blocked",
      reason: "host_not_allowed",
    });
  });

  it("answers failed with the status for an HTTP error, and for a non-http scheme answers blocked", async () => {
    server.use(http.get("https://maker.test/missing", () => new HttpResponse("no", { status: 404 })));
    expect(await readPage("https://maker.test/missing", { signal: signal() })).toMatchObject({ status: "failed", reason: "http_404" });
    expect(await readPage("file:///etc/passwd", { signal: signal() })).toMatchObject({ status: "blocked", reason: "scheme" });
  });
});

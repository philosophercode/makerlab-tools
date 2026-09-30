// @vitest-environment node
import { delay, http, HttpResponse } from "msw";
import { server } from "../../../test/msw/server";
import { RESOLVE_HOST_HOOK, setResolvedAddresses } from "../../../test/web/resolver";
import { guardedFetch, type GuardedFetchResult } from "./guarded-fetch";

/**
 * The SSRF-guarded GET (gateway spec §3.3, §8, §10 "Unit"): schemes, addresses
 * directly and after a redirect, the redirect budget, `allowedHosts` on every
 * hop, the byte caps, the timeout, and the E2E origin escape.
 *
 * MSW answers every fetch; `test/web/resolver.ts` answers every lookup (any
 * name is public unless a test says otherwise).
 */

const MB = 1024 * 1024;

function get(url: string, extra: Partial<Parameters<typeof guardedFetch>[1]> = {}): Promise<GuardedFetchResult> {
  return guardedFetch(url, { signal: AbortSignal.timeout(5_000), maxBytes: MB, ...extra });
}

function redirect(to: string, status = 302) {
  return new HttpResponse(null, { status, headers: { Location: to } });
}

describe("guardedFetch — the happy path", () => {
  it("returns the body, the status and the content type", async () => {
    server.use(http.get("https://maker.test/page", () => HttpResponse.text("hello", { headers: { "content-type": "text/plain; charset=utf-8" } })));

    const result = await get("https://maker.test/page");

    expect(result).toMatchObject({ ok: true, url: "https://maker.test/page", status: 200, contentType: "text/plain; charset=utf-8" });
    expect(new TextDecoder().decode((result as { bytes: Uint8Array }).bytes)).toBe("hello");
  });

  it("sends the accept header and a user agent", async () => {
    let seen: Headers | undefined;
    server.use(http.get("https://maker.test/page", ({ request }) => {
      seen = request.headers;
      return HttpResponse.text("ok");
    }));

    await get("https://maker.test/page", { accept: "text/html" });

    expect(seen?.get("accept")).toBe("text/html");
    expect(seen?.get("user-agent")).toMatch(/MakerLab/);
  });
});

describe("guardedFetch — schemes", () => {
  it.each(["file:///etc/passwd", "ftp://maker.test/x", "javascript:alert(1)", "data:text/html,<p>hi</p>", "gopher://maker.test/"])(
    "refuses %s without a request",
    async (url) => {
      expect(await get(url)).toMatchObject({ ok: false, reason: "blocked", detail: "scheme" });
    }
  );

  it("refuses a string that is not a URL", async () => {
    expect(await get("not a url")).toMatchObject({ ok: false, reason: "blocked", detail: "invalid_url" });
  });

  it("refuses credentials in the URL", async () => {
    expect(await get("https://user:pass@maker.test/")).toMatchObject({ ok: false, reason: "blocked" });
  });
});

describe("guardedFetch — addresses", () => {
  it.each([
    ["http://127.0.0.1/", "loopback"],
    ["http://10.1.2.3/", "RFC 1918"],
    ["http://192.168.0.1:8080/admin", "RFC 1918"],
    ["http://169.254.169.254/latest/meta-data/", "cloud metadata"],
    ["http://[::1]/", "IPv6 loopback"],
    ["http://[fd00:ec2::254]/", "AWS IPv6 metadata"],
    ["http://[fe80::1]/", "link-local"],
    ["http://[::ffff:127.0.0.1]/", "IPv4-mapped loopback"],
    ["http://2130706433/", "loopback, as a decimal integer"],
    ["http://0x7f.1/", "loopback, in hex shorthand"],
  ])("refuses the literal %s (%s) without resolving it", async (url) => {
    const hook = vi.fn(async () => ["93.184.216.34"]);
    (globalThis as Record<symbol, unknown>)[RESOLVE_HOST_HOOK] = hook;

    expect(await get(url)).toMatchObject({ ok: false, reason: "blocked", detail: "forbidden_address" });
    expect(hook).not.toHaveBeenCalled();
  });

  it.each([
    ["127.0.0.1", "loopback"],
    ["10.0.0.7", "RFC 1918"],
    ["172.20.1.1", "RFC 1918"],
    ["169.254.10.10", "link-local"],
    ["169.254.169.254", "metadata"],
    ["fd12::1", "unique-local"],
    ["fe80::abcd", "link-local IPv6"],
    ["::ffff:10.0.0.1", "IPv4-mapped RFC 1918"],
    ["::ffff:169.254.169.254", "IPv4-mapped metadata"],
  ])("refuses a name that resolves to %s (%s)", async (address) => {
    setResolvedAddresses({ "inside.test": [address] });
    expect(await get("https://inside.test/")).toMatchObject({ ok: false, reason: "blocked", detail: "forbidden_address" });
  });

  it("refuses a name when any one of its addresses is private", async () => {
    setResolvedAddresses({ "mixed.test": ["93.184.216.34", "10.0.0.1"] });
    expect(await get("https://mixed.test/")).toMatchObject({ ok: false, reason: "blocked" });
  });

  it("refuses localhost", async () => {
    expect(await get("http://localhost:3000/")).toMatchObject({ ok: false, reason: "blocked" });
  });

  it("fails, without a request, when the name does not resolve", async () => {
    setResolvedAddresses({ "nowhere.test": [] });
    expect(await get("https://nowhere.test/")).toMatchObject({ ok: false, reason: "failed", detail: "dns" });
  });
});

describe("guardedFetch — redirects", () => {
  function chain(hops: number) {
    server.use(
      http.get("https://maker.test/r/:n", ({ params }) => {
        const n = Number(params.n);
        return n < hops ? redirect(`/r/${n + 1}`) : HttpResponse.text(`landed after ${hops}`);
      })
    );
  }

  it("follows up to three redirects, resolving a relative Location, and reports the final URL", async () => {
    chain(3);
    const result = await get("https://maker.test/r/0");
    expect(result).toMatchObject({ ok: true, url: "https://maker.test/r/3" });
    expect(new TextDecoder().decode((result as { bytes: Uint8Array }).bytes)).toBe("landed after 3");
  });

  it("refuses a fourth redirect", async () => {
    chain(4);
    expect(await get("https://maker.test/r/0")).toMatchObject({ ok: false, reason: "failed", detail: "too_many_redirects" });
  });

  it("honours a smaller maxRedirects", async () => {
    chain(2);
    expect(await get("https://maker.test/r/0", { maxRedirects: 1 })).toMatchObject({ ok: false, detail: "too_many_redirects" });
  });

  it.each([301, 303, 307, 308])("follows a %s", async (status) => {
    server.use(
      http.get("https://maker.test/old", () => redirect("https://maker.test/new", status)),
      http.get("https://maker.test/new", () => HttpResponse.text("new"))
    );
    expect(await get("https://maker.test/old")).toMatchObject({ ok: true, url: "https://maker.test/new" });
  });

  it.each([
    ["http://127.0.0.1/", "a loopback literal"],
    ["http://169.254.169.254/latest/meta-data/", "the metadata address"],
    ["http://[::ffff:169.254.169.254]/", "the IPv4-mapped metadata address"],
    ["http://[fd00:ec2::254]/", "the AWS IPv6 metadata address"],
  ])("refuses a redirect to %s (%s)", async (target) => {
    server.use(http.get("https://maker.test/bounce", () => redirect(target)));
    expect(await get("https://maker.test/bounce")).toMatchObject({ ok: false, reason: "blocked", url: expect.stringContaining(new URL(target).hostname) });
  });

  it.each([
    ["127.0.0.1", "loopback"],
    ["192.168.1.1", "RFC 1918"],
    ["169.254.1.1", "link-local"],
    ["fc00::5", "unique-local"],
    ["::ffff:127.0.0.1", "IPv4-mapped loopback"],
  ])("refuses a redirect to a name that resolves to %s (%s)", async (address) => {
    setResolvedAddresses({ "inside.test": [address] });
    const reached = vi.fn();
    server.use(
      http.get("https://maker.test/bounce", () => redirect("https://inside.test/secret")),
      http.get("https://inside.test/secret", () => {
        reached();
        return HttpResponse.text("secret");
      })
    );

    expect(await get("https://maker.test/bounce")).toMatchObject({ ok: false, reason: "blocked", url: "https://inside.test/secret" });
    expect(reached).not.toHaveBeenCalled();
  });

  it("refuses a redirect to another scheme", async () => {
    server.use(http.get("https://maker.test/bounce", () => redirect("file:///etc/passwd")));
    expect(await get("https://maker.test/bounce")).toMatchObject({ ok: false, reason: "blocked", detail: "scheme" });
  });

  it("reports a redirect with no Location", async () => {
    server.use(http.get("https://maker.test/bounce", () => new HttpResponse(null, { status: 302 })));
    expect(await get("https://maker.test/bounce")).toMatchObject({ ok: false, reason: "http_error", status: 302 });
  });
});

describe("guardedFetch — allowedHosts", () => {
  beforeEach(() => {
    server.use(
      http.get("https://maker.test/page", () => HttpResponse.text("maker")),
      http.get("https://docs.maker.test/manual", () => HttpResponse.text("docs")),
      http.get("https://elsewhere.test/page", () => HttpResponse.text("elsewhere"))
    );
  });

  it("allows the host and its subdomains", async () => {
    expect(await get("https://maker.test/page", { allowedHosts: ["maker.test"] })).toMatchObject({ ok: true });
    expect(await get("https://docs.maker.test/manual", { allowedHosts: ["Maker.Test"] })).toMatchObject({ ok: true });
  });

  it("refuses any other host, including one that merely ends the same way", async () => {
    expect(await get("https://elsewhere.test/page", { allowedHosts: ["maker.test"] })).toMatchObject({
      ok: false,
      reason: "blocked",
      detail: "host_not_allowed",
    });
    setResolvedAddresses({ "evilmaker.test": ["93.184.216.34"] });
    expect(await get("https://evilmaker.test/", { allowedHosts: ["maker.test"] })).toMatchObject({ detail: "host_not_allowed" });
  });

  it("enforces the list on every hop", async () => {
    server.use(http.get("https://maker.test/out", () => redirect("https://elsewhere.test/page")));
    expect(await get("https://maker.test/out", { allowedHosts: ["maker.test"] })).toMatchObject({
      ok: false,
      reason: "blocked",
      detail: "host_not_allowed",
      url: "https://elsewhere.test/page",
    });
  });

  it("refuses everything when the list is empty", async () => {
    expect(await get("https://maker.test/page", { allowedHosts: [] })).toMatchObject({ detail: "host_not_allowed" });
  });
});

describe("guardedFetch — status and size", () => {
  it("reports an HTTP error with its status", async () => {
    server.use(http.get("https://maker.test/gone", () => new HttpResponse("nope", { status: 404 })));
    expect(await get("https://maker.test/gone")).toMatchObject({ ok: false, reason: "http_error", status: 404 });
  });

  it("refuses a body its Content-Length says is too big, before reading it", async () => {
    server.use(
      http.get("https://maker.test/big", () =>
        new HttpResponse("x", { headers: { "content-length": String(2 * MB), "content-type": "text/html" } })
      )
    );
    expect(await get("https://maker.test/big")).toMatchObject({ ok: false, reason: "too_large" });
  });

  it("stops reading a streamed body at the cap", async () => {
    const chunk = new Uint8Array(256 * 1024);
    let pulled = 0;
    server.use(
      http.get("https://maker.test/stream", () => {
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            pulled += 1;
            if (pulled > 40) controller.close();
            else controller.enqueue(chunk);
          },
        });
        return new HttpResponse(stream, { headers: { "content-type": "application/octet-stream" } });
      })
    );

    expect(await get("https://maker.test/stream")).toMatchObject({ ok: false, reason: "too_large" });
    // One megabyte is four chunks; it gave up long before forty.
    expect(pulled).toBeLessThan(40);
  });

  it("accepts a body exactly at the cap", async () => {
    server.use(http.get("https://maker.test/exact", () => new HttpResponse(new Uint8Array(MB))));
    const result = await get("https://maker.test/exact");
    expect(result.ok && result.bytes.byteLength).toBe(MB);
  });

  it("applies a tighter cap chosen by content type", async () => {
    server.use(
      http.get("https://maker.test/html", () => new HttpResponse(new Uint8Array(600 * 1024), { headers: { "content-type": "text/html; charset=utf-8" } })),
      http.get("https://maker.test/pdf", () => new HttpResponse(new Uint8Array(600 * 1024), { headers: { "content-type": "application/pdf" } }))
    );
    const maxBytesFor = (type: string | null) => (type === "text/html" ? 512 * 1024 : MB);

    expect(await get("https://maker.test/html", { maxBytesFor })).toMatchObject({ ok: false, reason: "too_large" });
    expect(await get("https://maker.test/pdf", { maxBytesFor })).toMatchObject({ ok: true });
  });

  it("refuses a listed media type on its headers, and returns the final headers otherwise", async () => {
    server.use(
      http.get("https://maker.test/product", () => HttpResponse.html("<html>buy now</html>")),
      http.get("https://maker.test/manual", () =>
        new HttpResponse("%PDF-1.7", {
          headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="m.pdf"' },
        })
      )
    );
    const refuseTypes = ["text/html"];

    expect(await get("https://maker.test/product", { refuseTypes })).toMatchObject({
      ok: false,
      reason: "unsupported",
      status: 200,
      detail: "text/html",
    });
    const pdf = await get("https://maker.test/manual", { refuseTypes });
    expect(pdf.ok && pdf.headers.get("content-disposition")).toBe('attachment; filename="m.pdf"');
  });
});

describe("guardedFetch — time", () => {
  it("reports a timeout when the signal fires mid-request", async () => {
    server.use(
      http.get("https://maker.test/slow", async () => {
        await delay("infinite");
        return HttpResponse.text("never");
      })
    );
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("timed out", "TimeoutError")), 20);

    expect(await guardedFetch("https://maker.test/slow", { signal: controller.signal, maxBytes: MB })).toMatchObject({
      ok: false,
      reason: "timeout",
    });
  });

  it("reports a network failure as failed, never throwing", async () => {
    server.use(http.get("https://maker.test/broken", () => HttpResponse.error()));
    expect(await get("https://maker.test/broken")).toMatchObject({ ok: false, reason: "failed", detail: "network" });
  });
});

describe("guardedFetch — READ_PAGE_TEST_ORIGIN", () => {
  beforeEach(() => {
    server.use(
      http.get("http://localhost:3101/page", () => HttpResponse.text("stub")),
      http.get("http://localhost:3102/page", () => HttpResponse.text("other"))
    );
  });

  it("exempts exactly that origin from the address check when VERCEL is unset", async () => {
    vi.stubEnv("READ_PAGE_TEST_ORIGIN", "http://localhost:3101");
    vi.stubEnv("VERCEL", "");

    expect(await get("http://localhost:3101/page")).toMatchObject({ ok: true });
    expect(await get("http://localhost:3102/page")).toMatchObject({ ok: false, reason: "blocked" });
  });

  it("is ignored whenever VERCEL is set", async () => {
    vi.stubEnv("READ_PAGE_TEST_ORIGIN", "http://localhost:3101");
    vi.stubEnv("VERCEL", "1");

    expect(await get("http://localhost:3101/page")).toMatchObject({ ok: false, reason: "blocked" });
  });

  it("still enforces allowedHosts on the exempt origin", async () => {
    vi.stubEnv("READ_PAGE_TEST_ORIGIN", "http://localhost:3101");
    vi.stubEnv("VERCEL", "");

    expect(await get("http://localhost:3101/page", { allowedHosts: ["maker.test"] })).toMatchObject({ detail: "host_not_allowed" });
  });
});

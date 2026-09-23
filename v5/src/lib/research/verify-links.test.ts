// @vitest-environment node
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw/server";
import { setResolvedAddresses } from "../../../test/web/resolver";
import { NOT_CHECKED_REASON, verifyResourceLinks, verifyUrl } from "./verify-links";

/**
 * Link verification (spec §8), every outbound request answered by MSW — the
 * setup file runs it with `onUnhandledRequest: "error"`, so a link this module
 * opened without a handler would fail the test rather than reach the network.
 */

const OEMBED = "https://www.youtube.com/oembed";

describe("verifyUrl", () => {
  it("keeps a page that answers, and one that is gated or erroring", async () => {
    server.use(
      http.get("https://maker.example/ok", () => new HttpResponse("ok")),
      http.get("https://maker.example/gated", () => new HttpResponse(null, { status: 403 })),
      http.get("https://maker.example/busy", () => new HttpResponse(null, { status: 429 })),
      http.get("https://maker.example/down", () => new HttpResponse(null, { status: 503 }))
    );
    expect(await verifyUrl("https://maker.example/ok")).toEqual({ ok: true });
    // Exists but refuses a bot — dropping a real manual on a bot block is worse.
    expect(await verifyUrl("https://maker.example/gated")).toEqual({ ok: true });
    expect(await verifyUrl("https://maker.example/busy")).toEqual({ ok: true });
    expect(await verifyUrl("https://maker.example/down")).toEqual({ ok: true });
  });

  it("drops 404 and 410 with the status as the reason", async () => {
    server.use(
      http.get("https://maker.example/missing", () => new HttpResponse(null, { status: 404 })),
      http.get("https://maker.example/gone", () => new HttpResponse(null, { status: 410 }))
    );
    expect(await verifyUrl("https://maker.example/missing")).toEqual({ ok: false, reason: "HTTP 404" });
    expect(await verifyUrl("https://maker.example/gone")).toEqual({ ok: false, reason: "HTTP 410" });
  });

  it("drops an unreachable host", async () => {
    server.use(http.get("https://nowhere.example/manual.pdf", () => HttpResponse.error()));
    expect(await verifyUrl("https://nowhere.example/manual.pdf")).toEqual({
      ok: false,
      reason: "unreachable",
    });
  });

  it("asks YouTube's oEmbed rather than the watch page, and drops a video that does not exist", async () => {
    const asked: string[] = [];
    server.use(
      http.get(OEMBED, ({ request }) => {
        const target = new URL(request.url).searchParams.get("url") ?? "";
        asked.push(target);
        return target.includes("real")
          ? HttpResponse.json({ title: "A real video" })
          : new HttpResponse(null, { status: 404 });
      })
    );
    expect(await verifyUrl("https://www.youtube.com/watch?v=real")).toEqual({ ok: true });
    expect(await verifyUrl("https://youtu.be/invented")).toEqual({
      ok: false,
      reason: "video does not exist",
    });
    expect(asked).toEqual(["https://www.youtube.com/watch?v=real", "https://youtu.be/invented"]);
  });

  it("refuses a malformed URL and a non-http scheme without a request", async () => {
    expect(await verifyUrl("not a url")).toEqual({ ok: false, reason: "malformed URL" });
    expect(await verifyUrl("ftp://maker.example/manual.pdf")).toEqual({
      ok: false,
      reason: "not an http(s) URL",
    });
    expect(await verifyUrl("javascript:alert(1)")).toEqual({
      ok: false,
      reason: "not an http(s) URL",
    });
  });

  it("drops a link to a private, loopback or metadata address without requesting it (gateway spec §8)", async () => {
    let requested = 0;
    server.use(
      http.get("http://169.254.169.254/latest/meta-data/", () => {
        requested += 1;
        return new HttpResponse("secret");
      }),
      http.get("https://intranet.maker.example/manual.pdf", () => {
        requested += 1;
        return new HttpResponse("pdf");
      })
    );
    setResolvedAddresses({ "intranet.maker.example": ["10.0.0.5"] });
    const refused = { ok: false, reason: "refused (not a public web address)" };

    expect(await verifyUrl("http://169.254.169.254/latest/meta-data/")).toEqual(refused);
    expect(await verifyUrl("https://intranet.maker.example/manual.pdf")).toEqual(refused);
    expect(await verifyUrl("http://localhost:8080/admin")).toEqual(refused);
    expect(requested).toBe(0);
  });

  it("drops a public link that redirects inward", async () => {
    server.use(
      http.get("https://maker.example/sneaky", () =>
        new HttpResponse(null, { status: 302, headers: { location: "http://169.254.169.254/" } })
      )
    );
    expect(await verifyUrl("https://maker.example/sneaky")).toEqual({
      ok: false,
      reason: "refused (not a public web address)",
    });
  });

  it("follows a public redirect to the page it lands on", async () => {
    server.use(
      http.get("https://maker.example/moved", () =>
        new HttpResponse(null, { status: 301, headers: { location: "https://maker.example/manual-v2.pdf" } })
      ),
      http.get("https://maker.example/manual-v2.pdf", () => new HttpResponse(null, { status: 404 }))
    );
    expect(await verifyUrl("https://maker.example/moved")).toEqual({ ok: false, reason: "HTTP 404" });
  });

  it("throws when the caller's deadline has passed, rather than blaming the link", async () => {
    const controller = new AbortController();
    controller.abort(new Error("step deadline"));
    await expect(
      verifyUrl("https://maker.example/ok", { signal: controller.signal })
    ).rejects.toThrow("step deadline");
  });
});

describe("verifyResourceLinks", () => {
  it("keeps the verified links in order and explains each dropped one", async () => {
    server.use(
      http.get("https://maker.example/manual.pdf", () => new HttpResponse("pdf")),
      http.get("https://maker.example/old.pdf", () => new HttpResponse(null, { status: 404 })),
      http.get("https://maker.example/sop", () => new HttpResponse("sop"))
    );
    const resources = [
      { title: "Manual", url: "https://maker.example/manual.pdf", type: "Manual" as const },
      { title: "Old manual", url: "https://maker.example/old.pdf", type: "Manual" as const },
      { title: "SOP", url: "https://maker.example/sop", type: "Other" as const },
      { title: "Bad", url: "no scheme", type: "Other" as const },
    ];

    const { verified, dropped } = await verifyResourceLinks(resources);

    expect(verified.map((r) => r.title)).toEqual(["Manual", "SOP"]);
    expect(dropped).toEqual([
      'Manual "Old manual" (https://maker.example/old.pdf) — HTTP 404',
      'Other "Bad" (no scheme) — malformed URL',
    ]);
  });

  it("opens no more than maxLinks and drops the rest unopened", async () => {
    let opened = 0;
    server.use(
      http.get("https://maker.example/:page", () => {
        opened += 1;
        return new HttpResponse("ok");
      })
    );
    const resources = Array.from({ length: 5 }, (_, i) => ({
      title: `Page ${i}`,
      url: `https://maker.example/p${i}`,
      type: "Other",
    }));

    const { verified, dropped } = await verifyResourceLinks(resources, { maxLinks: 3 });

    expect(opened).toBe(3);
    expect(verified.map((r) => r.title)).toEqual(["Page 0", "Page 1", "Page 2"]);
    expect(dropped).toEqual([
      `Other "Page 3" (https://maker.example/p3) — ${NOT_CHECKED_REASON}`,
      `Other "Page 4" (https://maker.example/p4) — ${NOT_CHECKED_REASON}`,
    ]);
  });

  it("defaults the cap to eight", async () => {
    server.use(http.get("https://maker.example/:page", () => new HttpResponse("ok")));
    const resources = Array.from({ length: 10 }, (_, i) => ({
      title: `Page ${i}`,
      url: `https://maker.example/p${i}`,
      type: "Other",
    }));

    const { verified, dropped } = await verifyResourceLinks(resources);
    expect(verified).toHaveLength(8);
    expect(dropped).toHaveLength(2);
  });

  it("carries extra fields through untouched", async () => {
    server.use(http.get("https://maker.example/manual.pdf", () => new HttpResponse("pdf")));
    const { verified } = await verifyResourceLinks([
      { title: "Manual", url: "https://maker.example/manual.pdf", type: "Manual", note: "keep" },
    ]);
    expect(verified[0].note).toBe("keep");
  });
});

// @vitest-environment node
import { http, HttpResponse } from "msw";
import { makePng, makeProductPng } from "../../../../test/gateway/png";
import { server } from "../../../../test/msw/server";
import { setResolvedAddresses } from "../../../../test/web/resolver";
import { IMAGE_MAX_BYTES } from "../../intake/limits";
import type { ImageHint } from "../../web/read-page";
import { probeCandidate, probeCandidates } from "./probe";

/**
 * Probing candidates (gateway spec §3.5 step 2, §10 "filtering (size, type,
 * decode)"): through the SSRF guard, decoded from the bytes, big enough.
 * Images are answered by MSW; names resolve through test/web/resolver.ts.
 */

const signal = () => AbortSignal.timeout(10_000);

function hint(url: string): ImageHint {
  return { url, source: "og", pageUrl: "https://maker.example/p1s" };
}

function serve(url: string, bytes: Uint8Array, contentType = "image/png") {
  server.use(http.get(url, () => HttpResponse.arrayBuffer(bytes.slice().buffer, { headers: { "content-type": contentType } })));
}

describe("probeCandidate", () => {
  it("keeps a decodable image with a short edge of at least 400 px", async () => {
    const png = makePng({ width: 800, height: 400, alpha: false });
    serve("https://maker.example/hero.png", png, "application/octet-stream");

    const result = await probeCandidate(hint("https://maker.example/hero.png"), { signal: signal() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.image.info).toEqual({ format: "image/png", width: 800, height: 400, hasAlpha: false });
    expect(result.image.bytes).toEqual(png);
    expect(result.image.hint.url).toBe("https://maker.example/hero.png");
  });

  it("classifies a kept image's background while it is in hand", async () => {
    serve("https://maker.example/studio.png", makeProductPng({ width: 800, height: 600 }));
    serve("https://maker.example/pattern.png", makePng({ width: 800, height: 600, alpha: false }));

    const studio = await probeCandidate(hint("https://maker.example/studio.png"), { signal: signal() });
    const pattern = await probeCandidate(hint("https://maker.example/pattern.png"), { signal: signal() });
    expect(studio.ok && studio.image.background).toBe("plain");
    expect(pattern.ok && pattern.image.background).toBe("busy");

    // Without sharp the image is still kept, its background unknown.
    const blind = await probeCandidate(hint("https://maker.example/studio.png"), { signal: signal(), loadSharp: async () => null });
    expect(blind.ok && blind.image.background).toBeNull();
  });

  it("rejects an image smaller than 400 px on its short edge", async () => {
    serve("https://maker.example/thumb.png", makePng({ width: 1200, height: 399, alpha: false }));
    expect(await probeCandidate(hint("https://maker.example/thumb.png"), { signal: signal() })).toMatchObject({
      ok: false,
      reason: "too_small",
      detail: "1200x399",
    });
  });

  it("rejects a body that is not a JPEG, PNG or WebP, whatever it is labelled", async () => {
    serve("https://maker.example/fake.png", new TextEncoder().encode("<html>not an image</html>"), "image/png");
    serve("https://maker.example/anim.gif", new TextEncoder().encode("GIF89a\x10\x00\x10\x00"), "image/gif");
    expect(await probeCandidate(hint("https://maker.example/fake.png"), { signal: signal() })).toMatchObject({ ok: false, reason: "not_an_image" });
    expect(await probeCandidate(hint("https://maker.example/anim.gif"), { signal: signal() })).toMatchObject({ ok: false, reason: "not_an_image" });
  });

  it("never fetches a candidate on a private address", async () => {
    const fetched = vi.fn();
    server.use(http.get("http://169.254.169.254/*", () => (fetched(), HttpResponse.text("secret"))));
    server.use(http.get("https://inward.example/*", () => (fetched(), HttpResponse.text("secret"))));
    setResolvedAddresses({ "inward.example": ["10.0.0.5"] });

    expect(await probeCandidate(hint("http://169.254.169.254/latest/meta-data"), { signal: signal() })).toMatchObject({
      ok: false,
      reason: "blocked",
      detail: "forbidden_address",
    });
    expect(await probeCandidate(hint("https://inward.example/a.png"), { signal: signal() })).toMatchObject({ ok: false, reason: "blocked" });
    expect(fetched).not.toHaveBeenCalled();
  });

  it("rejects an image larger than the cap on its headers", async () => {
    server.use(
      http.get("https://maker.example/huge.png", () =>
        new HttpResponse(new Uint8Array(16), { headers: { "content-type": "image/png", "content-length": String(IMAGE_MAX_BYTES + 1) } })
      )
    );
    expect(await probeCandidate(hint("https://maker.example/huge.png"), { signal: signal() })).toMatchObject({ ok: false, reason: "too_large" });
  });

  it("reports an HTTP failure as a rejection, not a throw", async () => {
    server.use(http.get("https://maker.example/gone.png", () => new HttpResponse(null, { status: 404 })));
    expect(await probeCandidate(hint("https://maker.example/gone.png"), { signal: signal() })).toMatchObject({ ok: false, reason: "http_error" });
  });
});

describe("probeCandidates", () => {
  it("answers in the order given, three at a time at most", async () => {
    let inFlight = 0;
    let most = 0;
    server.use(
      http.get("https://maker.example/img/:n", async ({ params }) => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5 + ((Number(params.n) * 7) % 5)));
        inFlight -= 1;
        const size = Number(params.n) === 2 ? 100 : 500;
        return HttpResponse.arrayBuffer(makePng({ width: size, height: size, alpha: false }).slice().buffer);
      })
    );
    const hints = Array.from({ length: 7 }, (_, n) => hint(`https://maker.example/img/${n}`));

    const results = await probeCandidates(hints, { signal: signal() });

    expect(results.map((r) => (r.ok ? r.image.hint.url : r.hint.url))).toEqual(hints.map((h) => h.url));
    expect(results.map((r) => r.ok)).toEqual([true, true, false, true, true, true, true]);
    expect(most).toBeLessThanOrEqual(3);
    expect(most).toBeGreaterThan(1);
  });

  it("answers nothing for nothing", async () => {
    expect(await probeCandidates([], { signal: signal() })).toEqual([]);
  });
});

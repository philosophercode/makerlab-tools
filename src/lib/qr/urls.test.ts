import { toolPageUrl as scriptToolPageUrl } from "../../../scripts/generate-qr-labels";
import { parseQrQuery } from "./query";
import { DEFAULT_SITE_URL, qrSiteUrl } from "./site-url";
import {
  QR_SOURCE_PARAM,
  QR_SOURCE_VALUE,
  QR_UNIT_PARAM,
  displayUrl,
  parseUnitToken,
  qrFileName,
  qrImagePath,
  toolPageUrl,
  toolQrTargetUrl,
  unitForToken,
  unitQrTargetUrl,
  unitQrToken,
} from "./urls";

describe("what a code encodes", () => {
  it("is the tool page with ?src=qr — the format the printed labels and the arrival notice use", () => {
    expect(toolQrTargetUrl("https://makerlab-ai.vercel.app", "form-4")).toBe("https://makerlab-ai.vercel.app/tools/form-4?src=qr");
    expect(`${QR_SOURCE_PARAM}=${QR_SOURCE_VALUE}`).toBe("src=qr");
  });

  it("is exactly what the label script prints, so old and new labels behave the same", () => {
    for (const slug of ["form-4", "trotec-speedy-400", "odd slug/é"]) {
      expect(toolQrTargetUrl("https://x.test/", slug)).toBe(scriptToolPageUrl("https://x.test/", slug));
    }
  });

  it("trims a trailing slash and escapes the slug", () => {
    expect(toolQrTargetUrl("https://x.test///", "a b")).toBe("https://x.test/tools/a%20b?src=qr");
    expect(toolPageUrl("https://x.test/", "form-4")).toBe("https://x.test/tools/form-4");
  });

  it("reads under a code without scheme or query", () => {
    expect(displayUrl("https://makerlab-ai.vercel.app/tools/form-4?src=qr")).toBe("makerlab-ai.vercel.app/tools/form-4");
  });
});

describe("the image route's addresses", () => {
  it("builds relative image paths", () => {
    expect(qrImagePath("form-4", "svg")).toBe("/api/qr/form-4?format=svg");
    expect(qrImagePath("form-4", "png", { size: 1024, download: true })).toBe("/api/qr/form-4?format=png&size=1024&download=1");
  });

  it("names downloads after the slug", () => {
    expect(qrFileName("form-4", "png")).toBe("form-4-qr.png");
    expect(qrFileName("form-4", "svg", "label")).toBe("form-4-label.svg");
    expect(qrFileName("../../x", "png")).toBe("x-qr.png");
  });

  it("parses the query: svg by default, PNG size bounded", () => {
    expect(parseQrQuery(new URLSearchParams(""))).toEqual({ format: "svg", size: 512, download: false });
    expect(parseQrQuery(new URLSearchParams("format=PNG&size=2048&download=1"))).toEqual({ format: "png", size: 2048, download: true });
    expect(parseQrQuery(new URLSearchParams("format=jpeg"))).toEqual({ error: "invalid_format" });
    expect(parseQrQuery(new URLSearchParams("format=png&size=127"))).toEqual({ error: "invalid_size" });
    expect(parseQrQuery(new URLSearchParams("format=png&size=1e3"))).toEqual({ error: "invalid_size" });
  });
});

describe("qrSiteUrl", () => {
  it("prefers NEXT_PUBLIC_SITE_URL, then Vercel's production domain, then the live site", () => {
    expect(qrSiteUrl({ NEXT_PUBLIC_SITE_URL: "https://tools.example.edu/", VERCEL_PROJECT_PRODUCTION_URL: "x.vercel.app" })).toBe("https://tools.example.edu");
    expect(qrSiteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "makerlab.example.app" })).toBe("https://makerlab.example.app");
    expect(qrSiteUrl({})).toBe(DEFAULT_SITE_URL);
    expect(DEFAULT_SITE_URL).toBe("https://makerlab-ai.vercel.app");
  });
});

describe("a unit's code (amendment 2026-10-06)", () => {
  const unitId = "194e4406-253b-4488-a886-5598ee56112c";

  it("is the tool's code with the unit's eight-character token", () => {
    expect(unitQrToken(unitId)).toBe("194e4406");
    expect(unitQrTargetUrl("https://makerlab-ai.vercel.app", "prusa-i3-mk3s", unitId)).toBe(
      "https://makerlab-ai.vercel.app/tools/prusa-i3-mk3s?src=qr&unit=194e4406"
    );
    expect(QR_UNIT_PARAM).toBe("unit");
  });

  it("reads under the code as the tool's address: the query is dropped", () => {
    expect(displayUrl(unitQrTargetUrl("https://makerlab-ai.vercel.app", "prusa-i3-mk3s", unitId))).toBe("makerlab-ai.vercel.app/tools/prusa-i3-mk3s");
  });

  it("parses the token, a longer prefix or the whole id, and nothing else", () => {
    expect(parseUnitToken("194e4406")).toBe("194e4406");
    expect(parseUnitToken(" 194E4406 ")).toBe("194e4406");
    expect(parseUnitToken(unitId)).toBe("194e4406253b4488a8865598ee56112c");
    for (const bad of [null, undefined, "", "194e440", "zzzzzzzz", "194e4406;drop", "<script>", "194e4406/../x"]) {
      expect(parseUnitToken(bad)).toBeNull();
    }
  });

  it("names a unit only when exactly one of the tool's units matches", () => {
    const units = [
      { id: unitId, name: "Prusa MK3S+ #4" },
      { id: "adf75899-7fc0-49e2-bfef-d6af0be787f5", name: "Prusa MK3S+ #1" },
    ];
    expect(unitForToken(units, "194e4406")?.name).toBe("Prusa MK3S+ #4");
    expect(unitForToken(units, parseUnitToken(unitId))?.name).toBe("Prusa MK3S+ #4");
    expect(unitForToken(units, "00000000")).toBeNull();
    expect(unitForToken(units, null)).toBeNull();
    // Two units sharing the prefix: neither is named, rather than the wrong one.
    expect(unitForToken([...units, { id: "194e4406-0000-4000-8000-000000000000", name: "Twin" }], "194e4406")).toBeNull();
  });
});

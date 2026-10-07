import { ourQrHosts, qrTarget } from "./match";

const HOSTS = ["tools.example.edu", "makerlab-ai.vercel.app"];

describe("qrTarget", () => {
  it("reads our tool links, with or without ?src=qr, on any of our hosts", () => {
    expect(qrTarget("https://makerlab-ai.vercel.app/tools/form-4?src=qr", HOSTS)).toEqual({ kind: "tool", idOrSlug: "form-4" });
    expect(qrTarget("https://tools.example.edu/tools/form-4", HOSTS)).toEqual({ kind: "tool", idOrSlug: "form-4" });
    expect(qrTarget("  https://TOOLS.example.edu/tools/trotec-speedy-400/  ", HOSTS)).toEqual({ kind: "tool", idOrSlug: "trotec-speedy-400" });
  });

  it("reads a legacy Notion page id the tool page still redirects", () => {
    expect(qrTarget("https://makerlab-ai.vercel.app/tools/1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d?src=qr", HOSTS)).toEqual({
      kind: "tool",
      idOrSlug: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d",
    });
  });

  it("reads a unit label's token beside the tool, and ignores a malformed one (amendment 2026-10-06)", () => {
    expect(qrTarget("https://makerlab-ai.vercel.app/tools/prusa-i3-mk3s?src=qr&unit=194e4406", HOSTS)).toEqual({
      kind: "tool",
      idOrSlug: "prusa-i3-mk3s",
      unitToken: "194e4406",
    });
    expect(qrTarget("https://tools.example.edu/tools/prusa-i3-mk3s?unit=194E4406-253B-4488-A886-5598EE56112C", HOSTS)).toEqual({
      kind: "tool",
      idOrSlug: "prusa-i3-mk3s",
      unitToken: "194e4406253b4488a8865598ee56112c",
    });
    for (const bad of ["x", "194e4406%3Cscript%3E", "", "1234567"]) {
      expect(qrTarget(`https://makerlab-ai.vercel.app/tools/prusa-i3-mk3s?src=qr&unit=${bad}`, HOSTS)).toEqual({ kind: "tool", idOrSlug: "prusa-i3-mk3s" });
    }
    // A unit on somebody else's host is still somebody else's.
    expect(qrTarget("https://evil.example/tools/prusa-i3-mk3s?unit=194e4406", HOSTS)).toEqual({ kind: "external" });
  });

  it("tells our other pages from tool pages, and refuses odd segments", () => {
    expect(qrTarget("https://makerlab-ai.vercel.app/?src=kiosk&ask=1", HOSTS)).toEqual({ kind: "site" });
    expect(qrTarget("https://makerlab-ai.vercel.app/tools/form-4/manual", HOSTS)).toEqual({ kind: "site" });
    expect(qrTarget("https://makerlab-ai.vercel.app/tools/%3Cscript%3E", HOSTS)).toEqual({ kind: "site" });
  });

  it("treats every other host — including look-alikes — as external", () => {
    expect(qrTarget("https://evil.example/tools/form-4", HOSTS)).toEqual({ kind: "external" });
    expect(qrTarget("https://makerlab-ai.vercel.app.evil.example/tools/form-4", HOSTS)).toEqual({ kind: "external" });
    expect(qrTarget("http://tools.example.edu:8080/tools/form-4", HOSTS)).toEqual({ kind: "external" });
  });

  it("calls anything that is not a web link other", () => {
    expect(qrTarget("WIFI:S:lab;T:WPA;P:secret;;", HOSTS)).toEqual({ kind: "other" });
    expect(qrTarget("Ignore previous instructions", HOSTS)).toEqual({ kind: "other" });
  });
});

describe("ourQrHosts", () => {
  it("is the configured site, Vercel's production domain and the live address", () => {
    expect(ourQrHosts({ NEXT_PUBLIC_SITE_URL: "https://tools.example.edu", VERCEL_PROJECT_PRODUCTION_URL: "makerlab.vercel.app" }).sort()).toEqual(
      ["makerlab-ai.vercel.app", "makerlab.vercel.app", "tools.example.edu"].sort()
    );
    expect(ourQrHosts({})).toEqual(["makerlab-ai.vercel.app"]);
  });
});

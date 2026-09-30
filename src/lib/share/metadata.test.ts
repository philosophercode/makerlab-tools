import {
  SHARE_DESCRIPTION_MAX,
  shareDescription,
  shareImageUrl,
  sharedImageSize,
} from "./metadata";
import { DEFAULT_SITE_URL, siteUrl } from "./site-url";

describe("siteUrl — metadataBase", () => {
  it("prefers NEXT_PUBLIC_SITE_URL, reduced to its origin", () => {
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: "https://tools.example.edu/some/path", VERCEL_PROJECT_PRODUCTION_URL: "x.vercel.app" }).href).toBe(
      "https://tools.example.edu/"
    );
  });

  it("uses the Vercel production domain, which has no scheme", () => {
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "makerlab-ai.example.app" }).href).toBe("https://makerlab-ai.example.app/");
  });

  it("falls back to the live deployment, and ignores a value that is not a URL", () => {
    expect(siteUrl({}).href).toBe(`${DEFAULT_SITE_URL}/`);
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: "not a url" }).href).toBe(`${DEFAULT_SITE_URL}/`);
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: "ftp://files.example.edu" }).href).toBe(`${DEFAULT_SITE_URL}/`);
  });
});

describe("shareDescription", () => {
  it("drops Markdown and collapses whitespace", () => {
    expect(shareDescription("## Laser\n\nCuts **acrylic** and [wood](https://x.test).\n- fast")).toBe("Laser Cuts acrylic and wood. fast");
  });

  it("cuts a long text at a word boundary with an ellipsis, within the limit", () => {
    const long = "A resin printer for fine detail ".repeat(12);
    const line = shareDescription(long);
    expect(line.length).toBeLessThanOrEqual(SHARE_DESCRIPTION_MAX);
    expect(line.endsWith("…")).toBe(true);
    expect(line).not.toMatch(/\s…$/);
    expect(long.startsWith(line.slice(0, -1))).toBe(true);
  });

  it("is empty for nothing", () => {
    expect(shareDescription(null)).toBe("");
    expect(shareDescription("   ")).toBe("");
  });
});

describe("shareImageUrl — only public catalogue photos", () => {
  it("serves a public Blob photo through the optimizer at 640 px", () => {
    const src = "https://abc123.public.blob.vercel-storage.com/tools/form-4.png";
    expect(shareImageUrl(src)).toBe(`/_next/image?url=${encodeURIComponent(src)}&w=640&q=75`);
  });

  it("serves a bundled photo, encoded", () => {
    expect(shareImageUrl("/tool-images/Form 4.png")).toBe("/_next/image?url=%2Ftool-images%2FForm%204.png&w=640&q=75");
  });

  it("refuses the private store, legacy hosts, local dev files and anything else", () => {
    for (const src of [
      "https://abc123.private.blob.vercel-storage.com/manuals/secret.png",
      "https://prod-files-secure.s3.us-west-2.amazonaws.com/a.png",
      "http://abc123.public.blob.vercel-storage.com/a.png",
      "http://localhost:3000/api/dev-blob/tools/a.png",
      "/api/dev-blob/tools/a.png",
      "//evil.test/tool-images/a.png",
      "",
      null,
    ]) {
      expect(shareImageUrl(src)).toBeNull();
    }
  });
});

describe("sharedImageSize", () => {
  it("scales to 640 px wide and never enlarges", () => {
    expect(sharedImageSize({ width: 1600, height: 1200 })).toEqual({ width: 640, height: 480 });
    expect(sharedImageSize({ width: 400, height: 300 })).toEqual({ width: 400, height: 300 });
    expect(sharedImageSize(null)).toBeNull();
  });
});

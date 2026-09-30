import { MAX_MANUALS_RESOLVED, needsResolving, resolveManualLinks } from "./resolve-manual-links";

/**
 * Research follows a Manual link that is a download page to the PDF, keeping
 * the page beside it (manual text spec amendment 2026-09-28). The resolver is
 * a stub here; `manuals/resolve-pdf.test.ts` covers it over saved pages.
 */

type Link = { title: string; url: string; type: "Manual" | "Video" | "Other" };

describe("needsResolving", () => {
  it("is a Manual that is not a PDF address, or a share link hiding one", () => {
    expect(needsResolving({ title: "m", url: "https://x.example/support/manual", type: "Manual" })).toBe(true);
    expect(needsResolving({ title: "m", url: "https://x.example/m.pdf", type: "Manual" })).toBe(false);
    expect(needsResolving({ title: "m", url: "https://www.dropbox.com/s/a/m.pdf?dl=0", type: "Manual" })).toBe(true);
    expect(needsResolving({ title: "v", url: "https://youtu.be/x", type: "Video" })).toBe(false);
  });
});

describe("resolveManualLinks", () => {
  const links: Link[] = [
    { title: "X1C user manual", url: "https://bambulab.com/en-us/support/x1c/manual", type: "Manual" },
    { title: "Product page", url: "https://bambulab.com/en-us/x1", type: "Other" },
  ];

  it("makes the Manual the PDF and keeps the page as a download page", async () => {
    const resolve = vi.fn(async () => ({
      status: "pdf" as const,
      pdfUrl: "https://bambulab.com/media/x1c-en.pdf",
      landingUrl: "https://bambulab.com/en-us/support/x1c/manual",
      via: "<iframe> src",
      hops: 1,
    }));
    const { links: out, notes } = await resolveManualLinks(links, { resolve });
    expect(out).toEqual([
      { title: "X1C user manual", url: "https://bambulab.com/media/x1c-en.pdf", type: "Manual" },
      { title: "Product page", url: "https://bambulab.com/en-us/x1", type: "Other" },
      { title: "X1C user manual — download page", url: "https://bambulab.com/en-us/support/x1c/manual", type: "Other" },
    ]);
    expect(notes[0]).toContain("resolved to a PDF on bambulab.com");
  });

  it("keeps a link that does not resolve, and one the resolver throws on", async () => {
    const notFound = vi.fn(async () => ({ status: "not_found" as const, reason: "no PDF on the page", tried: [] }));
    expect((await resolveManualLinks(links, { resolve: notFound })).links).toEqual(links);
    const throws = vi.fn(async () => {
      throw new Error("boom");
    });
    expect((await resolveManualLinks(links, { resolve: throws })).links).toEqual(links);
  });

  it("tries at most two manuals, and rethrows the step's deadline", async () => {
    const many: Link[] = Array.from({ length: 4 }, (_, i) => ({ title: `m${i}`, url: `https://x.example/m${i}`, type: "Manual" }));
    const resolve = vi.fn(async () => ({ status: "not_found" as const, reason: "x", tried: [] }));
    await resolveManualLinks(many, { resolve });
    expect(resolve).toHaveBeenCalledTimes(MAX_MANUALS_RESOLVED);

    const controller = new AbortController();
    controller.abort();
    const aborting = vi.fn(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    await expect(resolveManualLinks(links, { resolve: aborting, signal: controller.signal })).rejects.toBeTruthy();
  });
});

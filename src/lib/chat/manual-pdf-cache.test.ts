// @vitest-environment node
import { cachedManualPdf, clearManualPdfCache } from "./manual-pdf-cache";

beforeEach(() => {
  clearManualPdfCache();
  vi.useRealTimers();
});

describe("cachedManualPdf", () => {
  it("loads once and answers the next turn from memory", async () => {
    const load = vi.fn(async () => "JVBERi0=");
    expect(await cachedManualPdf("https://x.test/a.pdf", load)).toBe("JVBERi0=");
    expect(await cachedManualPdf("https://x.test/a.pdf", load)).toBe("JVBERi0=");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keeps facts read from the bytes beside them (the page count)", async () => {
    const load = vi.fn(async () => ({ data: "JVBERi0=", pageCount: 12 }));
    await cachedManualPdf("https://x.test/p.pdf", load);
    expect(await cachedManualPdf("https://x.test/p.pdf", load)).toEqual({ data: "JVBERi0=", pageCount: 12 });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("shares one in-flight fetch between concurrent turns", async () => {
    let release: (value: string) => void = () => {};
    const load = vi.fn(() => new Promise<string>((resolve) => (release = resolve)));
    const both = Promise.all([cachedManualPdf("https://x.test/b.pdf", load), cachedManualPdf("https://x.test/b.pdf", load)]);
    release("data");
    expect(await both).toEqual(["data", "data"]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not remember a failure, so the next turn tries again", async () => {
    const load = vi.fn(async () => null as string | null).mockResolvedValueOnce(null).mockResolvedValueOnce("ok");
    expect(await cachedManualPdf("https://x.test/c.pdf", load)).toBeNull();
    expect(await cachedManualPdf("https://x.test/c.pdf", load)).toBe("ok");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("fetches again once the entry is ten minutes old", async () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => "data");
    await cachedManualPdf("https://x.test/d.pdf", load);
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    await cachedManualPdf("https://x.test/d.pdf", load);
    expect(load).toHaveBeenCalledTimes(2);
  });
});

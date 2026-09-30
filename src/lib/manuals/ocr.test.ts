// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GatewayInvalidRequestError, GatewayRateLimitError } from "@ai-sdk/gateway";
import { OCR_FALLBACK_PAGE_COST_USD, ocrKey, ocrManual, OCR_VERSION } from "./ocr";
import type { RenderedPages } from "./page-images";
import type { PageTranscript } from "./transcribe";

/**
 * OCR for a scanned manual (manual text spec phase 3): pages drawn, read by
 * the model (a stub here), assembled into a `ready` document with an outline —
 * within the page and cost caps, and with failures as values.
 */

const fixture = (name: string) => new Uint8Array(readFileSync(join(process.cwd(), "test/fixtures/manuals", name)));

const LONG =
  "Clean the lens and mirrors every 20 hours of cutting with the supplied wipes. Empty the crumb tray weekly " +
  "and check the exhaust hose for blockages. Replace the air filter when the indicator turns red.";

function transcript(text: string, headings: PageTranscript["headings"] = [], cost: number | null = 0.001): PageTranscript {
  return { text, headings, inputTokens: 900, outputTokens: 200, cost };
}

/** Pages 1..n, each with a picture (a stand-in JPEG). */
function rendered(n: number, pageCount = n): RenderedPages {
  return {
    pageCount,
    pages: Array.from({ length: n }, (_, i) => ({ pageNumber: i + 1, jpeg: new Uint8Array([i]), width: 10, height: 13 })),
    labels: Array.from({ length: pageCount }, (_, i) => (i === 0 ? "i" : null)),
  };
}

describe("ocrManual", () => {
  it("draws the real scan, reads each page with a picture, and stores every page at its own number", async () => {
    const transcribe = vi.fn(async (_jpeg: Uint8Array, page: number) =>
      transcript(page === 1 ? `Maintenance\n${LONG}` : `Maintenance\nLens and mirrors\n${LONG}`, [
        { title: "Maintenance", level: 1 },
        ...(page === 2 ? [{ title: "Lens and mirrors", level: 2 }] : []),
      ])
    );
    const result = await ocrManual(fixture("scanned-image.pdf"), { transcribe });

    expect(result.status).toBe("read");
    if (result.status !== "read") return;
    // Page 3 paints no picture: nothing to read, no call.
    expect(transcribe).toHaveBeenCalledTimes(2);
    expect(transcribe.mock.calls.map(([jpeg, page]) => [jpeg[0], page])).toEqual([
      [0xff, 1],
      [0xff, 2],
    ]);
    expect(result).toMatchObject({ pagesRead: 2, pagesBlank: 1, pagesFailed: 0, capped: null, inputTokens: 1800, outputTokens: 400 });
    expect(result.cost).toBeCloseTo(0.002);
    expect(result.manual).toMatchObject({ status: "ready", reason: null, pageCount: 3, outlineSource: "inferred" });
    expect(result.manual.pages.map((p) => [p.pageNumber, p.source])).toEqual([
      [1, "ocr"],
      [2, "ocr"],
      [3, "text"],
    ]);
    expect(result.manual.pages[2].text).toBe("");
    // "Maintenance" heads both pages: one outline entry, not a running header twice.
    expect(result.manual.outline).toEqual([
      { title: "Maintenance", page: 1, level: 1 },
      { title: "Lens and mirrors", page: 2, level: 2 },
    ]);
  });

  it("reads at most maxPages pages and marks the document partial", async () => {
    const render = vi.fn(async (_bytes: Uint8Array, { maxPages }: { maxPages: number }) => rendered(maxPages, 10));
    const result = await ocrManual(new Uint8Array(), { render, maxPages: 3, transcribe: async () => transcript(LONG) });
    expect(render).toHaveBeenCalledWith(expect.anything(), { maxPages: 3 });
    expect(result).toMatchObject({ status: "read", pagesRead: 3, pagesSkipped: 7, capped: "pages" });
    if (result.status !== "read") return;
    expect(result.manual).toMatchObject({ status: "ready", reason: "ocr_partial", pageCount: 10 });
    expect(result.manual.pages).toHaveLength(10);
    expect(result.manual.pages[0].label).toBe("i");
  });

  it("starts no page once the reported cost reaches the budget", async () => {
    const result = await ocrManual(new Uint8Array(), {
      render: async () => rendered(6),
      concurrency: 1,
      maxCost: 0.02,
      transcribe: async () => transcript(LONG, [], 0.01),
    });
    expect(result).toMatchObject({ status: "read", pagesRead: 2, pagesSkipped: 4, capped: "cost" });
    expect(result.cost).toBeCloseTo(0.02);
  });

  it("stores a page the model refuses as empty, and goes on", async () => {
    const result = await ocrManual(new Uint8Array(), {
      render: async () => rendered(3),
      concurrency: 1,
      transcribe: async (_jpeg, page) => {
        if (page === 2) throw new GatewayInvalidRequestError({ message: "refused", statusCode: 400 });
        return transcript(LONG);
      },
    });
    expect(result).toMatchObject({ status: "read", pagesRead: 2, pagesFailed: 1 });
    if (result.status === "read") expect(result.manual.pages[1]).toMatchObject({ text: "", source: "text" });
  });

  it("fails, recording nothing, when the model refuses every page (a configuration problem, not the scan)", async () => {
    const transcribe = vi.fn(async () => {
      throw new GatewayInvalidRequestError({ message: "model does not accept images", statusCode: 400 });
    });
    const result = await ocrManual(new Uint8Array(), { render: async () => rendered(20), concurrency: 1, transcribe });
    expect(result).toMatchObject({ status: "failed", reason: "model", kind: "invalid_request", transient: false, pagesRead: 0 });
    // Stops after a few refusals instead of spending a call on every page.
    expect(transcribe).toHaveBeenCalledTimes(3);
  });

  it("fails when a short scan's only pages are all refused", async () => {
    const result = await ocrManual(new Uint8Array(), {
      render: async () => rendered(2),
      transcribe: async () => {
        throw new GatewayInvalidRequestError({ message: "refused", statusCode: 400 });
      },
    });
    expect(result).toMatchObject({ status: "failed", reason: "model", kind: "invalid_request", transient: false, pagesFailed: 2 });
  });

  it("counts a page whose images could not be drawn as failed, not blank, and fails a scan of only those", async () => {
    const transcribe = vi.fn(async () => transcript(LONG));
    const result = await ocrManual(new Uint8Array(), {
      render: async () => ({
        pageCount: 2,
        pages: [1, 2].map((n) => ({ pageNumber: n, jpeg: null, width: 0, height: 0, undrawn: 1 })),
        labels: [null, null],
      }),
      transcribe,
    });
    expect(result).toMatchObject({ status: "failed", reason: "unreadable", pagesFailed: 2, pagesBlank: 0 });
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("holds the cost cap when the Gateway reports no cost, counting a fallback per page", async () => {
    const result = await ocrManual(new Uint8Array(), {
      render: async () => rendered(10),
      concurrency: 1,
      maxCost: OCR_FALLBACK_PAGE_COST_USD * 3,
      transcribe: async () => transcript(LONG, [], null),
    });
    expect(result).toMatchObject({ status: "read", pagesRead: 3, pagesSkipped: 7, capped: "cost", cost: null });
  });

  it("does not start more pages than the budget covers while others are in flight", async () => {
    const result = await ocrManual(new Uint8Array(), {
      render: async () => rendered(12),
      concurrency: 4,
      maxCost: 0.05,
      transcribe: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return transcript(LONG, [], 0.01);
      },
    });
    expect(result.status).toBe("read");
    // The first four start before any cost is known; after that, in-flight pages count at the average.
    expect(result.pagesRead).toBeLessThanOrEqual(8);
    expect(result.cost ?? 0).toBeLessThanOrEqual(0.08 + 1e-9);
    expect(result.capped).toBe("cost");
  });

  it("stops at a rate limit: nothing to store, and the next run tries again", async () => {
    const result = await ocrManual(new Uint8Array(), {
      render: async () => rendered(5),
      concurrency: 1,
      transcribe: async (_jpeg, page) => {
        if (page === 2) throw new GatewayRateLimitError({ message: "slow down", statusCode: 429 });
        return transcript(LONG);
      },
    });
    expect(result).toMatchObject({ status: "failed", reason: "model", kind: "rate_limited", transient: true, pagesRead: 1 });
  });

  it("stops, not transient, when the model cannot be reached for a reason a retry would not fix", async () => {
    const result = await ocrManual(new Uint8Array(), {
      render: async () => rendered(2),
      transcribe: async () => {
        throw new Error("no model stubbed");
      },
    });
    expect(result).toMatchObject({ status: "failed", reason: "model", kind: "unknown", transient: false });
  });

  it("keeps a scan with nothing legible as no_text", async () => {
    const result = await ocrManual(new Uint8Array(), { render: async () => rendered(2), transcribe: async () => transcript("") });
    expect(result).toMatchObject({ status: "read", pagesRead: 2 });
    if (result.status === "read") expect(result.manual).toMatchObject({ status: "no_text", pages: [], outline: [] });
  });

  it("answers unreadable when the pages cannot be drawn", async () => {
    const result = await ocrManual(fixture("corrupt.pdf"), { transcribe: async () => transcript(LONG) });
    expect(result).toMatchObject({ status: "failed", reason: "unreadable", transient: false, pagesRead: 0 });
  });
});

describe("ocrKey", () => {
  it("records the OCR version and the model", () => {
    expect(ocrKey("openai/gpt-6-luna")).toBe(`${OCR_VERSION}:openai/gpt-6-luna`);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Must mock "server-only" before any import that pulls it in
vi.mock("server-only", () => ({}));

// Mock unpdf to avoid loading native code in tests
vi.mock("unpdf", () => ({
  getDocumentProxy: vi.fn(),
  extractText: vi.fn(),
}));

// We re-import the module fresh per test to reset the module-level cache.
let fetchDocContent: typeof import("@/lib/doc-fetcher").fetchDocContent;

describe("doc-fetcher", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    vi.resetModules();

    // Re-apply mocks after module reset
    vi.mock("server-only", () => ({}));
    vi.mock("unpdf", () => ({
      getDocumentProxy: vi.fn(),
      extractText: vi.fn(),
    }));

    globalThis.fetch = vi.fn();

    const mod = await import("@/lib/doc-fetcher");
    fetchDocContent = mod.fetchDocContent;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ── Google Docs ────────────────────────────────────────────────

  describe("Google Docs URLs", () => {
    it("fetches the export URL for a Google Doc", async () => {
      const docUrl =
        "https://docs.google.com/document/d/1aBcDeFgHiJkLmNoPqRsTuVwXyZ/edit";

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response("This is the document content.", { status: 200 })
      );

      const result = await fetchDocContent(docUrl);

      expect(result).toBe("This is the document content.");

      const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(calledUrl).toBe(
        "https://docs.google.com/document/d/1aBcDeFgHiJkLmNoPqRsTuVwXyZ/export?format=txt"
      );
    });

    it("returns null when Google Doc export fails", async () => {
      const docUrl =
        "https://docs.google.com/document/d/1aBcDeFgHiJkLmNoPqRsTuVwXyZ/edit";

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response("Forbidden", { status: 403 })
      );

      const result = await fetchDocContent(docUrl);

      expect(result).toBeNull();
    });
  });

  // ── PDF URLs ───────────────────────────────────────────────────

  describe("PDF URLs", () => {
    it("fetches PDF content and extracts text via unpdf", async () => {
      const pdfUrl = "https://example.com/document.pdf";
      const pdfBuffer = new Uint8Array([1, 2, 3]);

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(pdfBuffer, { status: 200 })
      );

      const unpdf = await import("unpdf");
      const mockProxy = { numPages: 1 };
      vi.mocked(unpdf.getDocumentProxy).mockResolvedValueOnce(mockProxy as any);
      vi.mocked(unpdf.extractText).mockResolvedValueOnce({
        totalPages: 1,
        text: ["Page one content."] as unknown as string,
      });

      const result = await fetchDocContent(pdfUrl);

      expect(result).toBe("[Page 1]\nPage one content.");
    });

    it("handles multi-page PDFs", async () => {
      const pdfUrl = "https://example.com/manual.pdf";
      const pdfBuffer = new Uint8Array([1, 2, 3]);

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(pdfBuffer, { status: 200 })
      );

      const unpdf = await import("unpdf");
      const mockProxy = { numPages: 2 };
      vi.mocked(unpdf.getDocumentProxy).mockResolvedValueOnce(mockProxy as any);
      vi.mocked(unpdf.extractText).mockResolvedValueOnce({
        totalPages: 2,
        text: ["First page text.", "Second page text."] as unknown as string,
      });

      const result = await fetchDocContent(pdfUrl);

      expect(result).toContain("[Page 1]");
      expect(result).toContain("First page text.");
      expect(result).toContain("[Page 2]");
      expect(result).toContain("Second page text.");
    });
  });

  // ── Plain HTML ─────────────────────────────────────────────────

  describe("HTML content", () => {
    it("strips HTML tags and returns plain text", async () => {
      const htmlUrl = "https://example.com/page";

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(
          "<html><body><h1>Hello</h1><p>World</p></body></html>",
          {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          }
        )
      );

      const result = await fetchDocContent(htmlUrl);

      expect(result).toContain("Hello");
      expect(result).toContain("World");
      expect(result).not.toContain("<h1>");
      expect(result).not.toContain("<p>");
    });

    it("strips script and style tags from HTML", async () => {
      const htmlUrl = "https://example.com/scripted";

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(
          '<html><head><style>body{color:red}</style></head><body><script>alert("xss")</script><p>Content</p></body></html>',
          {
            status: 200,
            headers: { "Content-Type": "text/html" },
          }
        )
      );

      const result = await fetchDocContent(htmlUrl);

      expect(result).toContain("Content");
      expect(result).not.toContain("alert");
      expect(result).not.toContain("color:red");
    });
  });

  // ── Plain text ─────────────────────────────────────────────────

  describe("plain text content", () => {
    it("returns plain text content directly", async () => {
      const txtUrl = "https://example.com/readme.txt";

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response("Just some plain text.", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        })
      );

      const result = await fetchDocContent(txtUrl);

      expect(result).toBe("Just some plain text.");
    });
  });

  // ── Error handling ─────────────────────────────────────────────

  describe("error handling", () => {
    it("returns null on network error", async () => {
      vi.mocked(globalThis.fetch).mockRejectedValueOnce(
        new Error("Network error")
      );

      const result = await fetchDocContent("https://example.com/broken");

      expect(result).toBeNull();
    });

    it("returns null on non-OK response for web pages", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response("Not Found", { status: 404 })
      );

      const result = await fetchDocContent("https://example.com/missing");

      expect(result).toBeNull();
    });

    it("returns null for YouTube URLs (skipped)", async () => {
      const result = await fetchDocContent(
        "https://www.youtube.com/watch?v=abc123"
      );

      expect(result).toBeNull();
      // Should not have called fetch at all
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("returns null for youtu.be short URLs (skipped)", async () => {
      const result = await fetchDocContent("https://youtu.be/abc123");

      expect(result).toBeNull();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
  });

  // ── Caching ────────────────────────────────────────────────────

  describe("caching", () => {
    it("caches results and does not fetch again on second call", async () => {
      const url = "https://example.com/cached-page";

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response("Cached content", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        })
      );

      const first = await fetchDocContent(url);
      const second = await fetchDocContent(url);

      expect(first).toBe("Cached content");
      expect(second).toBe("Cached content");
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it("caches null results (e.g. YouTube URLs)", async () => {
      const url = "https://www.youtube.com/watch?v=xyz";

      const first = await fetchDocContent(url);
      const second = await fetchDocContent(url);

      expect(first).toBeNull();
      expect(second).toBeNull();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
  });

  // ── Truncation ─────────────────────────────────────────────────

  describe("truncation", () => {
    it("truncates content to MAX_TEXT_LENGTH (30,000 chars)", async () => {
      const longText = "x".repeat(50_000);

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(longText, {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        })
      );

      const result = await fetchDocContent("https://example.com/long");

      expect(result).toHaveLength(30_000);
    });
  });
});

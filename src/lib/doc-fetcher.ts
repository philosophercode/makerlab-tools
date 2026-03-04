import "server-only";

const MAX_TEXT_LENGTH = 30_000; // ~30k chars ≈ ~8k tokens
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Module-level cache persists across requests within the same serverless instance
const docCache = new Map<string, { text: string | null; expires: number }>();

function getCached(url: string): string | null | undefined {
  const entry = docCache.get(url);
  if (!entry) return undefined;
  if (Date.now() > entry.expires) {
    docCache.delete(url);
    return undefined;
  }
  return entry.text;
}

function setCache(url: string, text: string | null) {
  // Evict oldest entries if cache grows too large (max 50 docs)
  if (docCache.size >= 50) {
    const oldest = docCache.keys().next().value;
    if (oldest) docCache.delete(oldest);
  }
  docCache.set(url, { text, expires: Date.now() + CACHE_TTL });
}

// ── Type detection ──────────────────────────────────────────────────

function extractGoogleDocId(url: string): string | null {
  const match = url.match(
    /docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/
  );
  return match ? match[1] : null;
}

function isPdfUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return false;
  }
}

// ── Fetchers ────────────────────────────────────────────────────────

async function fetchGoogleDocText(url: string): Promise<string | null> {
  const docId = extractGoogleDocId(url);
  if (!docId) return null;

  const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`;
  const res = await fetch(exportUrl, { next: { revalidate: 300 } });
  if (!res.ok) return null;
  return await res.text();
}

async function extractPdfWithPages(buffer: Uint8Array): Promise<string> {
  const { getDocumentProxy, extractText } = await import("unpdf");
  const pdf = await getDocumentProxy(buffer);
  const { text: pages } = await extractText(pdf, { mergePages: false });
  // pages is an array of strings, one per page
  const pageArray = Array.isArray(pages) ? pages : [pages];
  return pageArray
    .map((pageText, i) => {
      const trimmed = (typeof pageText === "string" ? pageText : "").trim();
      return trimmed ? `[Page ${i + 1}]\n${trimmed}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

async function fetchPdfText(url: string): Promise<string | null> {
  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) return null;

  const buffer = new Uint8Array(await res.arrayBuffer());
  return extractPdfWithPages(buffer);
}

async function fetchWebPageText(url: string): Promise<string | null> {
  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) return null;

  const contentType = res.headers.get("content-type") || "";

  // Response is actually a PDF
  if (contentType.includes("application/pdf")) {
    const buffer = new Uint8Array(await res.arrayBuffer());
    return extractPdfWithPages(buffer);
  }

  if (contentType.includes("text/plain")) {
    return await res.text();
  }

  if (contentType.includes("text/html")) {
    const html = await res.text();
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  return null;
}

// ── Main entry point ────────────────────────────────────────────────

/**
 * Fetch text content from a document URL.
 * Supports: Google Docs, PDFs, HTML pages, plain text.
 * YouTube URLs are skipped (transcript APIs are unreliable).
 * Returns null if the URL isn't accessible or content can't be extracted.
 */
export async function fetchDocContent(url: string): Promise<string | null> {
  // Check cache first
  const cached = getCached(url);
  if (cached !== undefined) return cached;

  try {
    // Skip YouTube — transcript APIs are currently broken
    if (url.includes("youtube.com") || url.includes("youtu.be")) {
      setCache(url, null);
      return null;
    }

    let text: string | null = null;

    if (extractGoogleDocId(url)) {
      text = await fetchGoogleDocText(url);
    } else if (isPdfUrl(url)) {
      text = await fetchPdfText(url);
    } else {
      text = await fetchWebPageText(url);
    }

    const result = text ? text.slice(0, MAX_TEXT_LENGTH) : null;
    setCache(url, result);
    return result;
  } catch {
    setCache(url, null);
    return null;
  }
}

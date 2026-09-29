import { sql } from "drizzle-orm";
import { rawRows } from "../db/raw.ts";
import { countPages } from "./page-count.ts";
import type { Db } from "../db/types.ts";
import { hasPdfMagic } from "../web/pdf-magic.ts";
import type { DocumentEvidence } from "./citation-check.ts";

/**
 * The evidence `citation-check.ts` judges an answer's citations on, gathered
 * for a list of PDF addresses (no fragment): what a GET of each answers, how
 * many pages the PDF has, and the page texts the lab stores for the document
 * whose attachment has that address.
 *
 * For the eval and tests only — never on a request path. The fetch is the
 * caller's (a test's MSW, the eval's local blob server), because the addresses
 * are the lab's own store, not the web.
 */

export interface GatherOptions {
  db: Db;
  fetchImpl?: typeof fetch;
  /** Bodies larger than this are not parsed for a page count. Default 30 MB. */
  maxBytes?: number;
}

export async function gatherCitationEvidence(
  urls: readonly string[],
  options: GatherOptions
): Promise<Map<string, DocumentEvidence>> {
  const out = new Map<string, DocumentEvidence>();
  for (const url of new Set(urls)) out.set(url, await evidenceFor(url, options));
  return out;
}

async function evidenceFor(url: string, options: GatherOptions): Promise<DocumentEvidence> {
  const pages = await storedPages(options.db, url);
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(url, { signal: AbortSignal.timeout(20_000) });
  } catch {
    return { status: 0, contentType: null, pdfMagic: false, pageCount: null, pages };
  }
  const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() || null;
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => {});
    return { status: response.status, contentType, pdfMagic: false, pageCount: null, pages };
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const pdfMagic = hasPdfMagic(bytes);
  const pageCount = pdfMagic && bytes.byteLength <= (options.maxBytes ?? 30 * 1024 * 1024) ? await countPages(bytes) : null;
  return { status: 200, contentType, pdfMagic, pageCount, pages };
}

export { countPages };

/** The stored text of each page of the document whose attachment is at `url`. */
async function storedPages(db: Db, url: string): Promise<Map<number, string>> {
  const rows = await rawRows<{ page_number: number; text: string }>(
    db,
    sql`select p.page_number, p.text
          from manual_pages p
          join manual_documents d on d.id = p.document_id
          join attachments a on a.id = d.attachment_id
         where a.public_url = ${url}
         order by p.page_number`
  );
  return new Map(rows.map((row) => [Number(row.page_number), row.text]));
}

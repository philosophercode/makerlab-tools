import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { saveManualDocument } from "@/lib/data/manual-documents";
import { getDb } from "@/lib/db/client";
import { attachments, resources, tools } from "@/lib/db/schema/index";
import type { ManualOutlineEntry } from "@/lib/db/schema/index";
import { EXTRACTOR_VERSION } from "@/lib/manuals/extract";
import { ocrKey } from "@/lib/manuals/ocr";
import { buildDocumentPassages } from "@/lib/manuals/passages";
import { buildPdf, type PdfPage } from "../test/fixtures/manuals/build-pdf";
import { startLocalBlobServer, type LocalBlobServer } from "./local-blob-server";

/**
 * A small, fixed Form 4 manual for the chat evals (manual text spec §10:
 * "how do I replace the resin tank on the Form 4 must call search_manual and
 * cite a page"). It is written for the eval, not copied from Formlabs, and it
 * deliberately says **nothing about specifications** — the catalog records
 * none, and `form4-build-volume-unknown` must stay a case where any number is
 * invented. Nor does it say anything about the warranty, which is what the
 * "manual does not cover it" case asks.
 *
 * Beside it, a **scanned** Form Wash guide whose pages OCR read (manual text
 * spec phase 3): stored as `manuals:index` stores an OCR'd scan — pages marked
 * `ocr`, `ocr_version` set — so `form4-wash-time-from-scan` checks that an
 * answer from a transcribed page still cites its own page. It is written for
 * the eval too, and says nothing about sizes or resolution.
 *
 * `seedEvalManual()` stores both on the demo seed's Form 4 as public,
 * processed manuals and builds their passages with the deployment's embedding
 * model (job `embed` — a real, sub-cent Gateway call, like the rest of
 * `npm run eval`). Search itself runs for real (reranked, like the chat's).
 *
 * **The files are real** (manual text spec amendment 2026-09-28): each manual
 * is a PDF with the fixture's page count and words, stored in a local Blob
 * store in a temp folder and served over HTTP on 127.0.0.1
 * (`local-blob-server.ts`), and the attachment's `public_url` is that address
 * — so `citations_resolve` can GET every cited page and check it the way a
 * student's click would.
 */

export const EVAL_MANUAL_TITLE = "Form 4 Manual";
export const EVAL_MANUAL_PATHNAME = "manuals/form-4-manual.pdf";

/** Page number → text. Pages not listed are blank. */
const PAGES: Record<number, string> = {
  2: "Contents\nPreparing the printer\nPrinting\nMaintenance\nTroubleshooting",
  12: "Preparing the printer\nPlace the printer on a level, stable surface away from direct sunlight. Leave room behind it for the cables.",
  30: "Printing\nChanging the resin cartridge\nOpen the cover. Close the cartridge valve cap, lift the cartridge straight out of its slot, and insert the new cartridge until it clicks. Shake a new cartridge before inserting it.",
  38: "Maintenance\nCleaning the build platform\nAfter every print, remove the parts and wipe the build platform with a lint-free towel soaked in isopropyl alcohol. Let it dry fully before the next print.",
  42: "Maintenance\nReplacing the resin tank\nWear gloves. Remove the build platform first. Then lift the resin tank straight up out of the tank carrier, keeping it level so resin does not spill, and set it on a flat surface. Slide the new tank into the carrier until both tabs are seated. A tank whose film is scratched or clouded must be replaced.",
  48: "Troubleshooting\nPrint failed to adhere to the build platform\nCheck that the build platform is clean and dry, that the resin tank film is not clouded, and that the part was oriented with supports. Run the platform calibration from the touchscreen if failures continue.",
};

const OUTLINE = [
  { title: "Preparing the printer", page: 12, level: 1 },
  { title: "Printing", page: 30, level: 1 },
  { title: "Changing the resin cartridge", page: 30, level: 2 },
  { title: "Maintenance", page: 38, level: 1 },
  { title: "Cleaning the build platform", page: 38, level: 2 },
  { title: "Replacing the resin tank", page: 42, level: 2 },
  { title: "Troubleshooting", page: 48, level: 1 },
];

const PAGE_COUNT = 50;

export const EVAL_SCAN_TITLE = "Form Wash Guide (scanned)";
export const EVAL_SCAN_PATHNAME = "manuals/form-wash-guide.pdf";

/** The scan's pages, as OCR read them. */
const SCAN_PAGES: Record<number, string> = {
  1: "Form Wash Guide\nWashing and drying resin prints",
  3: "Washing prints\nWear gloves. Wash printed parts in isopropyl alcohol (IPA) for 10 minutes. Do not leave parts in IPA for more than 20 minutes: they can crack or swell. Replace the IPA when it looks cloudy.",
  5: "Drying\nLet washed parts air-dry for at least 30 minutes before post-curing. Do not post-cure parts that are still wet with IPA.",
};

const SCAN_OUTLINE = [
  { title: "Washing prints", page: 3, level: 1 },
  { title: "Drying", page: 5, level: 1 },
];

const SCAN_PAGE_COUNT = 6;

let server: LocalBlobServer | null = null;

/**
 * Store the fixture manuals on the demo Form 4 — real PDFs in the eval's local
 * Blob store, served on 127.0.0.1 — and build their passages. Idempotent per
 * process; returns the file server (its origin is the eval's "local blob
 * origin").
 */
export async function seedEvalManual(): Promise<LocalBlobServer> {
  server ??= await startLocalBlobServer(mkdtempSync(join(tmpdir(), "makerlab-eval-blob-")));
  const db = await getDb();
  const [form4] = await db.select({ id: tools.id }).from(tools).where(eq(tools.slug, "form-4"));
  if (!form4) throw new Error("the demo seed has no form-4 tool");
  const stored = async (pathname: string) =>
    (await db.select({ id: attachments.id }).from(attachments).where(eq(attachments.blobPathname, pathname))).length > 0;

  // Each document on its own: a run that stored the manual and failed on the scan adds the scan next time.
  if (!(await stored(EVAL_MANUAL_PATHNAME))) await seedDocument(server, form4.id, {
    title: EVAL_MANUAL_TITLE,
    pathname: EVAL_MANUAL_PATHNAME,
    pageCount: PAGE_COUNT,
    pages: PAGES,
    outline: OUTLINE,
    ocr: false,
  });
  if (!(await stored(EVAL_SCAN_PATHNAME))) await seedDocument(server, form4.id, {
    title: EVAL_SCAN_TITLE,
    pathname: EVAL_SCAN_PATHNAME,
    pageCount: SCAN_PAGE_COUNT,
    pages: SCAN_PAGES,
    outline: SCAN_OUTLINE,
    ocr: true,
  });
  return server;
}

/** Stop the eval's file server. */
export async function stopEvalManualServer(): Promise<void> {
  await server?.close();
  server = null;
}

/** A PDF with `pageCount` pages carrying the fixture's words, a line per text line. */
export function fixturePdf(pageCount: number, pages: Record<number, string>): Uint8Array {
  const pdfPages: PdfPage[] = Array.from({ length: pageCount }, (_, i) => ({
    lines: (pages[i + 1] ?? "")
      .split("\n")
      .filter(Boolean)
      .map((text, line) => ({ text, size: 10, x: 54, y: 740 - line * 16 })),
  }));
  return buildPdf({ pages: pdfPages });
}

async function seedDocument(
  files: LocalBlobServer,
  toolId: string,
  doc: {
    title: string;
    pathname: string;
    pageCount: number;
    pages: Record<number, string>;
    outline: ManualOutlineEntry[];
    /** Stored as an OCR'd scan: pages marked `ocr`, `ocr_version` set. */
    ocr: boolean;
  }
): Promise<void> {
  await files.store.put(doc.pathname, fixturePdf(doc.pageCount, doc.pages), {
    access: "public",
    contentType: "application/pdf",
    allowOverwrite: true,
  });
  const url = files.url(doc.pathname);
  const db = await getDb();
  const [resource] = await db
    .insert(resources)
    .values({ toolId, title: doc.title, type: "Manual", url: null })
    .returning({ id: resources.id });
  const [attachment] = await db
    .insert(attachments)
    .values({
      ownerType: "resource",
      ownerId: resource.id,
      blobPathname: doc.pathname,
      access: "public",
      publicUrl: url,
      contentType: "application/pdf",
      origin: "upload",
    })
    .returning({ id: attachments.id });
  const documentId = await saveManualDocument(db, {
    attachmentId: attachment.id,
    toolId,
    title: doc.title,
    status: "ready",
    statusReason: null,
    pageCount: doc.pageCount,
    outline: doc.outline,
    outlineSource: doc.ocr ? "inferred" : "pdf",
    extractorVersion: EXTRACTOR_VERSION,
    ocrVersion: doc.ocr ? ocrKey() : null,
    pages: Array.from({ length: doc.pageCount }, (_, i) => ({
      pageNumber: i + 1,
      label: null,
      text: doc.pages[i + 1] ?? "",
      source: doc.ocr && doc.pages[i + 1] ? ("ocr" as const) : ("text" as const),
    })),
  });
  const built = await buildDocumentPassages(db, documentId);
  if (built.status !== "built") throw new Error(`the eval manual's passages were not built: ${JSON.stringify(built)}`);
}

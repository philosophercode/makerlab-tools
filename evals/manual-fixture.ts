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
import type { EmbeddingTarget } from "@/lib/manuals/embed";
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

/**
 * An **attached, not indexed** manual (manual text spec amendment 2026-09-28b
 * "Attached manuals cite pages too"): a Trotec operator guide uploaded as a
 * PDF with no `manual_documents` row, so `search_manual` cannot read it and
 * the chat attaches it whole — the case the X1-Carbon's quick-start guide is
 * in production. The model cites its pages as `#cite-<ref>-<page>`, which
 * `citations_resolve` checks against the manual the harness attached. Written
 * for the eval, and — like the Form 4 manual — free of numbers other than its
 * page numbers, so no spec case can take a figure from it.
 */
export const EVAL_ATTACHED_TITLE = "Trotec Speedy 400 Operator Guide";
export const EVAL_ATTACHED_PATHNAME = "manuals/trotec-speedy-400-operator-guide.pdf";

const ATTACHED_PAGES: Record<number, string> = {
  1: "Trotec Speedy 400 Operator Guide\nFor lab members who have completed laser training",
  3: "Before you start\nTurn on the exhaust and check that it is running. Confirm your material is on the lab's approved material list. A fire watch stays at the machine for the whole job: never leave the laser running unattended.",
  5: "Focusing the lens\nHang the focus tool on the lens head. Raise the work table slowly until the material just touches the focus tool and the tool tips over, then stop the table. Remove the focus tool before you start the job.",
  7: "Starting a job\nSend the job from the print dialog, select it on the control panel and press start. Keep the lid closed while the laser runs.",
  8: "After the job\nLet the exhaust clear the fumes before you open the lid. Remove your parts and any scraps from the honeycomb table.",
  9: "Emergency\nIf a flame keeps burning, press the red emergency stop on the right side of the gantry and tell staff.",
};

const ATTACHED_PAGE_COUNT = 10;

/**
 * Two searchable manuals for the **lab** phase (manual text spec amendment
 * 2026-10-06 "An answer cites only its machine's documents"): another FDM
 * printer's handbook and another laser's manual, so a question about the
 * X1-Carbon or the Trotec has a near-miss from a look-alike machine to
 * avoid. Production has both: unscoped searches answered FDM questions from
 * the Prusa handbook and Trotec questions from the Epilog manual (citation
 * audit 2026-10-06, F2). Written for the eval, not copied from Prusa or
 * Epilog, and free of figures.
 */
export const EVAL_PRUSA_TITLE = "Original Prusa i3 MK3S+ Handbook";
export const EVAL_PRUSA_PATHNAME = "manuals/prusa-i3-mk3s-plus-handbook.pdf";

const PRUSA_PAGES: Record<number, string> = {
  1: "Original Prusa i3 MK3S+ Handbook",
  25: "Loading the filament\nPreheat the nozzle from the LCD menu and choose the material. Push the filament into the extruder until the gears grab it, then select Load filament and wait until plastic comes out of the nozzle.",
  40: "First layer adhesion\nClean the spring steel sheet with isopropyl alcohol before every print. Run First Layer Calibration from the LCD menu and adjust Live Z until the first layer is slightly squished onto the sheet.",
};

const PRUSA_OUTLINE = [
  { title: "Loading the filament", page: 25, level: 1 },
  { title: "First layer adhesion", page: 40, level: 1 },
];

const PRUSA_PAGE_COUNT = 44;

export const EVAL_EPILOG_TITLE = "Epilog Helix Laser System Manual";
export const EVAL_EPILOG_PATHNAME = "manuals/epilog-helix-manual.pdf";

const EPILOG_PAGES: Record<number, string> = {
  1: "Epilog Helix Laser System Manual",
  52: "Focusing the lens\nPlace the V-shaped manual focus gauge on the lens carriage. Raise the table with the Up key until the material touches the gauge, then take the gauge away. Or press Focus on the keypad to use Auto Focus.",
};

const EPILOG_OUTLINE = [{ title: "Focusing the lens", page: 52, level: 1 }];

const EPILOG_PAGE_COUNT = 60;

let server: LocalBlobServer | null = null;

/**
 * Store the fixture manuals on the demo Form 4 — real PDFs in the eval's local
 * Blob store, served on 127.0.0.1 — and build their passages. Idempotent per
 * process; returns the file server (its origin is the eval's "local blob
 * origin"). `target` embeds the passages with another model (the manual
 * question eval's offline run passes a fake one); default: job `embed`.
 */
export async function seedEvalManual(options: { target?: EmbeddingTarget } = {}): Promise<LocalBlobServer> {
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
    target: options.target,
  });
  if (!(await stored(EVAL_SCAN_PATHNAME))) await seedDocument(server, form4.id, {
    title: EVAL_SCAN_TITLE,
    pathname: EVAL_SCAN_PATHNAME,
    pageCount: SCAN_PAGE_COUNT,
    pages: SCAN_PAGES,
    outline: SCAN_OUTLINE,
    ocr: true,
    target: options.target,
  });
  await seedEvalAttachedManual(server);
  return server;
}

/**
 * Upload the Trotec's operator guide to `files` as a public PDF resource with
 * no manual document — attached whole, never searchable. Idempotent; no model
 * call, so the offline harness test uses it too. Returns its resource id.
 */
export async function seedEvalAttachedManual(files: LocalBlobServer): Promise<string> {
  const db = await getDb();
  const [existing] = await db
    .select({ ownerId: attachments.ownerId })
    .from(attachments)
    .where(eq(attachments.blobPathname, EVAL_ATTACHED_PATHNAME));
  if (existing?.ownerId) return existing.ownerId;
  const [trotec] = await db.select({ id: tools.id }).from(tools).where(eq(tools.slug, "trotec-speedy-400"));
  if (!trotec) throw new Error("the demo seed has no trotec-speedy-400 tool");
  await files.store.put(EVAL_ATTACHED_PATHNAME, fixturePdf(ATTACHED_PAGE_COUNT, ATTACHED_PAGES), {
    access: "public",
    contentType: "application/pdf",
    allowOverwrite: true,
  });
  const [resource] = await db
    .insert(resources)
    .values({ toolId: trotec.id, title: EVAL_ATTACHED_TITLE, type: "Manual", url: null })
    .returning({ id: resources.id });
  await db.insert(attachments).values({
    ownerType: "resource",
    ownerId: resource.id,
    blobPathname: EVAL_ATTACHED_PATHNAME,
    access: "public",
    publicUrl: files.url(EVAL_ATTACHED_PATHNAME),
    contentType: "application/pdf",
    origin: "upload",
  });
  return resource.id;
}

/**
 * Store the lab phase's look-alike manuals (the Prusa handbook, the Epilog
 * manual) on their machines, searchable. Call after `seedEvalLabCatalog()`
 * and `seedEvalManual()`; idempotent per process. One sub-cent embedding call.
 */
export async function seedEvalLabManuals(): Promise<void> {
  if (!server) throw new Error("seedEvalManual() starts the eval's file server; call it first");
  const db = await getDb();
  const toolBySlug = async (slug: string) => {
    const [row] = await db.select({ id: tools.id }).from(tools).where(eq(tools.slug, slug));
    if (!row) throw new Error(`the lab fixture has no ${slug} tool; seed it first`);
    return row.id;
  };
  const stored = async (pathname: string) =>
    (await db.select({ id: attachments.id }).from(attachments).where(eq(attachments.blobPathname, pathname))).length > 0;
  if (!(await stored(EVAL_PRUSA_PATHNAME))) {
    await seedDocument(server, await toolBySlug("prusa-i3-mk3s-plus"), {
      title: EVAL_PRUSA_TITLE,
      pathname: EVAL_PRUSA_PATHNAME,
      pageCount: PRUSA_PAGE_COUNT,
      pages: PRUSA_PAGES,
      outline: PRUSA_OUTLINE,
      ocr: false,
    });
  }
  if (!(await stored(EVAL_EPILOG_PATHNAME))) {
    await seedDocument(server, await toolBySlug("epilog-helix-24"), {
      title: EVAL_EPILOG_TITLE,
      pathname: EVAL_EPILOG_PATHNAME,
      pageCount: EPILOG_PAGE_COUNT,
      pages: EPILOG_PAGES,
      outline: EPILOG_OUTLINE,
      ocr: false,
    });
  }
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
    /** The embedding model for its passages; job `embed` by default. */
    target?: EmbeddingTarget;
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
  const built = await buildDocumentPassages(db, documentId, doc.target ? { target: doc.target } : {});
  if (built.status !== "built") throw new Error(`the eval manual's passages were not built: ${JSON.stringify(built)}`);
}

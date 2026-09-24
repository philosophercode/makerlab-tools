import { eq } from "drizzle-orm";
import { saveManualDocument } from "@/lib/data/manual-documents";
import { getDb } from "@/lib/db/client";
import { attachments, resources, tools } from "@/lib/db/schema/index";
import { EXTRACTOR_VERSION } from "@/lib/manuals/extract";
import { buildDocumentPassages } from "@/lib/manuals/passages";

/**
 * A small, fixed Form 4 manual for the chat evals (manual text spec §10:
 * "how do I replace the resin tank on the Form 4 must call search_manual and
 * cite a page"). It is written for the eval, not copied from Formlabs, and it
 * deliberately says **nothing about specifications** — the catalog records
 * none, and `form4-build-volume-unknown` must stay a case where any number is
 * invented. Nor does it say anything about the warranty, which is what the
 * "manual does not cover it" case asks.
 *
 * `seedEvalManual()` stores it on the demo seed's Form 4 as a public,
 * processed manual and builds its passages with the deployment's embedding
 * model (job `embed` — a real, sub-cent Gateway call, like the rest of
 * `npm run eval`). Search itself runs for real.
 */

export const EVAL_MANUAL_TITLE = "Form 4 Manual";
export const EVAL_MANUAL_URL = "https://eval.blob.test/manuals/form-4-manual.pdf";

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

/** Store the fixture manual on the demo Form 4 and build its passages. Idempotent per process. */
export async function seedEvalManual(): Promise<void> {
  const db = await getDb();
  const [form4] = await db.select({ id: tools.id }).from(tools).where(eq(tools.slug, "form-4"));
  if (!form4) throw new Error("the demo seed has no form-4 tool");
  const existing = await db.select({ id: attachments.id }).from(attachments).where(eq(attachments.publicUrl, EVAL_MANUAL_URL));
  if (existing.length > 0) return;

  const [resource] = await db
    .insert(resources)
    .values({ toolId: form4.id, title: EVAL_MANUAL_TITLE, type: "Manual", url: null })
    .returning({ id: resources.id });
  const [attachment] = await db
    .insert(attachments)
    .values({
      ownerType: "resource",
      ownerId: resource.id,
      blobPathname: "manuals/form-4-manual.pdf",
      access: "public",
      publicUrl: EVAL_MANUAL_URL,
      contentType: "application/pdf",
      origin: "upload",
    })
    .returning({ id: attachments.id });
  const documentId = await saveManualDocument(db, {
    attachmentId: attachment.id,
    toolId: form4.id,
    title: EVAL_MANUAL_TITLE,
    status: "ready",
    statusReason: null,
    pageCount: PAGE_COUNT,
    outline: OUTLINE,
    outlineSource: "pdf",
    extractorVersion: EXTRACTOR_VERSION,
    pages: Array.from({ length: PAGE_COUNT }, (_, i) => ({ pageNumber: i + 1, label: null, text: PAGES[i + 1] ?? "" })),
  });
  const built = await buildDocumentPassages(db, documentId);
  if (built.status !== "built") throw new Error(`the eval manual's passages were not built: ${JSON.stringify(built)}`);
}

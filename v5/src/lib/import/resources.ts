import type { ResourceOrigin } from "../db/schema/vocabulary.ts";
import type { ImportLink, LabDoc } from "./types.ts";

/**
 * What an imported item's links become at approval (bulk intake spec §3.4).
 *
 * - **Lab documents** become resources of type `Other` with `origin =
 *   'lab_document'`, titled as the row titled them. They always come along:
 *   nothing reads them, so there is nothing to choose.
 * - **Product or manual links** from the list become ordinary resources — a
 *   `Manual` when the link is a PDF, `Other` otherwise, titled with the link's
 *   host — when the approver keeps them ticked.
 *
 * Pure and client-safe: the preliminary page shows the same titles and types.
 */

export interface ApprovalResource {
  title: string;
  url: string;
  type: string;
  origin?: ResourceOrigin | null;
}

export function labDocResource(doc: LabDoc): ApprovalResource {
  return { title: doc.title.trim() || "Lab document", url: doc.url, type: "Other", origin: "lab_document" };
}

export function importLinkResource(link: ImportLink): ApprovalResource {
  let host = "";
  let pdf = false;
  try {
    const url = new URL(link.url);
    host = url.hostname.replace(/^www\./, "");
    pdf = url.pathname.toLowerCase().endsWith(".pdf");
  } catch {
    // Stored links were validated as http(s) on the way in.
  }
  return { title: host || link.url, url: link.url, type: pdf ? "Manual" : "Other" };
}

/**
 * The resources approval creates beyond research's own, in order: the kept
 * import links, then every lab document, skipping any URL already in `taken`.
 */
export function importApprovalResources(
  input: { links: ImportLink[]; labDocs: LabDoc[]; keepLinkUrls?: string[] },
  taken: Iterable<string>
): ApprovalResource[] {
  const seen = new Set(taken);
  const keep = input.keepLinkUrls ? new Set(input.keepLinkUrls) : null;
  const out: ApprovalResource[] = [];
  for (const link of input.links) {
    if (keep && !keep.has(link.url)) continue;
    if (seen.has(link.url)) continue;
    seen.add(link.url);
    out.push(importLinkResource(link));
  }
  for (const doc of input.labDocs) {
    if (seen.has(doc.url)) continue;
    seen.add(doc.url);
    out.push(labDocResource(doc));
  }
  return out;
}

/**
 * The units approval creates for an item of `quantity` with `serials`: at
 * least one, as many as the quantity, and each serial on its own unit — the
 * first unit's serial is the one the reviewer confirmed, when they did.
 */
export function approvalUnits(
  labelBase: string,
  quantity: number,
  serials: readonly string[],
  firstSerial: string | null | undefined,
  startAt = 1
): { unitLabel: string; serialNumber: string | null }[] {
  const count = Math.max(1, Math.floor(quantity) || 1, serials.length);
  return Array.from({ length: count }, (_, index) => {
    const serial = index === 0 && firstSerial !== undefined ? firstSerial : (serials[index] ?? null);
    return { unitLabel: `${labelBase} #${startAt + index}`, serialNumber: serial?.trim() || null };
  });
}

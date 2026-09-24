import { attachments, resources, tools, type ManualOutlineEntry } from "../../src/lib/db/schema/index";
import type { Db } from "../../src/lib/db/types";
import { saveManualDocument } from "../../src/lib/data/manual-documents";
import { EXTRACTOR_VERSION } from "../../src/lib/manuals/extract";

/**
 * Seeding manuals straight into PGlite for the phase-2 search tests: a tool,
 * a resource, a current PDF attachment and a stored `ready` document with the
 * given pages — no PDF, no extraction. Passages are built by the test itself
 * (`buildDocumentPassages` with a fake embedding target).
 */

export interface SeedToolInput {
  name: string;
  slug?: string;
  published?: boolean;
  archived?: boolean;
}

export async function seedTool(db: Db, input: SeedToolInput): Promise<string> {
  const [row] = await db
    .insert(tools)
    .values({
      name: input.name,
      slug: input.slug ?? input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      published: input.published ?? true,
      archivedAt: input.archived ? new Date() : null,
    })
    .returning({ id: tools.id });
  return row.id;
}

export interface SeedManualInput {
  toolId: string;
  title: string;
  pages: string[];
  outline?: ManualOutlineEntry[];
  access?: "public" | "private";
  /** The resource's published flag (the editor's Hide). */
  published?: boolean;
  status?: "ready" | "no_text" | "failed";
  type?: string;
}

export interface SeededManual {
  resourceId: string;
  attachmentId: string;
  documentId: string;
  publicUrl: string | null;
}

export async function seedManual(db: Db, input: SeedManualInput): Promise<SeededManual> {
  const [resource] = await db
    .insert(resources)
    .values({
      toolId: input.toolId,
      title: input.title,
      type: input.type ?? "Manual",
      url: null,
      published: input.published ?? true,
    })
    .returning({ id: resources.id });
  const access = input.access ?? "public";
  const publicUrl = access === "public" ? `https://blob.test/${resource.id}/manual.pdf` : null;
  const [attachment] = await db
    .insert(attachments)
    .values({
      ownerType: "resource",
      ownerId: resource.id,
      blobPathname: `resources/${resource.id}.pdf`,
      access,
      publicUrl,
      contentType: "application/pdf",
      origin: "upload",
    })
    .returning({ id: attachments.id });
  const status = input.status ?? "ready";
  const documentId = await saveManualDocument(db, {
    attachmentId: attachment.id,
    toolId: input.toolId,
    title: input.title,
    status,
    statusReason: status === "ready" ? null : status === "no_text" ? "no_text_layer" : "corrupt",
    pageCount: input.pages.length,
    outline: input.outline ?? [],
    outlineSource: input.outline?.length ? "pdf" : "none",
    extractorVersion: EXTRACTOR_VERSION,
    pages: input.pages.map((text, i) => ({ pageNumber: i + 1, label: null, text })),
  });
  return { resourceId: resource.id, attachmentId: attachment.id, documentId, publicUrl };
}

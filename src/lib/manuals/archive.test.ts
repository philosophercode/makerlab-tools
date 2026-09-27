// @vitest-environment node
import { eq } from "drizzle-orm";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw/server";
import { setResolvedAddresses } from "../../../test/web/resolver";
import { manualSourceKey } from "../data/manual-archives";
import { createPgliteDb } from "../db/pglite";
import { attachments, resources, tools } from "../db/schema/index";
import type { Db } from "../db/types";
import type { BlobUploader } from "../import/files";
import {
  archiveManual,
  filenameFromDisposition,
  looksLikePdf,
  MAX_MANUAL_BYTES,
} from "./archive";

/**
 * The manual archive against PGlite, with the manufacturer answered by MSW and
 * Blob by an in-memory uploader. No environment, no network.
 */

const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n");

let db: Db;
let toolId: string;
let puts: Array<{ pathname: string; access: string; contentType?: string; bytes: number }>;
let uploader: BlobUploader;

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await db.delete(attachments);
  await db.delete(tools);
  const [tool] = await db.insert(tools).values({ slug: "p1s", name: "Bambu Lab P1S", published: true }).returning({ id: tools.id });
  toolId = tool.id;
  puts = [];
  let n = 0;
  uploader = {
    async put(pathname, body, options) {
      n += 1;
      puts.push({ pathname, access: options.access, contentType: options.contentType, bytes: body.byteLength });
      const stored = pathname.replace(/\.pdf$/, `-r${n}.pdf`);
      return { pathname: stored, url: `https://blob.test/${stored}` };
    },
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function resource(values: Partial<typeof resources.$inferInsert> = {}): Promise<string> {
  const [row] = await db
    .insert(resources)
    .values({ toolId, title: "P1S manual", type: "Manual", url: "https://maker.test/p1s-manual.pdf", ...values })
    .returning({ id: resources.id });
  return row.id;
}

function servePdf(url: string, headers: Record<string, string> = {}) {
  server.use(
    http.get(url, () =>
      HttpResponse.arrayBuffer(PDF.slice().buffer, { headers: { "content-type": "application/pdf", ...headers } })
    )
  );
}

async function owned(resourceId: string) {
  return db.select().from(attachments).where(eq(attachments.ownerId, resourceId));
}

describe("archiveManual", () => {
  it("archives a manual PDF into Blob as a public attachment owned by the resource", async () => {
    const id = await resource();
    servePdf("https://maker.test/p1s-manual.pdf");

    const result = await archiveManual(id, { db, uploader });

    expect(result).toMatchObject({ status: "archived", reason: "archived", sizeBytes: PDF.byteLength });
    expect(puts).toEqual([
      { pathname: `manuals/${toolId}/${id}.pdf`, access: "public", contentType: "application/pdf", bytes: PDF.byteLength },
    ]);
    const [row] = await owned(id);
    expect(row).toMatchObject({
      ownerType: "resource",
      ownerId: id,
      access: "public",
      contentType: "application/pdf",
      sizeBytes: PDF.byteLength,
      originalFilename: "p1s-manual.pdf",
      sourceKey: manualSourceKey(id, "https://maker.test/p1s-manual.pdf"),
      publicUrl: `https://blob.test/manuals/${toolId}/${id}-r1.pdf`,
      // The attribution every copy records (gateway spec §4.2).
      origin: "manual_archive",
      sourceUrl: "https://maker.test/p1s-manual.pdf",
    });
    // The manufacturer's link stays on the resource.
    const [kept] = await db.select({ url: resources.url }).from(resources).where(eq(resources.id, id));
    expect(kept.url).toBe("https://maker.test/p1s-manual.pdf");
  });

  it("takes the file name from Content-Disposition when there is one", async () => {
    const id = await resource({ url: "https://maker.test/download?id=42" });
    servePdf("https://maker.test/download", { "content-disposition": 'attachment; filename="P1S Manual EN.pdf"' });

    expect((await archiveManual(id, { db, uploader })).status).toBe("archived");
    expect((await owned(id))[0].originalFilename).toBe("P1S Manual EN.pdf");
  });

  it("refuses an HTML product page, stores nothing, and does not retry it", async () => {
    const id = await resource({ url: "https://maker.test/products/p1s" });
    server.use(http.get("https://maker.test/products/p1s", () => HttpResponse.html("<html><body>Buy now</body></html>")));

    expect(await archiveManual(id, { db, uploader })).toEqual({ status: "failed", reason: "not_pdf", transient: false });
    expect(puts).toEqual([]);
    expect(await owned(id)).toEqual([]);
  });

  it("refuses markup served as octet-stream: the bytes have to be a PDF", async () => {
    const id = await resource({ url: "https://maker.test/manual.bin" });
    server.use(
      http.get("https://maker.test/manual.bin", () =>
        HttpResponse.arrayBuffer(new TextEncoder().encode("<!doctype html><p>hi</p>").buffer, {
          headers: { "content-type": "application/octet-stream" },
        })
      )
    );

    expect(await archiveManual(id, { db, uploader })).toMatchObject({ status: "failed", reason: "not_pdf" });
    expect(puts).toEqual([]);
  });

  it("never fetches a lab document, even one whose link is a PDF (bulk intake spec §3.4)", async () => {
    const id = await resource({ type: "Other", url: "https://drive.google.com/private/sop.pdf", origin: "lab_document" });
    // No handler: MSW refuses any request, so a fetch would fail the test.
    expect(await archiveManual(id, { db, uploader })).toEqual({ status: "skipped", reason: "lab_document" });
    expect(puts).toEqual([]);
  });

  it("skips a non-Manual link that turns out not to be a PDF", async () => {
    const id = await resource({ type: "SOP", url: "https://maker.test/sop" });
    server.use(http.get("https://maker.test/sop", () => HttpResponse.html("<p>SOP</p>")));

    expect(await archiveManual(id, { db, uploader })).toEqual({ status: "skipped", reason: "not_pdf" });
  });

  it("archives a non-Manual resource whose link is a PDF", async () => {
    const id = await resource({ type: "Safety", url: "https://maker.test/safety.pdf" });
    servePdf("https://maker.test/safety.pdf");

    expect((await archiveManual(id, { db, uploader })).status).toBe("archived");
  });

  it("refuses a file declared larger than 25 MB without reading it", async () => {
    const id = await resource();
    servePdf("https://maker.test/p1s-manual.pdf", { "content-length": String(MAX_MANUAL_BYTES + 1) });

    expect(await archiveManual(id, { db, uploader })).toEqual({ status: "failed", reason: "too_large", transient: false });
    expect(puts).toEqual([]);
  });

  it("refuses a body that grows past 25 MB with no length declared", async () => {
    const id = await resource();
    const chunk = new Uint8Array(1024 * 1024);
    chunk.set(PDF);
    server.use(
      http.get("https://maker.test/p1s-manual.pdf", () => {
        let sent = 0;
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (sent > MAX_MANUAL_BYTES) return controller.close();
            sent += chunk.byteLength;
            controller.enqueue(chunk);
          },
        });
        return new HttpResponse(stream, { headers: { "content-type": "application/pdf" } });
      })
    );

    expect(await archiveManual(id, { db, uploader })).toMatchObject({ status: "failed", reason: "too_large" });
    expect(puts).toEqual([]);
  });

  it("marks a 5xx transient and a 404 not", async () => {
    const flaky = await resource({ url: "https://maker.test/flaky.pdf" });
    const gone = await resource({ url: "https://maker.test/gone.pdf" });
    server.use(
      http.get("https://maker.test/flaky.pdf", () => new HttpResponse(null, { status: 503 })),
      http.get("https://maker.test/gone.pdf", () => new HttpResponse(null, { status: 404 }))
    );

    expect(await archiveManual(flaky, { db, uploader })).toEqual({
      status: "failed",
      reason: "http_error",
      transient: true,
      httpStatus: 503,
    });
    expect(await archiveManual(gone, { db, uploader })).toEqual({
      status: "failed",
      reason: "http_error",
      transient: false,
      httpStatus: 404,
    });
  });

  it("never follows a manual link that redirects inward, and does not retry it", async () => {
    // Verified as public when research checked it; now it bounces to the
    // cloud metadata service. The guard re-checks every hop.
    const id = await resource({ url: "https://attacker.example/manual.pdf" });
    let metadataHit = false;
    server.use(
      http.get("https://attacker.example/manual.pdf", () =>
        new HttpResponse(null, { status: 302, headers: { Location: "http://169.254.169.254/latest/meta-data/" } })
      ),
      http.get("http://169.254.169.254/latest/meta-data/", () => {
        metadataHit = true;
        return HttpResponse.arrayBuffer(PDF.slice().buffer, { headers: { "content-type": "application/pdf" } });
      })
    );

    expect(await archiveManual(id, { db, uploader })).toEqual({ status: "failed", reason: "blocked", transient: false });
    expect(metadataHit).toBe(false);
    expect(puts).toEqual([]);
    expect(await owned(id)).toEqual([]);
  });

  it("refuses a manual link whose host is private, without a request", async () => {
    const id = await resource({ url: "https://intranet.maker.test/manual.pdf" });
    setResolvedAddresses({ "intranet.maker.test": ["10.0.0.9"] });
    let hit = false;
    server.use(
      http.get("https://intranet.maker.test/manual.pdf", () => {
        hit = true;
        return HttpResponse.arrayBuffer(PDF.slice().buffer, { headers: { "content-type": "application/pdf" } });
      })
    );

    expect(await archiveManual(id, { db, uploader })).toMatchObject({ status: "failed", reason: "blocked" });
    expect(hit).toBe(false);
  });

  it("marks a network failure transient", async () => {
    const id = await resource();
    server.use(http.get("https://maker.test/p1s-manual.pdf", () => HttpResponse.error()));

    expect(await archiveManual(id, { db, uploader })).toEqual({ status: "failed", reason: "download_failed", transient: true });
  });

  it("skips a resource already archived from this link, without a download", async () => {
    const id = await resource();
    servePdf("https://maker.test/p1s-manual.pdf");
    expect((await archiveManual(id, { db, uploader })).status).toBe("archived");

    // No handler this time: a request would fail the test (onUnhandledRequest).
    server.resetHandlers();
    expect(await archiveManual(id, { db, uploader })).toEqual({ status: "skipped", reason: "already_archived" });
    expect(puts).toHaveLength(1);
  });

  it("skips a resource that already holds an uploaded or imported PDF", async () => {
    const id = await resource();
    await db.insert(attachments).values({
      ownerType: "resource",
      ownerId: id,
      blobPathname: "resources/x/manual.pdf",
      access: "public",
      publicUrl: "https://blob.test/resources/x/manual.pdf",
      contentType: "application/pdf",
      sourceKey: "notion-file-1",
    });

    expect(await archiveManual(id, { db, uploader })).toEqual({ status: "skipped", reason: "has_file" });
  });

  it("archives the new link after an edit and releases the stale copy to the sweep", async () => {
    const id = await resource({ url: "https://maker.test/old.pdf" });
    servePdf("https://maker.test/old.pdf");
    servePdf("https://maker.test/new.pdf");
    expect((await archiveManual(id, { db, uploader })).status).toBe("archived");

    await db.update(resources).set({ url: "https://maker.test/new.pdf" }).where(eq(resources.id, id));
    expect((await archiveManual(id, { db, uploader })).status).toBe("archived");

    const rows = await owned(id);
    expect(rows.map((row) => row.sourceKey)).toEqual([manualSourceKey(id, "https://maker.test/new.pdf")]);
    const [released] = await db
      .select({ ownerId: attachments.ownerId })
      .from(attachments)
      .where(eq(attachments.sourceKey, manualSourceKey(id, "https://maker.test/old.pdf")));
    expect(released.ownerId).toBeNull();
  });

  it("archives the same manufacturer URL on two resources, one copy each", async () => {
    const other = (await db.insert(tools).values({ slug: "p1s-2", name: "P1S (lab 2)" }).returning({ id: tools.id }))[0].id;
    const a = await resource();
    const b = await resource({ toolId: other });
    servePdf("https://maker.test/p1s-manual.pdf");

    expect((await archiveManual(a, { db, uploader })).status).toBe("archived");
    expect((await archiveManual(b, { db, uploader })).status).toBe("archived");
    expect((await owned(a))[0].sourceKey).toBe(manualSourceKey(a, "https://maker.test/p1s-manual.pdf"));
    expect((await owned(b))[0].sourceKey).toBe(manualSourceKey(b, "https://maker.test/p1s-manual.pdf"));
    expect(puts.map((p) => p.pathname)).toEqual([`manuals/${toolId}/${a}.pdf`, `manuals/${other}/${b}.pdf`]);
  });

  it("skips when Blob is not configured, before any download", async () => {
    const id = await resource();

    expect(await archiveManual(id, { db })).toEqual({ status: "skipped", reason: "blob_not_configured" });
  });

  it("skips a resource with no link, and an id that is not one", async () => {
    const id = await resource({ url: null });

    expect(await archiveManual(id, { db, uploader })).toEqual({ status: "skipped", reason: "no_url" });
    expect(await archiveManual("not-a-uuid", { db, uploader })).toEqual({ status: "skipped", reason: "not_found" });
    expect(await archiveManual(crypto.randomUUID(), { db, uploader })).toEqual({ status: "skipped", reason: "not_found" });
  });

  it("reports a failed Blob write as transient and records nothing", async () => {
    const id = await resource();
    servePdf("https://maker.test/p1s-manual.pdf");
    const broken: BlobUploader = { put: async () => Promise.reject(new Error("blob down")) };

    expect(await archiveManual(id, { db, uploader: broken })).toEqual({ status: "failed", reason: "upload_failed", transient: true });
    expect(await owned(id)).toEqual([]);
  });

  it("never logs the link's path or query", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const id = await resource({ url: "https://maker.test/signed/manual.pdf?token=s3cr3t" });
    server.use(http.get("https://maker.test/signed/manual.pdf", () => new HttpResponse(null, { status: 403 })));

    await archiveManual(id, { db, uploader });
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).toContain("host=maker.test");
    expect(logged).not.toContain("s3cr3t");
    expect(logged).not.toContain("/signed/");
  });
});

describe("looksLikePdf / filenameFromDisposition", () => {
  it("finds the magic bytes behind a little leading junk", () => {
    const bytes = new Uint8Array([0x0a, 0x0a, ...PDF]);
    expect(looksLikePdf(bytes, "application/octet-stream")).toBe(true);
    expect(looksLikePdf(new TextEncoder().encode("<html>"), "application/pdf")).toBe(false);
  });

  it("reads both forms of the header", () => {
    expect(filenameFromDisposition("attachment; filename*=UTF-8''Manual%20v2.pdf")).toBe("Manual v2.pdf");
    expect(filenameFromDisposition('inline; filename="a/b/c.pdf"')).toBe("c.pdf");
    expect(filenameFromDisposition(null)).toBeNull();
  });
});

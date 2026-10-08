// @vitest-environment node
import { getTableConfig, type PgColumn } from "drizzle-orm/pg-core";
import { createLocalBlobBackend } from "../blob-local.ts";
import { findEarlierUploads, scanLocalFiles, uploadFiles } from "./files.ts";
import { isForeignBlobUrl, mentionsForeignStore, transformRow, type Rewrites } from "./rows.ts";
import { planTables, schemaTables } from "./tables.ts";
import { blobStoreId, storeHosts } from "./target-env.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * `data:push` rewrites **every column that can hold a Blob URL** (manual text
 * spec amendment 2026-09-28). The hosted stores were deleted and recreated on
 * 2026-09-27; a copy of a file's URL kept anywhere the rewrite missed would
 * have gone on pointing at the deleted store.
 *
 * The test does not trust a list: it scans the Drizzle schema for every column
 * whose type can carry a string — text, varchar, text[], jsonb — and proves a
 * local URL and an old-store URL placed in each one come out rewritten. A
 * second, pinned list of the columns *named* like a URL is there to make a new
 * one a reviewed change.
 */

const OLD_STORE = "https://ehlhvy4tr3zposou.public.blob.vercel-storage.com";
const NEW_STORE_HOST = "9oamtafdsnh6jn7l.public.blob.vercel-storage.com";
const NEW_STORE = `https://${NEW_STORE_HOST}`;
const LOCAL = "http://localhost:3001/api/dev-blob";

const rewrites: Rewrites = {
  byPathname: new Map(),
  byUrl: new Map([
    [`${LOCAL}/manuals/t/r.pdf`, `${NEW_STORE}/manuals/t/r-NEW1.pdf`],
    [`${OLD_STORE}/manuals/t/r-OLD.pdf`, `${NEW_STORE}/manuals/t/r-OLD-NEW2.pdf`],
  ]),
};

type Kind = "text" | "array" | "json";

function stringKind(column: PgColumn): Kind | null {
  const type = column.columnType;
  if (type === "PgText" || type === "PgVarchar" || type === "PgChar") return "text";
  if (type === "PgJsonb" || type === "PgJson") return "json";
  if (type === "PgArray") {
    const base = (column as unknown as { baseColumn?: PgColumn }).baseColumn;
    return base && stringKind(base) === "text" ? "array" : null;
  }
  return null;
}

function valueFor(kind: Kind, url: string): unknown {
  if (kind === "text") return `see ${url}#page=3`;
  if (kind === "array") return ["x", url];
  return { resources: [{ url, nested: { photo: url } }], note: `at ${url}` };
}

/** Every copied column that can hold a string. */
function stringColumns() {
  const plan = planTables();
  const copied = new Set(plan.tables.map((t) => t.name));
  const out: { table: string; column: string; kind: Kind }[] = [];
  for (const table of schemaTables()) {
    const config = getTableConfig(table);
    if (!copied.has(config.name)) continue;
    for (const column of config.columns) {
      const kind = stringKind(column);
      if (kind && !column.generated) out.push({ table: config.name, column: column.name, kind });
    }
  }
  return out;
}

describe("every string-capable column is rewritten", () => {
  const plan = planTables();
  const columns = stringColumns();

  it("finds the columns (a sanity floor, so a broken scan cannot pass vacuously)", () => {
    expect(columns.length).toBeGreaterThan(60);
    expect(columns).toEqual(
      expect.arrayContaining([
        { table: "attachments", column: "public_url", kind: "text" },
        { table: "resources", column: "url", kind: "text" },
        { table: "pending_tools", column: "research", kind: "json" },
        { table: "tools", column: "tags", kind: "array" },
      ])
    );
  });

  it.each(columns.map((c) => [`${c.table}.${c.column}`, c] as const))("%s", (_name, { table, column, kind }) => {
    const tablePlan = plan.tables.find((t) => t.name === table)!;
    if (tablePlan.redacted.includes(column)) return; // blanked on the way, so it holds nothing to rewrite
    for (const [from, to] of rewrites.byUrl) {
      const { row } = transformRow(tablePlan, { [column]: valueFor(kind, from) }, rewrites);
      const text = JSON.stringify(row[column]);
      expect(text).not.toContain(from);
      expect(text).toContain(to);
    }
  });
});

describe("url-named columns (pinned: a new one is a reviewed change)", () => {
  it("are exactly these", () => {
    const named = stringColumns()
      .filter((c) => /(url|href|link|pathname|image|photo|file|src)/i.test(c.column))
      .map((c) => `${c.table}.${c.column}`)
      .sort();
    expect(named).toEqual([
      "attachments.blob_pathname",
      "attachments.original_filename",
      "attachments.public_url",
      "attachments.source_url",
      "oauth_application.redirect_urls",
      // A photo for a name (migration 0032): the looked-up picture's own URL and page —
      // somebody else's host — rewritten like every jsonb string all the same.
      "pending_tools.found_photo",
      "pending_tools.links",
      "projects.link",
      "resources.url",
      "user.image",
    ]);
  });
});

describe("foreign stores (a store deleted and recreated)", () => {
  const hosts = [NEW_STORE_HOST];

  it("tells the target's store from any other", () => {
    expect(isForeignBlobUrl(`${OLD_STORE}/a.pdf`, hosts)).toBe(true);
    expect(isForeignBlobUrl(`${NEW_STORE}/a.pdf`, hosts)).toBe(false);
    expect(isForeignBlobUrl("https://formlabs.com/a.pdf", hosts)).toBe(false);
    expect(isForeignBlobUrl(`${OLD_STORE}/a.pdf`, [])).toBe(false);
    expect(mentionsForeignStore({ research: { images: [`${OLD_STORE}/x.jpg`] } }, hosts)).toBe(true);
    expect(mentionsForeignStore({ url: `${NEW_STORE}/x.jpg` }, hosts)).toBe(false);
  });

  it("reads a store's hosts from a token or an OIDC store id", () => {
    expect(blobStoreId({ kind: "token", token: "vercel_blob_rw_9oAmTaFdSnH6jn7L_secret" })).toBe("9oAmTaFdSnH6jn7L");
    expect(blobStoreId({ kind: "oidc", storeId: "store_9oAmTaFdSnH6jn7L", oidcToken: "x" })).toBe("9oAmTaFdSnH6jn7L");
    expect(storeHosts({ kind: "token", token: "vercel_blob_rw_9oAmTaFdSnH6jn7L_secret" }, null)).toEqual([
      NEW_STORE_HOST,
      "9oamtafdsnh6jn7l.private.blob.vercel-storage.com",
    ]);
  });

  it("carries a foreign file from its URL when it answers, reports it when it does not, and never reuses an old-store copy", async () => {
    const store = createLocalBlobBackend(mkdtempSync(join(tmpdir(), "push-foreign-")));
    const rows = [
      { id: "a1", access: "public", blob_pathname: "manuals/t/r-OLD.pdf", public_url: `${OLD_STORE}/manuals/t/r-OLD.pdf`, content_type: "application/pdf", size_bytes: 9 },
      { id: "a2", access: "public", blob_pathname: "manuals/t/gone-OLD.pdf", public_url: `${OLD_STORE}/manuals/t/gone-OLD.pdf`, content_type: "application/pdf", size_bytes: 9 },
      { id: "a3", access: "public", blob_pathname: "manuals/t/ok-X.pdf", public_url: `${NEW_STORE}/manuals/t/ok-X.pdf`, content_type: "application/pdf", size_bytes: 9 },
    ];
    const scan = await scanLocalFiles(rows, store, undefined, {
      targetHosts: hosts,
      probeRemote: async (url) => ({ ok: !url.includes("gone"), size: 9, contentType: "application/pdf" }),
    });
    expect(scan.files.map((f) => [f.pathname, f.remote])).toEqual([["manuals/t/r-OLD.pdf", `${OLD_STORE}/manuals/t/r-OLD.pdf`]]);
    expect(scan.unreachable).toEqual([{ id: "a2", url: `${OLD_STORE}/manuals/t/gone-OLD.pdf` }]);
    expect(scan.foreign).toBe(1);

    // The hosted row still names the old store: not a copy to reuse.
    expect(findEarlierUploads(scan.files, [{ ...rows[0], blob_pathname: "manuals/t/r-OLD-abc.pdf" }], hosts).size).toBe(0);

    const put = vi.fn(async (pathname: string) => ({ pathname: `${pathname}-NEW`, url: `${NEW_STORE}/${pathname}-NEW` }));
    const fetched: string[] = [];
    const out = await uploadFiles(scan.files, store, { put }, undefined, new Map(), async (url) => {
      fetched.push(url);
      return new TextEncoder().encode("%PDF-1.4\n");
    });
    expect(fetched).toEqual([`${OLD_STORE}/manuals/t/r-OLD.pdf`]);
    expect(out.byUrl.get(`${OLD_STORE}/manuals/t/r-OLD.pdf`)).toBe(`${NEW_STORE}/manuals/t/r-OLD.pdf-NEW`);
  });
});

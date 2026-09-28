// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { migrationsFolder } from "../db/migrations-folder.ts";
import { PGLITE_EXTENSIONS } from "../db/pglite.ts";
import * as schema from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";
import { blobUrlsIn, pathnameStem, runRepoint } from "./repoint.ts";
import { sqlClient, type SqlClient } from "./sql.ts";

/**
 * `blob:repoint` (manual text spec amendment 2026-09-28) against an
 * in-process PGlite "hosted" database: URLs on the deleted store are re-pointed
 * at the current copies by pathname stem, in every string column, only with
 * `apply`.
 */

const OLD = "https://ehlhvy4tr3zposou.public.blob.vercel-storage.com";
const NEW_HOST = "9oamtafdsnh6jn7l.public.blob.vercel-storage.com";
const NEW = `https://${NEW_HOST}`;
const TOOL = "7f4b9c39-3f74-4f3c-a043-877fd7099645";
const RESOURCE = "cacfee3b-a664-4cb7-b59f-c7fee2986392";
const OLD_MANUAL = `${OLD}/manuals/${TOOL}/${RESOURCE}-dTQAmC4fMDlsPrtEOUnX-AAAAbbbbCCCCddddEEEEffffGGGGhh.pdf`;
const NEW_MANUAL = `${NEW}/manuals/${TOOL}/${RESOURCE}-dTQAmC4fMDlsPrtEOUnX-y1OIJa0TNQV6O1MwOXKUnDm2IF3qju.pdf`;

let pg: PGlite;
let sql: SqlClient;

beforeEach(async () => {
  pg = new PGlite({ extensions: PGLITE_EXTENSIONS });
  const db = drizzle(pg, { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: migrationsFolder() });
  sql = sqlClient(pg);
  await sql.query(`insert into tools (id, name, slug) values ($1, 'Bosch GST 150', 'bosch-gst-150')`, [TOOL]);
  await sql.query(`insert into resources (id, tool_id, title, type, url) values ($1, $2, 'Manual', 'Manual', $3)`, [
    RESOURCE,
    TOOL,
    `${OLD_MANUAL}#page=4`,
  ]);
  await sql.query(
    `insert into attachments (owner_type, owner_id, blob_pathname, access, public_url, content_type, origin)
     values ('resource', $1, $2, 'public', $3, 'application/pdf', 'manual_archive')`,
    [RESOURCE, new URL(NEW_MANUAL).pathname.slice(1), NEW_MANUAL]
  );
  // A row whose own file is on the old store: reported, not re-pointed.
  await sql.query(
    `insert into attachments (owner_type, owner_id, blob_pathname, access, public_url, content_type, origin)
     values ('tool', $1, 'tools/x/photo-AAAAbbbbCCCCddddEEEE.jpg', 'public', $2, 'image/jpeg', 'upload')`,
    [TOOL, `${OLD}/tools/x/photo-AAAAbbbbCCCCddddEEEE.jpg`]
  );
  await sql.query(`update tools set notes = $1 where id = $2`, [`Old link: ${OLD}/nowhere/else-AAAAbbbbCCCCddddEEEE.pdf`, TOOL]);
});

afterEach(async () => {
  await pg.close();
});

describe("pathnameStem / blobUrlsIn", () => {
  it("drops every random suffix but keeps a uuid", () => {
    expect(pathnameStem(`manuals/${TOOL}/${RESOURCE}-BoVuthevz2AUqkpzGfDg-1X1vy8v5ZDirsc1hBbVchBbMk519Ca.pdf`)).toBe(
      `manuals/${TOOL}/${RESOURCE}.pdf`
    );
    expect(pathnameStem("tools/a/photo.jpg")).toBe("tools/a/photo.jpg");
  });

  it("finds Blob URLs in text and JSON, without the fragment", () => {
    expect(blobUrlsIn(`see ${OLD_MANUAL}#page=4 and "${NEW}/x.jpg"`)).toEqual([OLD_MANUAL, `${NEW}/x.jpg`]);
  });
});

describe("runRepoint", () => {
  it("reports without writing by default", async () => {
    const lines: string[] = [];
    const report = await runRepoint({ target: sql, targetHosts: [NEW_HOST], apply: false, log: (l) => lines.push(l) });
    expect(report.applied).toBe(false);
    expect(report.changes).toEqual([
      { table: "resources", column: "url", key: { id: RESOURCE }, urls: [[OLD_MANUAL, NEW_MANUAL]] },
    ]);
    expect(report.unmatched).toEqual([
      { url: `${OLD}/nowhere/else-AAAAbbbbCCCCddddEEEE.pdf`, reason: "none", where: "tools.notes" },
    ]);
    expect(report.brokenAttachments.map((b) => b.url)).toEqual([`${OLD}/tools/x/photo-AAAAbbbbCCCCddddEEEE.jpg`]);
    const [row] = await sql.query<{ url: string }>("select url from resources");
    expect(row.url).toBe(`${OLD_MANUAL}#page=4`);
    expect(lines.join("\n")).toContain("resources.url");
  });

  it("re-points with apply, keeping the page anchor", async () => {
    const report = await runRepoint({ target: sql, targetHosts: [NEW_HOST], apply: true });
    expect(report.applied).toBe(true);
    const [row] = await sql.query<{ url: string }>("select url from resources");
    expect(row.url).toBe(`${NEW_MANUAL}#page=4`);
    // A second run finds nothing left to re-point.
    expect((await runRepoint({ target: sql, targetHosts: [NEW_HOST], apply: false })).changes).toEqual([]);
  });

  it("re-points inside jsonb and text[] too", async () => {
    await sql.query(
      `insert into audit_events (action, subject_type, subject_id, detail) values ('resource.updated', 'resource', $1, $2::jsonb)`,
      [RESOURCE, JSON.stringify({ url: OLD_MANUAL, nested: [`${OLD_MANUAL}#page=2`] })]
    );
    await sql.query(`update tools set tags = $1::text[] where id = $2`, [["x", OLD_MANUAL], TOOL]);
    const report = await runRepoint({ target: sql, targetHosts: [NEW_HOST], apply: true });
    expect(report.changes.map((c) => `${c.table}.${c.column}`).sort()).toEqual(["audit_events.detail", "resources.url", "tools.tags"]);
    const [audit] = await sql.query<{ detail: unknown }>("select detail from audit_events");
    expect(audit.detail).toEqual({ url: NEW_MANUAL, nested: [`${NEW_MANUAL}#page=2`] });
    const [tool] = await sql.query<{ tags: string[] }>("select tags from tools");
    expect(tool.tags).toEqual(["x", NEW_MANUAL]);
  });
});

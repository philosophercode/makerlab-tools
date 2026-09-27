// @vitest-environment node
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { getTableConfig } from "drizzle-orm/pg-core";
import { createLocalBlobBackend, type LocalBlobBackend } from "../blob-local.ts";
import { seedDemo, DEMO_ACCOUNTS, DEMO_PENDING } from "../db/demo-seed.ts";
import { migrationsFolder } from "../db/migrations-folder.ts";
import { PGLITE_EXTENSIONS } from "../db/pglite.ts";
import * as schema from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";
import type { BlobUploader } from "../import/files.ts";
import { latestRepoMigration } from "./migrations.ts";
import { runPush, type PushOptions } from "./run.ts";
import { sqlClient, type SqlClient } from "./sql.ts";
import { planTables, schemaTables } from "./tables.ts";

/**
 * `data:push` end to end, between two in-process PGlite databases: the
 * "laptop" (demo seed plus local files, tokens, a self-reference, embeddings)
 * and the "hosted" one (migrated, holding stale rows). The Blob upload is a
 * fake that records what it was given. Nothing here reaches Neon or Vercel
 * Blob, and the local store is a temporary folder — never `.blob-data/`.
 */

interface Opened {
  pg: PGlite;
  db: Db;
  sql: SqlClient;
}

async function openDb(): Promise<Opened> {
  const pg = new PGlite({ extensions: PGLITE_EXTENSIONS });
  const db = drizzle(pg, { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: migrationsFolder() });
  return { pg, db, sql: sqlClient(pg) };
}

async function rows<T = Record<string, unknown>>(o: Opened, text: string): Promise<T[]> {
  return o.sql.query<T>(text);
}

function fakeUploader() {
  const calls: { pathname: string; access: string; contentType?: string; bytes: number }[] = [];
  const uploader: BlobUploader = {
    async put(pathname, body, options) {
      calls.push({ pathname, access: options.access, contentType: options.contentType, bytes: body.byteLength });
      const dot = pathname.lastIndexOf(".");
      const stored = `${pathname.slice(0, dot)}-Fake${calls.length}${pathname.slice(dot)}`;
      return { pathname: stored, url: `https://fake.${options.access}.blob.vercel-storage.com/${stored}` };
    },
  };
  return { uploader, calls };
}

const EMBEDDING = `[${Array.from({ length: 512 }, (_, i) => Math.sin(i + 1) / 7).join(",")}]`;

let source: Opened;
let target: Opened;
let store: LocalBlobBackend;
let photoUrl: string;
const ids = {
  photo: "0b6f0e7a-0000-4000-8000-000000000001",
  photoAgain: "0b6f0e7a-0000-4000-8000-000000000002",
  manual: "0b6f0e7a-0000-4000-8000-000000000003",
  vercel: "0b6f0e7a-0000-4000-8000-000000000004",
  resource: "0b6f0e7a-0000-4000-8000-000000000005",
  document: "0b6f0e7a-0000-4000-8000-000000000006",
  chunk: "0b6f0e7a-0000-4000-8000-000000000007",
};

beforeEach(async () => {
  store = createLocalBlobBackend(mkdtempSync(join(tmpdir(), "push-hosted-")));
  const photo = await store.put("tools/form-4/photo.jpg", new Uint8Array([1, 2, 3, 4]), {
    access: "public",
    contentType: "image/jpeg",
  });
  photoUrl = photo.url;
  await store.put("manuals/form-4.pdf", new Uint8Array([37, 80, 68, 70, 45]), {
    access: "private",
    contentType: "application/pdf",
  });

  source = await openDb();
  await seedDemo(source.db);
  const [tool] = await rows<{ id: string }>(source, "select id from tools order by name limit 1");
  const s = source.sql;
  await s.query(
    `insert into attachments (id, owner_type, owner_id, blob_pathname, access, public_url, content_type, size_bytes) values
      ($1, 'tool', $5, 'tools/form-4/photo.jpg', 'public', $6, 'image/jpeg', 4),
      ($2, 'tool', $5, 'tools/form-4/photo.jpg', 'public', $6, 'image/jpeg', 4),
      ($3, 'resource', $5, 'manuals/form-4.pdf', 'private', null, 'application/pdf', 5),
      ($4, 'tool', $5, 'tools/x/remote-abc.jpg', 'public', 'https://s.public.blob.vercel-storage.com/tools/x/remote-abc.jpg', 'image/jpeg', 9)`,
    [ids.photo, ids.photoAgain, ids.manual, ids.vercel, tool.id, photoUrl]
  );
  await s.query("insert into resources (id, tool_id, title, url) values ($1, $2, 'Photo link', $3)", [
    ids.resource,
    tool.id,
    photoUrl,
  ]);
  await s.query(
    `insert into manual_documents (id, attachment_id, tool_id, title, status, outline, extractor_version, processed_at)
     values ($1, $2, $3, 'Form 4 manual', 'ready', '[{"title":"Intro","page":1,"level":1}]'::jsonb, 'unpdf@1', '2026-09-01T10:11:12.345678Z')`,
    [ids.document, ids.manual, tool.id]
  );
  await s.query(
    `insert into manual_chunks (id, document_id, tool_id, ordinal, section_path, page_start, page_end, content, search_text, embedding)
     values ($1, $2, $3, 0, '{Intro,"Safety first"}', 1, 2, 'Wear gloves.', 'wear gloves resin', $4::vector)`,
    [ids.chunk, ids.document, tool.id, EMBEDDING]
  );
  await s.query(
    `insert into account (id, account_id, provider_id, user_id, access_token, refresh_token, id_token, scope)
     values ('acct-1', 'google-sub-1', 'google', $1, 'ya29.fake', '1//fake-refresh', 'eyJ.fake', 'openid email')`,
    [DEMO_ACCOUNTS.superAdmin.id]
  );
  await s.query("update pending_tools set duplicate_of_pending_id = $1, updated_at = '2026-01-02T03:04:05.678901Z' where id <> $1", [
    DEMO_PENDING.researched.id,
  ]);

  // The hosted database: migrated, with stale rows that must disappear.
  target = await openDb();
  await target.sql.query("insert into categories (name) values ('Stale category')");
  await target.sql.query("insert into \"user\" (id, name, email) values ('stale-user', 'Stale', 'stale@example.com')");
  await target.sql.query(
    "insert into session (id, token, expires_at, user_id) values ('s1', 'stale-token', now() + interval '1 day', 'stale-user')"
  );
});

afterEach(async () => {
  await source.pg.close();
  await target.pg.close();
});

function options(overrides: Partial<PushOptions> = {}): PushOptions {
  return {
    source: source.sql,
    target: target.sql,
    localStore: store,
    uploader: null,
    repoMigration: latestRepoMigration(migrationsFolder()),
    dryRun: false,
    limits: { pageSize: 3, batchRows: 2 },
    ...overrides,
  };
}

async function count(o: Opened, table: string): Promise<number> {
  const [row] = await rows<{ n: number }>(o, `select count(*)::int as n from "${table}"`);
  return row.n;
}

describe("runPush", () => {
  it("replaces the hosted rows with the local ones, files uploaded once and rewritten", async () => {
    const { uploader, calls } = fakeUploader();
    const report = await runPush(options({ uploader }));
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);

    // Every copied table matches, row for row.
    for (const table of report.plan.tables) {
      expect(await count(target, table.name), table.name).toBe(await count(source, table.name));
    }
    expect(await rows(target, "select * from categories where name = 'Stale category'")).toEqual([]);
    // Sign-ins never travel, and the hosted ones end.
    expect(await count(target, "session")).toBe(0);
    expect(await count(source, "session")).toBeGreaterThan(0);

    // One upload per distinct file, with the row's access and content type.
    expect(calls).toEqual([
      { pathname: "manuals/form-4.pdf", access: "private", contentType: "application/pdf", bytes: 5 },
      { pathname: "tools/form-4/photo.jpg", access: "public", contentType: "image/jpeg", bytes: 4 },
    ]);
    const attachments = await rows<{ id: string; blob_pathname: string; public_url: string | null }>(
      target,
      `select id, blob_pathname, public_url from attachments where id in ('${ids.photo}','${ids.photoAgain}','${ids.manual}','${ids.vercel}') order by id`
    );
    expect(attachments).toEqual([
      { id: ids.photo, blob_pathname: "tools/form-4/photo-Fake2.jpg", public_url: "https://fake.public.blob.vercel-storage.com/tools/form-4/photo-Fake2.jpg" },
      { id: ids.photoAgain, blob_pathname: "tools/form-4/photo-Fake2.jpg", public_url: "https://fake.public.blob.vercel-storage.com/tools/form-4/photo-Fake2.jpg" },
      { id: ids.manual, blob_pathname: "manuals/form-4-Fake1.pdf", public_url: null },
      { id: ids.vercel, blob_pathname: "tools/x/remote-abc.jpg", public_url: "https://s.public.blob.vercel-storage.com/tools/x/remote-abc.jpg" },
    ]);
    // The same URL elsewhere is rewritten too; the demo's bundled images are not.
    const [resource] = await rows<{ url: string }>(target, `select url from resources where id = '${ids.resource}'`);
    expect(resource.url).toBe("https://fake.public.blob.vercel-storage.com/tools/form-4/photo-Fake2.jpg");
    expect(report.copy!.stillLocal.size).toBe(0);

    // OAuth tokens blanked; the account link and the user's role kept.
    const [account] = await rows(target, "select account_id, user_id, access_token, refresh_token, id_token, scope from account");
    expect(account).toEqual({
      account_id: "google-sub-1",
      user_id: DEMO_ACCOUNTS.superAdmin.id,
      access_token: null,
      refresh_token: null,
      id_token: null,
      scope: "openid email",
    });
    const [owner] = await rows<{ role: string }>(target, `select role from "user" where id = '${DEMO_ACCOUNTS.superAdmin.id}'`);
    expect(owner.role).toBe("super_admin");
  });

  it("preserves ids, timestamps, jsonb, arrays, embeddings and self-references exactly", async () => {
    const { uploader } = fakeUploader();
    await runPush(options({ uploader }));

    const snapshot = (o: Opened, text: string) => rows(o, text);
    const queries = [
      "select id, duplicate_of_pending_id, created_at::text, updated_at::text, research, serials, lab_docs from pending_tools order by id",
      "select id, created_at::text, updated_at::text, name, tags from tools order by id",
      "select id, section_path, embedding::text as embedding, content from manual_chunks order by id",
      "select id, outline, processed_at::text from manual_documents order by id",
      "select id, email, created_at::text, role from \"user\" order by id",
    ];
    for (const query of queries) {
      expect(await snapshot(target, query), query).toEqual(await snapshot(source, query));
    }
    const [chunk] = await rows<{ embedding: string; tsv: string | null }>(
      target,
      `select embedding::text as embedding, tsv::text as tsv from manual_chunks where id = '${ids.chunk}'`
    );
    // The column is halfvec(512) since 0018: the copy is exact at that precision.
    expect(chunk.embedding).toBe((await rows<{ e: string }>(source, `select $$${EMBEDDING}$$::halfvec(512)::text as e`))[0].e);
    expect(chunk.tsv).toContain("glove"); // regenerated by the target
    const relinked = await rows(target, "select count(*)::int as n from pending_tools where duplicate_of_pending_id is not null");
    expect(relinked).toEqual([{ n: 2 }]);
  });

  it("reuses an earlier push's uploads on a re-run", async () => {
    const first = fakeUploader();
    await runPush(options({ uploader: first.uploader }));
    const second = fakeUploader();
    const report = await runPush(options({ uploader: second.uploader }));
    expect(report.reused).toBe(2);
    expect(second.calls).toEqual([]);
    const [photo] = await rows<{ blob_pathname: string }>(target, `select blob_pathname from attachments where id = '${ids.photo}'`);
    expect(photo.blob_pathname).toBe("tools/form-4/photo-Fake2.jpg");
  });

  it("dry run: counts both sides, uploads nothing, writes nothing", async () => {
    const { uploader, calls } = fakeUploader();
    const lines: string[] = [];
    const report = await runPush(options({ uploader, dryRun: true, log: (l) => lines.push(l) }));
    expect(report.ok).toBe(true);
    expect(report.copy).toBeUndefined();
    expect(calls).toEqual([]);
    expect(report.targetCounts.get("categories")).toBe(1);
    expect(report.localCounts.get("tools")).toBe(await count(source, "tools"));
    expect(report.files.files.map((f) => f.pathname)).toEqual(["manuals/form-4.pdf", "tools/form-4/photo.jpg"]);
    expect(report.files.bytes).toBe(9);
    expect(await count(target, "categories")).toBe(1);
    expect(await count(target, "session")).toBe(1);
    expect(lines.join("\n")).toMatch(/to upload: 2/);
  });

  it("refuses when the hosted schema is not at the local migration", async () => {
    await target.sql.query(
      "delete from drizzle.__drizzle_migrations where created_at = (select max(created_at) from drizzle.__drizzle_migrations)"
    );
    const { uploader, calls } = fakeUploader();
    const report = await runPush(options({ uploader }));
    expect(report.ok).toBe(false);
    expect(report.problems[0]).toMatch(/hosted database .* is behind the local one/);
    expect(calls).toEqual([]);
    expect(await count(target, "categories")).toBe(1);
  });

  it("refuses when there are files to upload and no Blob store", async () => {
    const report = await runPush(options({ uploader: null }));
    expect(report.ok).toBe(false);
    expect(report.problems.join(" ")).toMatch(/links no Blob store/);
    expect(await count(target, "categories")).toBe(1);
  });

  it("refuses a local URL whose file is missing, unless allowed", async () => {
    await source.sql.query(
      "insert into attachments (owner_type, blob_pathname, access, public_url) values ('tool', 'gone.jpg', 'public', 'http://localhost:3001/api/dev-blob/gone.jpg')"
    );
    const { uploader } = fakeUploader();
    const refused = await runPush(options({ uploader }));
    expect(refused.ok).toBe(false);
    expect(refused.files.missing.map((m) => m.pathname)).toEqual(["gone.jpg"]);

    const allowed = await runPush(options({ uploader, allowMissingFiles: true }));
    expect(allowed.ok).toBe(true);
    expect(allowed.copy!.stillLocal.get("attachments")).toBe(1);
  });

  it("leaves the hosted database untouched when the copy fails part-way", async () => {
    const failing: SqlClient = {
      async query(text, params) {
        if (text.startsWith('insert into "tools"')) throw new Error("boom");
        return target.sql.query(text, params);
      },
    };
    const { uploader } = fakeUploader();
    await expect(runPush(options({ uploader, target: failing }))).rejects.toThrow("boom");
    expect(await count(target, "categories")).toBe(1);
    expect(await count(target, "session")).toBe(1);
    expect(await count(target, "tools")).toBe(0);
  });
});

describe("the plan against the migrated schema", () => {
  it("covers every table the migrations create", async () => {
    const tables = await rows<{ table_name: string }>(
      source,
      "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'"
    );
    expect(tables.map((t) => t.table_name).sort()).toEqual(schemaTables().map(getTableName).sort());
  });

  it("knows every foreign key the migrations create", async () => {
    const fks = await rows<{ from_table: string; to_table: string }>(
      source,
      `select conrelid::regclass::text as from_table, confrelid::regclass::text as to_table
         from pg_constraint where contype = 'f' and connamespace = 'public'::regnamespace`
    );
    const unquote = (s: string) => s.replace(/^"|"$/g, "");
    const actual = fks.map((f) => `${unquote(f.from_table)}->${unquote(f.to_table)}`).sort();
    const declared = schemaTables()
      .flatMap((t) => getTableConfig(t).foreignKeys.map((fk) => `${getTableName(t)}->${getTableName(fk.reference().foreignTable)}`))
      .sort();
    expect(actual).toEqual(declared);
    expect(planTables().tables.length).toBeGreaterThan(20);
  });
});

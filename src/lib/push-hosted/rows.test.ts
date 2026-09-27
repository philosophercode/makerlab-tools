// @vitest-environment node
import { findEarlierUploads, type LocalFile } from "./files.ts";
import { emptyRewrites, isLocalBlobUrl, localPathnameFromUrl, rewriteUrls, transformRow, type Rewrites } from "./rows.ts";
import { planTables } from "./tables.ts";

/** One row's trip: secrets blanked, generated columns dropped, local file URLs rewritten. */

const plan = planTables();
const table = (name: string) => plan.tables.find((t) => t.name === name)!;

describe("isLocalBlobUrl", () => {
  it("accepts the dev server's /api/dev-blob URLs on any loopback port", () => {
    expect(isLocalBlobUrl("http://localhost:3001/api/dev-blob/tools/a.jpg")).toBe(true);
    expect(isLocalBlobUrl("http://127.0.0.1:3000/api/dev-blob/x.pdf")).toBe(true);
    expect(isLocalBlobUrl("http://mac.local:3000/api/dev-blob/x.pdf", "http://mac.local:3000")).toBe(true);
  });

  it("rejects Vercel Blob, bundled images and other paths", () => {
    expect(isLocalBlobUrl("https://abc.public.blob.vercel-storage.com/tools/a.jpg")).toBe(false);
    expect(isLocalBlobUrl("/tool-images/form-4.png")).toBe(false);
    expect(isLocalBlobUrl("http://localhost:3000/tools/form-4")).toBe(false);
    expect(isLocalBlobUrl("https://example.com/api/dev-blob/a.jpg")).toBe(false);
  });

  it("decodes the pathname", () => {
    expect(localPathnameFromUrl("http://localhost:3001/api/dev-blob/tools/a%20b/c.jpg")).toBe("tools/a b/c.jpg");
  });
});

describe("rewriteUrls", () => {
  it("replaces old URLs inside text, arrays and nested jsonb", () => {
    const byUrl = new Map([["http://localhost:3001/api/dev-blob/a.jpg", "https://blob.example/a-X.jpg"]]);
    const value = {
      text: "see http://localhost:3001/api/dev-blob/a.jpg here",
      list: ["http://localhost:3001/api/dev-blob/a.jpg", "other"],
      nested: { images: [{ url: "http://localhost:3001/api/dev-blob/a.jpg" }] },
      n: 3,
      nil: null,
    };
    expect(rewriteUrls(value, byUrl)).toEqual({
      text: "see https://blob.example/a-X.jpg here",
      list: ["https://blob.example/a-X.jpg", "other"],
      nested: { images: [{ url: "https://blob.example/a-X.jpg" }] },
      n: 3,
      nil: null,
    });
  });

  it("replaces a longer URL whole when a shorter one prefixes it", () => {
    const byUrl = new Map([
      ["http://localhost:3000/api/dev-blob/a.jpg", "https://b/one"],
      ["http://localhost:3000/api/dev-blob/a.jpg.pdf", "https://b/two"],
    ]);
    expect(rewriteUrls("http://localhost:3000/api/dev-blob/a.jpg.pdf", byUrl)).toBe("https://b/two");
  });
});

describe("transformRow", () => {
  it("blanks an account's OAuth tokens and keeps the link", () => {
    const { row } = transformRow(
      table("account"),
      {
        id: "acc1",
        account_id: "google-sub",
        provider_id: "google",
        user_id: "u1",
        access_token: "ya29.secret",
        refresh_token: "1//refresh",
        id_token: "eyJ.id",
        password: null,
        scope: "openid email",
      },
      emptyRewrites()
    );
    expect(row).toMatchObject({
      id: "acc1",
      account_id: "google-sub",
      provider_id: "google",
      user_id: "u1",
      access_token: null,
      refresh_token: null,
      id_token: null,
      scope: "openid email",
    });
  });

  it("drops generated columns", () => {
    const { row } = transformRow(
      table("manual_chunks"),
      { id: "c1", search_text: "hello", tsv: "'hello':1", embedding: "[0.1,0.2]" },
      emptyRewrites()
    );
    expect(row).not.toHaveProperty("tsv");
    expect(row.embedding).toBe("[0.1,0.2]");
  });

  it("points a local attachment at its uploaded copy", () => {
    const rewrites: Rewrites = {
      byPathname: new Map([
        ["tools/a/photo-1.jpg", { pathname: "tools/a/photo-1-Zz9.jpg", url: "https://s.public.blob.vercel-storage.com/tools/a/photo-1-Zz9.jpg", access: "public" }],
        ["backups/b.pdf", { pathname: "backups/b-Q1.pdf", url: "https://s.private.blob.vercel-storage.com/backups/b-Q1.pdf", access: "private" }],
      ]),
      byUrl: new Map([
        ["http://localhost:3001/api/dev-blob/tools/a/photo-1.jpg", "https://s.public.blob.vercel-storage.com/tools/a/photo-1-Zz9.jpg"],
      ]),
    };
    const pub = transformRow(
      table("attachments"),
      { id: "a1", blob_pathname: "tools/a/photo-1.jpg", access: "public", public_url: "http://localhost:3001/api/dev-blob/tools/a/photo-1.jpg" },
      rewrites
    ).row;
    expect(pub.blob_pathname).toBe("tools/a/photo-1-Zz9.jpg");
    expect(pub.public_url).toBe("https://s.public.blob.vercel-storage.com/tools/a/photo-1-Zz9.jpg");

    const priv = transformRow(
      table("attachments"),
      { id: "a2", blob_pathname: "backups/b.pdf", access: "private", public_url: null },
      rewrites
    ).row;
    expect(priv.blob_pathname).toBe("backups/b-Q1.pdf");
    expect(priv.public_url).toBeNull();

    const elsewhere = transformRow(
      table("resources"),
      { id: "r1", url: "http://localhost:3001/api/dev-blob/tools/a/photo-1.jpg" },
      rewrites
    ).row;
    expect(elsewhere.url).toBe("https://s.public.blob.vercel-storage.com/tools/a/photo-1-Zz9.jpg");

    const untouched = transformRow(
      table("attachments"),
      { id: "a3", blob_pathname: "static", access: "public", public_url: "/tool-images/form-4.png" },
      rewrites
    ).row;
    expect(untouched.public_url).toBe("/tool-images/form-4.png");
  });

  it("holds a self-reference back for the second pass", () => {
    const { row, deferred } = transformRow(
      table("pending_tools"),
      { id: "p2", name: "Dup", duplicate_of_pending_id: "p1" },
      emptyRewrites()
    );
    expect(row.duplicate_of_pending_id).toBeNull();
    expect(deferred).toEqual({ id: "p2", duplicate_of_pending_id: "p1" });
    expect(transformRow(table("pending_tools"), { id: "p1", duplicate_of_pending_id: null }, emptyRewrites()).deferred).toBeNull();
  });
});

describe("findEarlierUploads", () => {
  const file: LocalFile = {
    pathname: "tools/a/photo-1.jpg",
    access: "public",
    contentType: "image/jpeg",
    size: 10,
    urls: ["http://localhost:3001/api/dev-blob/tools/a/photo-1.jpg"],
    rows: [{ id: "a1", sizeBytes: 10 }],
  };

  it("reuses the copy a previous push made for the same row", () => {
    const hosted = [
      { id: "a1", access: "public", blob_pathname: "tools/a/photo-1-AbC123.jpg", public_url: "https://s.public.blob.vercel-storage.com/tools/a/photo-1-AbC123.jpg", size_bytes: 10 },
    ];
    expect(findEarlierUploads([file], hosted).get(file.pathname)).toEqual({
      pathname: "tools/a/photo-1-AbC123.jpg",
      url: "https://s.public.blob.vercel-storage.com/tools/a/photo-1-AbC123.jpg",
      access: "public",
    });
  });

  it("uploads again when the size, access or pathname differs", () => {
    const base = { id: "a1", access: "public", blob_pathname: "tools/a/photo-1-AbC123.jpg", public_url: "https://x/y", size_bytes: 10 };
    expect(findEarlierUploads([file], [{ ...base, size_bytes: 11 }]).size).toBe(0);
    expect(findEarlierUploads([file], [{ ...base, access: "private" }]).size).toBe(0);
    expect(findEarlierUploads([file], [{ ...base, blob_pathname: "tools/a/other-AbC.jpg" }]).size).toBe(0);
    expect(findEarlierUploads([file], [{ ...base, public_url: "http://localhost:3001/api/dev-blob/x" }]).size).toBe(0);
    expect(findEarlierUploads([file], [{ ...base, id: "a9" }]).size).toBe(0);
  });
});

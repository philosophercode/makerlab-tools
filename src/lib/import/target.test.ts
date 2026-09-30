// @vitest-environment node
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tools } from "../db/schema/index";
import {
  describeFileStore,
  describeImportTarget,
  NoImportTargetError,
  openImportTarget,
  resolveImportTarget,
  uploaderForTarget,
} from "./target";

/** Where the import scripts write, and where their files go — no network. */

const NEON = "postgres://user:secret@ep-example.neon.tech/db";

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("PGLITE_DATA_DIR", "");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.stubEnv("BLOB_LOCAL_DIR", "");
  vi.stubEnv("BLOB_LOCAL_DISABLE", "");
  vi.stubEnv("AUTH_BASE_URL", "http://localhost:3001");
});

describe("resolveImportTarget", () => {
  it.each([
    { dryRun: true, url: NEON, dir: ".pglite-data", expected: "memory" },
    { dryRun: false, url: NEON, dir: ".pglite-data", expected: "neon" },
    { dryRun: false, url: NEON, dir: "", expected: "neon" },
    { dryRun: false, url: "", dir: ".pglite-data", expected: "pglite-local" },
  ])("dryRun=$dryRun DATABASE_URL=$url PGLITE_DATA_DIR=$dir → $expected", ({ dryRun, url, dir, expected }) => {
    vi.stubEnv("DATABASE_URL", url);
    vi.stubEnv("PGLITE_DATA_DIR", dir);
    expect(resolveImportTarget({ dryRun }).kind).toBe(expected);
  });

  it("throws a sentence naming both variables when there is no target", () => {
    expect(() => resolveImportTarget()).toThrow(NoImportTargetError);
    expect(() => resolveImportTarget()).toThrow(/DATABASE_URL.*PGLITE_DATA_DIR/);
  });

  it("refuses a local target in production", () => {
    vi.stubEnv("PGLITE_DATA_DIR", ".pglite-data");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => resolveImportTarget()).toThrow(/local development only/);
  });

  it("describes a Neon target by host only, never the credentials", () => {
    vi.stubEnv("DATABASE_URL", NEON);
    const line = describeImportTarget(resolveImportTarget());
    expect(line).toContain("ep-example.neon.tech");
    expect(line).not.toContain("secret");
  });
});

describe("uploaderForTarget", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "import-target-"));
    vi.spyOn(process, "cwd").mockReturnValue(cwd);
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("copies nothing on a dry run", () => {
    expect(uploaderForTarget({ kind: "memory" })).toBeNull();
    expect(describeFileStore({ kind: "memory" })).toBe("none");
  });

  it("insists on Vercel Blob for a DATABASE_URL target, even with the local store available", () => {
    expect(() => uploaderForTarget({ kind: "neon", url: NEON })).toThrow(/BLOB_READ_WRITE_TOKEN/);
  });

  it("uses Vercel Blob for a DATABASE_URL target when the token is set", () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_test");
    expect(uploaderForTarget({ kind: "neon", url: NEON })).not.toBeNull();
    expect(describeFileStore({ kind: "neon", url: NEON })).toBe("Vercel Blob");
  });

  it("writes a local target's files to .blob-data/ with dev-server URLs", async () => {
    const target = { kind: "pglite-local" as const, dir: join(cwd, ".pglite-data") };
    const uploader = uploaderForTarget(target);
    expect(uploader).not.toBeNull();
    expect(describeFileStore(target)).toContain("http://localhost:3001/api/dev-blob/");

    const stored = await uploader!.put("tools/mill/photo.png", new Uint8Array([1, 2, 3]), {
      access: "public",
      contentType: "image/png",
    });
    expect(stored.url).toMatch(/^http:\/\/localhost:3001\/api\/dev-blob\/tools\/mill\/photo-/);
    expect(await readdir(join(cwd, ".blob-data", "tools", "mill"))).toHaveLength(1);
  });

  it("uses Vercel Blob for a local target when a token is set", () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_test");
    expect(describeFileStore({ kind: "pglite-local", dir: cwd })).toBe("Vercel Blob");
  });

  it("says how to proceed when the local store is switched off", () => {
    vi.stubEnv("BLOB_LOCAL_DISABLE", "1");
    expect(() => uploaderForTarget({ kind: "pglite-local", dir: cwd })).toThrow(/--skip-files/);
  });
});

describe("openImportTarget", () => {
  it("opens a local target migrated and empty, and releases it on close", async () => {
    const dir = await mkdtemp(join(tmpdir(), "import-target-db-"));
    try {
      const first = await openImportTarget({ kind: "pglite-local", dir });
      expect(await first.db.select().from(tools)).toEqual([]);
      await first.db.insert(tools).values({ name: "Band Saw", slug: "band-saw" });
      await first.close();

      const second = await openImportTarget({ kind: "pglite-local", dir });
      const rows = await second.db.select({ slug: tools.slug }).from(tools);
      await second.close();
      expect(rows.map((row) => row.slug)).toEqual(["band-saw"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

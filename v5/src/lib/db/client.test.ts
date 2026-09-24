// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sql } from "drizzle-orm";
import { dataSubstrate, getDb, pingDb, resetDbForTests } from "./client";
import { localDataDir } from "./local-dir";
import { rawRows } from "./raw";
import { tools } from "./schema/index";

describe("db client", () => {
  beforeEach(() => {
    vi.stubEnv("PGLITE_DATA_DIR", "");
  });

  afterEach(() => {
    resetDbForTests();
  });

  describe("substrate selection: DATABASE_URL > PGLITE_DATA_DIR > demo", () => {
    const NEON = "postgres://user:pass@example.neon.tech/db";

    it.each([
      { url: NEON, dir: "", expected: "neon" },
      { url: NEON, dir: ".pglite-data", expected: "neon" },
      { url: "", dir: ".pglite-data", expected: "pglite-local" },
      { url: "", dir: "   ", expected: "pglite-demo" },
      { url: "", dir: "", expected: "pglite-demo" },
    ])("DATABASE_URL=$url PGLITE_DATA_DIR=$dir → $expected", ({ url, dir, expected }) => {
      vi.stubEnv("DATABASE_URL", url);
      vi.stubEnv("PGLITE_DATA_DIR", dir);
      expect(dataSubstrate()).toBe(expected);
    });

    it("resolves a relative PGLITE_DATA_DIR against the working directory", () => {
      vi.stubEnv("PGLITE_DATA_DIR", ".pglite-data");
      expect(localDataDir()).toBe(resolve(process.cwd(), ".pglite-data"));
    });

    it.each([
      { env: { NODE_ENV: "production" } },
      { env: { VERCEL: "1" } },
    ])("refuses PGLITE_DATA_DIR with $env", ({ env }) => {
      vi.stubEnv("DATABASE_URL", "");
      vi.stubEnv("PGLITE_DATA_DIR", ".pglite-data");
      for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
      expect(() => dataSubstrate()).toThrow(/local development only/);
      expect(() => getDb()).toThrow(/local development only/);
    });

    it("ignores PGLITE_DATA_DIR in production when DATABASE_URL wins anyway", () => {
      vi.stubEnv("DATABASE_URL", NEON);
      vi.stubEnv("PGLITE_DATA_DIR", ".pglite-data");
      vi.stubEnv("NODE_ENV", "production");
      expect(dataSubstrate()).toBe("neon");
    });
  });

  it("opens PGLITE_DATA_DIR unseeded, and a second open (after a reset) sees the same rows", async () => {
    const dir = await mkdtemp(join(tmpdir(), "db-client-local-"));
    try {
      vi.stubEnv("DATABASE_URL", "");
      vi.stubEnv("PGLITE_DATA_DIR", dir);
      expect(dataSubstrate()).toBe("pglite-local");

      const db = await getDb();
      expect(await db.select().from(tools)).toEqual([]);
      await db.insert(tools).values({ name: "Local Laser", slug: "local-laser" });
      expect(await getDb()).toBe(db);

      resetDbForTests();
      const reopened = await getDb();
      expect(reopened).not.toBe(db);
      const rows = await reopened.select({ slug: tools.slug }).from(tools);
      expect(rows.map((row) => row.slug)).toEqual(["local-laser"]);
    } finally {
      resetDbForTests();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("chooses PGlite when DATABASE_URL is unset and seeds the demo catalogue", async () => {
    vi.stubEnv("DATABASE_URL", "");
    expect(dataSubstrate()).toBe("pglite-demo");

    const db = await getDb();
    const rows = await db.select({ slug: tools.slug }).from(tools).orderBy(tools.slug);
    expect(rows.map((row) => row.slug)).toEqual(["form-4", "trotec-speedy-400"]);
  });

  it("memoises the handle across calls", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const first = await getDb();
    const second = await getDb();
    expect(second).toBe(first);
  });

  it("reports the Neon substrate when DATABASE_URL is set, without connecting", () => {
    vi.stubEnv("DATABASE_URL", "postgres://user:pass@example.neon.tech/db");
    expect(dataSubstrate()).toBe("neon");
    // Creating the handle is lazy and touches no network; only a query would.
    expect(getDb()).toBeInstanceOf(Promise);
  });

  it("pingDb succeeds against PGlite", async () => {
    vi.stubEnv("DATABASE_URL", "");
    await expect(pingDb()).resolves.toBeUndefined();
    const db = await getDb();
    const rows = await rawRows<{ one: number }>(db, sql`select 1 as one`);
    expect(rows[0].one).toBe(1);
  });
});

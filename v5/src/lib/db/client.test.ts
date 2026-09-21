// @vitest-environment node
import { sql } from "drizzle-orm";
import { dataSubstrate, getDb, pingDb, resetDbForTests } from "./client";
import { rawRows } from "./raw";
import { tools } from "./schema/index";

describe("db client", () => {
  afterEach(() => {
    resetDbForTests();
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

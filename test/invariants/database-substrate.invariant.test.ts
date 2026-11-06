// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fc, RUNS } from "./fc";

const seedSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db/demo-seed", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/db/demo-seed")>();
  return { ...real, seedDemo: (...args: Parameters<typeof real.seedDemo>) => (seedSpy(...args), real.seedDemo(...args)) };
});

import { dataSubstrate, getDb, resetDbForTests } from "@/lib/db/client";

/**
 * INVARIANT 4 — sample data never lands in a configured database, and a
 * deployment never runs on a throwaway one.
 *
 * Production and the public demo are separate Vercel projects, each with its
 * own Neon `DATABASE_URL`; which database a deployment reaches is only ever
 * that variable. What the code must guarantee, whatever else is set:
 *
 * - `DATABASE_URL` set → Neon, and the demo seed is never loaded or run.
 * - `DATABASE_URL` unset → PGlite, never Neon.
 * - `PGLITE_DATA_DIR` on Vercel or in a production build → refused loudly,
 *   never a silent fallback to the in-memory demo seed.
 * - The demo seed is imported by exactly two places outside tests: the
 *   in-memory branch of `db/client.ts` and the in-memory branch of
 *   `scripts/lab-check.ts`. A new importer has to be added here on purpose.
 */

const ROOT = join(__dirname, "../..");

afterEach(() => resetDbForTests());

const envValue = fc.oneof(fc.constant(""), fc.constant(undefined), fc.constantFrom("1", "production", "development", "./data"));

describe("invariant: the data substrate follows DATABASE_URL and nothing else", () => {
  it("Neon iff DATABASE_URL is set, for any combination of the other switches", () => {
    fc.assert(
      fc.property(
        fc.option(fc.webUrl().map((u) => u.replace(/^https?/, "postgres")), { nil: "" }),
        fc.record({ DEMO_ADMIN: envValue, VERCEL: envValue, PGLITE_DATA_DIR: envValue, NODE_ENV: envValue }),
        (url, others) => {
          vi.stubEnv("DATABASE_URL", url);
          for (const [k, v] of Object.entries(others)) vi.stubEnv(k, v ?? "");
          let substrate: string;
          try {
            substrate = dataSubstrate();
          } catch (err) {
            // The only refusal: a laptop-only directory on a deployment.
            expect(String(err)).toMatch(/PGLITE_DATA_DIR/);
            expect(url).toBe("");
            expect(Boolean(others.VERCEL) || others.NODE_ENV === "production").toBe(true);
            return;
          }
          if (url) expect(substrate).toBe("neon");
          else expect(substrate).not.toBe("neon");
          if (substrate === "pglite-local") {
            expect(others.VERCEL).toBeFalsy();
            expect(others.NODE_ENV).not.toBe("production");
          }
        }
      ),
      { numRuns: RUNS }
    );
  });

  it("opening a configured database never runs the demo seed", async () => {
    seedSpy.mockClear();
    vi.stubEnv("DATABASE_URL", "postgres://user:pass@db.invalid.example/neondb");
    vi.stubEnv("DEMO_ADMIN", "1");
    await getDb();
    expect(seedSpy).not.toHaveBeenCalled();

    // Sanity: the unset branch does seed, so the spy is wired.
    resetDbForTests();
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("PGLITE_DATA_DIR", "");
    await getDb();
    expect(seedSpy).toHaveBeenCalledTimes(1);
  }, 30_000);
});

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe("invariant: the demo seed has exactly the expected importers", () => {
  it("only the in-memory branches import demo-seed", () => {
    const importers = [...walk(join(ROOT, "src")), ...walk(join(ROOT, "scripts"))]
      .filter((file) => /["'][^"']*db\/demo-seed(\.ts)?["']|["']\.\/demo-seed(\.ts)?["']/.test(readFileSync(file, "utf8")))
      .map((file) => relative(ROOT, file))
      .sort();
    expect(importers).toEqual(["scripts/lab-check.ts", "src/lib/db/client.ts"]);
  });
});

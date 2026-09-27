// @vitest-environment node
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openPersistentPglite } from "./pglite";
import { PgliteLockedError } from "./pglite-lock";
import { tools } from "./schema/index";

/** `PGLITE_DATA_DIR`'s database: persistent, unseeded, one process at a time. */

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pglite-local-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("openPersistentPglite", () => {
  it("creates a missing directory, migrates it, and loads no demo seed", async () => {
    const target = join(dir, "nested", "data");
    const local = await openPersistentPglite(target);
    try {
      expect(await local.db.select().from(tools)).toEqual([]);
      expect(existsSync(join(target, "pgdata", "PG_VERSION"))).toBe(true);
    } finally {
      await local.close();
    }
  });

  it("keeps rows across a close and a reopen", async () => {
    const first = await openPersistentPglite(dir);
    await first.db.insert(tools).values({ name: "Imported Mill", slug: "imported-mill" });
    await first.close();

    const second = await openPersistentPglite(dir);
    try {
      const rows = await second.db.select({ slug: tools.slug }).from(tools);
      expect(rows.map((row) => row.slug)).toEqual(["imported-mill"]);
    } finally {
      await second.close();
    }
  });

  it("holds a pid lock while open and releases it on close", async () => {
    const local = await openPersistentPglite(dir);
    expect(await readFile(join(dir, "lock"), "utf8")).toBe(String(process.pid));
    await local.close();
    expect(existsSync(join(dir, "lock"))).toBe(false);
  });

  it("refuses a directory another running process holds, naming it", async () => {
    // The parent (the Vitest runner) is certainly alive and is not us.
    await writeFile(join(dir, "lock"), String(process.ppid));

    const opening = openPersistentPglite(dir);
    await expect(opening).rejects.toBeInstanceOf(PgliteLockedError);
    await expect(opening).rejects.toThrow(new RegExp(`in use by process ${process.ppid}.*stop that process`));
    // The other process's lock is left alone.
    expect(await readFile(join(dir, "lock"), "utf8")).toBe(String(process.ppid));
  });

  it("takes over a stale lock left by a process that is gone", async () => {
    // Beyond any real pid range, so certainly not running.
    await writeFile(join(dir, "lock"), "2147483000");

    const local = await openPersistentPglite(dir);
    try {
      expect(await readFile(join(dir, "lock"), "utf8")).toBe(String(process.pid));
    } finally {
      await local.close();
    }
  });
});

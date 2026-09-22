// @vitest-environment node
import { eq, getTableName } from "drizzle-orm";
import { createPgliteDb } from "../db/pglite";
import { DEMO_ACCOUNTS, seedDemo } from "../db/demo-seed";
import { account, attachments, session, tools, user } from "../db/schema/index";
import type { Db } from "../db/types";
import type { BlobStore } from "../blob";
import { backupTables, expiredBackups, runBackup } from "./backup";

/**
 * The nightly export against a real (in-process) Postgres, with the Blob seam
 * stubbed. No environment variable, no network.
 */

let db: Db;

beforeAll(async () => {
  db = await createPgliteDb({ seed: seedDemo });
});

function fakeStore() {
  const store = {
    put: vi.fn().mockResolvedValue({ pathname: "written" }),
    putUpload: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    del: vi.fn().mockResolvedValue(undefined),
  };
  return store as typeof store & BlobStore;
}

/** The body handed to `store.put`, parsed. */
function writtenFile(store: ReturnType<typeof fakeStore>) {
  return JSON.parse(store.put.mock.calls[0][1] as string);
}

describe("backupTables", () => {
  it("discovers every table in the schema rather than listing them", async () => {
    const names = backupTables().map(getTableName);

    // Listed by hand, a table added in a later phase is backed up only if
    // somebody remembers — which is the failure a backup exists to prevent.
    expect(names).toContain("tools");
    expect(names).toContain("maintenance_logs");
    expect(names).toContain("feedback");
    expect(names).toContain("projects");
    expect(names).toContain("attachments");
    expect(names).toContain("audit_events");

    // Phase 4's people, yes — their roles and bans are the state a restore
    // would most need to get right.
    expect(names).toContain("user");
    expect(names).toContain("account");

    // Phase 4's credentials, no. Discovery would have archived thirty days of
    // live bearer tokens without anybody choosing to (backup-policy.ts).
    expect(names).not.toContain("session");
    expect(names).not.toContain("verification");
  });
});

describe("runBackup", () => {
  it("writes no credential into the file", async () => {
    const store = fakeStore();

    await runBackup(store, { db, now: new Date("2026-09-20T07:17:00.000Z") });
    const body = store.put.mock.calls[0][1] as string;
    const file = JSON.parse(body);

    // The demo seed signs four people in, so there are real session rows here.
    const sessions = await db.select().from(session);
    expect(sessions.length).toBeGreaterThan(0);

    expect(file.tables.session).toBeUndefined();
    expect(file.tables.verification).toBeUndefined();
    // The strongest form of the assertion: the token is not in the bytes at
    // all, by whatever route it might have got there.
    expect(body).not.toContain(DEMO_ACCOUNTS.superAdmin.sessionToken);

    // The people survive, because that is what a restore is for.
    expect(file.tables.user.rowCount).toBe(
      (await db.select().from(user)).length
    );
  });

  it("blanks the account tokens but keeps the Google link", async () => {
    const store = fakeStore();
    await db.insert(account).values({
      id: "backup-test-account",
      accountId: "google-sub-backup-test",
      providerId: "google",
      userId: DEMO_ACCOUNTS.user.id,
      accessToken: "ya29.live-access-token",
      refreshToken: "1//live-refresh-token",
    });

    try {
      await runBackup(store, { db, now: new Date("2026-09-20T07:17:00.000Z") });
      const body = store.put.mock.calls[0][1] as string;
      const file = JSON.parse(body);
      const row = file.tables.account.rows.find(
        (r: { id: string }) => r.id === "backup-test-account"
      );

      expect(row.accessToken).toBeNull();
      expect(row.refreshToken).toBeNull();
      expect(row.accountId).toBe("google-sub-backup-test");
      expect(body).not.toContain("ya29.live-access-token");
    } finally {
      await db.delete(account).where(eq(account.id, "backup-test-account"));
    }
  });

  it("writes one JSON file per day, named backups/YYYY-MM-DD.json", async () => {
    const store = fakeStore();

    const result = await runBackup(store, {
      db,
      now: new Date("2026-09-20T07:17:00.000Z"),
    });

    expect(result.pathname).toBe("backups/2026-09-20.json");
    expect(store.put).toHaveBeenCalledTimes(1);
    expect(store.put.mock.calls[0][0]).toBe("backups/2026-09-20.json");
    expect(store.put.mock.calls[0][2]).toBe("application/json");
  });

  it("exports the rows themselves, not a count", async () => {
    const store = fakeStore();

    await runBackup(store, { db, now: new Date("2026-09-20T07:17:00.000Z") });
    const file = writtenFile(store);
    const seeded = await db.select().from(tools);

    expect(file.version).toBe(2);
    // A restore has to be able to tell a Postgres export from the version-1
    // Notion dump it replaces.
    expect(file.source).toBe("postgres");
    expect(file.tables.tools.rowCount).toBe(seeded.length);
    expect(file.tables.tools.rows).toHaveLength(seeded.length);
    expect(file.tables.tools.rows[0].name).toBeTruthy();
  });

  it("reports each table's row count in its result", async () => {
    const store = fakeStore();

    const result = await runBackup(store, { db });

    const seeded = await db.select().from(tools);
    expect(result.tables.tools).toBe(seeded.length);
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.retentionDays).toBe(30);
  });

  it("includes an empty table rather than omitting it", async () => {
    const store = fakeStore();
    await db.delete(attachments);

    await runBackup(store, { db });

    // A missing key would read as "this table was not backed up" on restore.
    expect(writtenFile(store).tables.attachments).toEqual({
      rowCount: 0,
      rows: [],
    });
  });

  it("throws rather than reporting success when the write fails", async () => {
    const store = fakeStore();
    store.put.mockRejectedValueOnce(new Error("blob down"));

    await expect(runBackup(store, { db })).rejects.toThrow("blob down");
  });
});

describe("runBackup — 30-day retention", () => {
  it("prunes backups past the window and keeps the rest", async () => {
    const store = fakeStore();
    const now = new Date("2026-09-20T07:17:00.000Z");
    store.list.mockResolvedValue([
      { pathname: "backups/2026-08-01.json", uploadedAt: "" },
      { pathname: "backups/2026-09-19.json", uploadedAt: "" },
    ]);

    const result = await runBackup(store, { db, now });

    expect(result.pruned).toEqual(["backups/2026-08-01.json"]);
    expect(store.del).toHaveBeenCalledWith(["backups/2026-08-01.json"]);
  });
});

describe("expiredBackups", () => {
  const now = new Date("2026-09-20T00:00:00.000Z");

  it("never deletes a blob whose pathname it does not recognise", () => {
    // A prune step that deletes files it does not recognise is a hazard, not a
    // housekeeper — an upload that landed under the wrong prefix must survive.
    expect(
      expiredBackups(
        ["uploads/project/lamp-Xa9k2.png", "backups/notes.txt", "backups/"],
        now
      )
    ).toEqual([]);
  });

  it("keeps a backup exactly one day inside the window", () => {
    expect(expiredBackups(["backups/2026-08-22.json"], now)).toEqual([]);
    expect(expiredBackups(["backups/2026-08-21.json"], now)).toEqual([
      "backups/2026-08-21.json",
    ]);
  });
});

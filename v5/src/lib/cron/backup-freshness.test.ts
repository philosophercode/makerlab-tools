// @vitest-environment node
const blob = vi.hoisted(() => ({ configured: { value: true }, list: vi.fn() }));

vi.mock("../blob", () => ({
  isBlobConfigured: () => blob.configured.value,
  getBlobStore: () => ({ list: blob.list }),
}));

import en from "../../../messages/en.json";
import {
  BACKUP_FRESHNESS_CACHE_MS,
  adminBackupNotice,
  backupFreshness,
  loadBackupFreshness,
  loadBackupFreshnessCached,
  resetBackupFreshnessCache,
  type BackupFreshness,
} from "./backup-freshness";

const NOW = new Date("2026-09-20T12:00:00.000Z");

beforeEach(() => {
  blob.configured.value = true;
  blob.list.mockReset();
  resetBackupFreshnessCache();
});

describe("backupFreshness", () => {
  it("is fresh when last night's backup landed", () => {
    expect(
      backupFreshness([{ pathname: "backups/2026-09-20.json", uploadedAt: "2026-09-20T07:17:04.000Z" }], NOW)
    ).toEqual({ state: "fresh", latestAt: "2026-09-20T07:17:04.000Z" });
  });

  it("is still fresh at 36 hours and stale just after", () => {
    const blobs = [{ pathname: "backups/2026-09-19.json", uploadedAt: "2026-09-19T00:00:00.000Z" }];
    expect(backupFreshness(blobs, new Date("2026-09-20T12:00:00.000Z")).state).toBe("fresh");
    expect(backupFreshness(blobs, new Date("2026-09-20T12:00:01.000Z")).state).toBe("stale");
  });

  it("judges by the newest file, whatever the listing order", () => {
    const result = backupFreshness(
      [
        { pathname: "backups/2026-09-20.json", uploadedAt: "2026-09-20T07:17:00.000Z" },
        { pathname: "backups/2026-08-01.json", uploadedAt: "2026-08-01T07:17:00.000Z" },
      ],
      NOW
    );
    expect(result.state).toBe("fresh");
  });

  it("falls back to the date in the name when uploadedAt is unreadable", () => {
    expect(backupFreshness([{ pathname: "backups/2026-09-10.json", uploadedAt: "" }], NOW)).toEqual({
      state: "stale",
      latestAt: "2026-09-10T00:00:00.000Z",
    });
  });

  it("is missing when nothing under backups/ is a backup", () => {
    expect(backupFreshness([{ pathname: "backups/notes.txt", uploadedAt: NOW.toISOString() }], NOW)).toEqual({
      state: "missing",
    });
  });
});

describe("loadBackupFreshness", () => {
  it("lists the private backups prefix once", async () => {
    blob.list.mockResolvedValue([{ pathname: "backups/2026-09-20.json", uploadedAt: "2026-09-20T07:17:00.000Z" }]);
    expect((await loadBackupFreshness(NOW)).state).toBe("fresh");
    expect(blob.list).toHaveBeenCalledWith("backups/", "private");
  });

  it("says no_store without calling Blob when none is linked", async () => {
    blob.configured.value = false;
    expect(await loadBackupFreshness(NOW)).toEqual({ state: "no_store" });
    expect(blob.list).not.toHaveBeenCalled();
  });

  it("says unreadable, rather than throwing or claiming fresh, when the list fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    blob.list.mockRejectedValue(new Error("blob down"));
    expect(await loadBackupFreshness(NOW)).toEqual({ state: "unreadable" });
    warn.mockRestore();
  });
});

describe("loadBackupFreshnessCached", () => {
  it("reuses one Blob list for five minutes, then lists again", async () => {
    blob.list.mockResolvedValue([{ pathname: "backups/2026-09-20.json", uploadedAt: "2026-09-20T07:17:00.000Z" }]);
    await loadBackupFreshnessCached(NOW);
    await loadBackupFreshnessCached(new Date(NOW.getTime() + BACKUP_FRESHNESS_CACHE_MS - 1));
    expect(blob.list).toHaveBeenCalledTimes(1);
    await loadBackupFreshnessCached(new Date(NOW.getTime() + BACKUP_FRESHNESS_CACHE_MS));
    expect(blob.list).toHaveBeenCalledTimes(2);
  });
});

describe("adminBackupNotice (the /admin warning)", () => {
  const load = (value: BackupFreshness) => vi.fn(async () => value);

  it("is null, without reading Blob, for anyone who cannot manage users", async () => {
    const loader = load({ state: "missing" });
    expect(await adminBackupNotice({ canManageUsers: false, substrate: "neon", load: loader })).toBeNull();
    expect(loader).not.toHaveBeenCalled();
  });

  it("is null, without reading Blob, off the live database", async () => {
    const loader = load({ state: "missing" });
    expect(await adminBackupNotice({ canManageUsers: true, substrate: "pglite-local", load: loader })).toBeNull();
    expect(loader).not.toHaveBeenCalled();
  });

  it("is null when the backup is fresh", async () => {
    const notice = await adminBackupNotice({
      canManageUsers: true,
      substrate: "neon",
      load: load({ state: "fresh", latestAt: "2026-09-20T07:17:00.000Z" }),
    });
    expect(notice).toBeNull();
  });

  it("names the stale backup's date", async () => {
    const notice = await adminBackupNotice({
      canManageUsers: true,
      substrate: "neon",
      load: load({ state: "stale", latestAt: "2026-09-17T07:17:00.000Z" }),
    });
    expect(notice).toEqual({ key: "backupNotice.stale", date: "2026-09-17" });
  });

  it.each(["missing", "no_store", "unreadable"] as const)("warns %s with no date", async (state) => {
    const notice = await adminBackupNotice({ canManageUsers: true, substrate: "neon", load: load({ state }) });
    expect(notice).toEqual({ key: `backupNotice.${state}`, date: "" });
  });

  it("has an English message for every notice key", () => {
    const messages = (en as { admin: { backupNotice: Record<string, string> } }).admin.backupNotice;
    for (const state of ["stale", "missing", "no_store", "unreadable"]) expect(messages[state]).toBeTruthy();
    expect(messages.stale).toContain("{date}");
  });
});

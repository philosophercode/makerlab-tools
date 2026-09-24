// @vitest-environment node

// Vercel Blob is the one service MSW cannot stand in for, so it is mocked at
// the seam `blob.ts` exists to provide. `vi.hoisted` because the `vi.mock`
// factory runs before module scope exists.
const blob = vi.hoisted(() => ({
  configured: { value: true },
  put: vi.fn(),
  putUpload: vi.fn(),
  list: vi.fn(),
  del: vi.fn(),
}));

vi.mock("../../../../lib/blob", () => ({
  isBlobConfigured: () => blob.configured.value,
  getBlobStore: () => ({
    put: blob.put,
    putUpload: blob.putUpload,
    list: blob.list,
    del: blob.del,
  }),
}));

/**
 * A single-shot failure for the pending-expiry stage, so one test can prove
 * the route's own error handling without touching the database seam every
 * other test here relies on. Null means "run the real thing".
 */
const pendingExpiryOverride = vi.hoisted(() => ({ throwOnce: null as Error | null }));

vi.mock("../../../../lib/cron/pending-expiry", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../../lib/cron/pending-expiry")>();
  return {
    ...actual,
    runPendingExpiry: (...args: Parameters<typeof actual.runPendingExpiry>) => {
      if (pendingExpiryOverride.throwOnce) {
        const error = pendingExpiryOverride.throwOnce;
        pendingExpiryOverride.throwOnce = null;
        return Promise.reject(error);
      }
      return actual.runPendingExpiry(...args);
    },
  };
});

import { sql } from "drizzle-orm";
import { getDb, resetDbForTests } from "@/lib/db/client";
import { DEMO_ACCOUNTS } from "@/lib/db/demo-seed";
import { attachments, pendingTools, tools } from "@/lib/db/schema/index";
import { GET } from "./route";

/**
 * The daily cron against the demo-seeded PGlite database. Nothing leaves the
 * process and no credential is real.
 */

const CRON_SECRET = "cron-s3cret";
const ADMIN_SECRET = "admin-s3cret";
const HOUR = 60 * 60 * 1000;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("CRON_SECRET", CRON_SECRET);
  vi.stubEnv("ADMIN_REVALIDATE_SECRET", "");
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_test");

  pendingExpiryOverride.throwOnce = null;
  blob.configured.value = true;
  blob.put.mockReset().mockResolvedValue({ pathname: "written" });
  blob.list.mockReset().mockResolvedValue([]);
  blob.del.mockReset().mockResolvedValue(undefined);

  const db = await getDb();
  await db.delete(pendingTools);
  await db.delete(attachments);
});

afterAll(() => {
  resetDbForTests();
});

// The in-memory limiter is a per-process singleton keyed by IP.
let ipCounter = 0;
function uniqueIp() {
  ipCounter += 1;
  return `203.0.113.${ipCounter}`;
}

function cronRequest(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/cron/daily", {
    method: "GET",
    headers: { "x-forwarded-for": uniqueIp(), ...headers },
  });
}

function authorized() {
  return cronRequest({ authorization: `Bearer ${CRON_SECRET}` });
}

/** The body handed to `store.put`, parsed. */
function writtenFile() {
  return JSON.parse(blob.put.mock.calls[0][1] as string);
}

describe("GET /api/cron/daily — authorization", () => {
  it("refuses with 503 when no secret is configured at all", async () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("ADMIN_REVALIDATE_SECRET", "");

    const res = await GET(cronRequest());

    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("CRON_SECRET");
    // Unconfigured is not open: nothing is read and nothing is written.
    expect(blob.put).not.toHaveBeenCalled();
  });

  it("returns 403 when the bearer is missing", async () => {
    const res = await GET(cronRequest());
    expect(res.status).toBe(403);
    expect(blob.put).not.toHaveBeenCalled();
  });

  it("returns 403 when the bearer is wrong", async () => {
    const res = await GET(cronRequest({ authorization: "Bearer nope" }));
    expect(res.status).toBe(403);
  });

  it("accepts a Vercel Cron request carrying Authorization: Bearer $CRON_SECRET", async () => {
    const res = await GET(authorized());
    expect(res.status).toBe(200);
  });

  it("still accepts the documented hand-trigger header", async () => {
    // `docs/deploy.md` tells an operator to run the backup once by hand after
    // the first deploy; folding the job into the cron route must not quietly
    // remove that affordance.
    vi.stubEnv("ADMIN_REVALIDATE_SECRET", ADMIN_SECRET);

    const res = await GET(cronRequest({ "x-admin-secret": ADMIN_SECRET }));

    expect(res.status).toBe(200);
  });
});

describe("GET /api/cron/daily — the backup stage", () => {
  it("writes one JSON export of Postgres, whose tool count matches the seed", async () => {
    const res = await GET(authorized());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.backup.pathname).toMatch(/^backups\/\d{4}-\d{2}-\d{2}\.json$/);

    const db = await getDb();
    const seeded = await db.select().from(tools);
    expect(writtenFile().tables.tools.rowCount).toBe(seeded.length);
    expect(body.backup.tables.tools).toBe(seeded.length);
  });

  it("prunes an over-retention backup and leaves an unrecognised pathname alone", async () => {
    blob.list.mockResolvedValue([
      { pathname: "backups/2020-01-01.json", uploadedAt: "" },
      { pathname: "uploads/project/lamp-Xa9k2.png", uploadedAt: "" },
    ]);

    const body = await (await GET(authorized())).json();

    expect(body.backup.pruned).toEqual(["backups/2020-01-01.json"]);
  });

  it("returns 500 naming the stage when the backup write fails", async () => {
    blob.put.mockRejectedValueOnce(new Error("blob down"));

    const res = await GET(authorized());
    const body = await res.json();

    // A backup that fails quietly is worse than no backup — this has to land
    // in the cron log as a failed invocation.
    expect(res.status).toBe(500);
    expect(body.stage).toBe("backup");
    expect(body.error).toContain("blob down");
  });
});

describe("GET /api/cron/daily — the pending-expiry stage", () => {
  const DAY_MS = 24 * HOUR;

  /** An `identified` pending-tool row with a photo, backdated `ageDays` old. */
  async function identifiedPending(ageDays: number) {
    const db = await getDb();
    const [row] = await db
      .insert(pendingTools)
      .values({
        batchId: crypto.randomUUID(),
        status: "identified",
        name: "Glowforge Pro",
        createdBy: DEMO_ACCOUNTS.admin.id,
      })
      .returning({ id: pendingTools.id });
    await db.execute(
      sql`update pending_tools set created_at = ${new Date(Date.now() - ageDays * DAY_MS)} where id = ${row.id}`
    );
    const [photo] = await db
      .insert(attachments)
      .values({
        blobPathname: `uploads/tool/${crypto.randomUUID()}.png`,
        access: "public",
        publicUrl: `https://blob.test/${crypto.randomUUID()}.png`,
        ownerType: "pending_tool",
        ownerId: row.id,
        // Backdated with its item: a photo an abandoned batch has carried for
        // two weeks is always well past the 24-hour orphan window once
        // released, which is what lets the sweep below catch it in this same
        // run rather than a day later.
        createdAt: new Date(Date.now() - ageDays * DAY_MS),
      })
      .returning({ id: attachments.id, blobPathname: attachments.blobPathname });
    return { pendingId: row.id, photoId: photo.id, blobPathname: photo.blobPathname };
  }

  it("reports pendingExpiry in the response", async () => {
    await identifiedPending(15);

    const body = await (await GET(authorized())).json();

    expect(body.ok).toBe(true);
    expect(body.pendingExpiry).toMatchObject({ discarded: 1, releasedAttachments: 1, abandoned: 0 });
  });

  it("deletes an expired item's photo blob in the same run", async () => {
    const { pendingId, photoId, blobPathname } = await identifiedPending(15);

    const body = await (await GET(authorized())).json();

    expect(body.ok).toBe(true);
    expect(blob.del).toHaveBeenCalledWith([blobPathname]);
    const db = await getDb();
    expect(await db.select().from(attachments).where(sql`id = ${photoId}`)).toEqual([]);
    const [pending] = await db.select().from(pendingTools).where(sql`id = ${pendingId}`);
    expect(pending.status).toBe("discarded");
  });

  it("returns 500 with stage 'pendingExpiry' when the stage throws, and still reports the backup", async () => {
    pendingExpiryOverride.throwOnce = new Error("pending expiry blew up");

    const res = await GET(authorized());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.stage).toBe("pendingExpiry");
    // Today's backup already landed — losing the next stage must not erase it
    // from the report, the same guarantee the cleanup-stage failure gives.
    expect(body.backup.pathname).toMatch(/^backups\//);
    expect(body.error).toContain("pending expiry blew up");
  });
});

describe("GET /api/cron/daily — the cleanup stage", () => {
  async function upload(
    ageHours: number,
    overrides: Partial<typeof attachments.$inferInsert> = {}
  ) {
    const db = await getDb();
    const [row] = await db
      .insert(attachments)
      .values({
        blobPathname: `uploads/chat/${crypto.randomUUID()}.png`,
        access: "private",
        createdAt: new Date(Date.now() - ageHours * HOUR),
        ...overrides,
      })
      .returning({ id: attachments.id });
    return row.id;
  }

  it("sweeps an unclaimed upload older than 24 hours and reports what it did", async () => {
    await upload(25);

    const body = await (await GET(authorized())).json();

    expect(body.cleanup).toMatchObject({
      orphans: 1,
      blobsDeleted: 1,
      rowsDeleted: 1,
    });
  });

  it("leaves a fresh upload and a claimed one alone", async () => {
    const db = await getDb();
    const [tool] = await db.select({ id: tools.id }).from(tools).limit(1);
    await upload(1);
    // `owner_id` is what marks a file as claimed; an old one still survives.
    await upload(48, { ownerType: "tool", ownerId: tool.id });

    const body = await (await GET(authorized())).json();

    expect(body.cleanup.orphans).toBe(0);
    expect(await db.select().from(attachments)).toHaveLength(2);
  });

  it("returns 500 naming the stage, but reports the backup that did land", async () => {
    await upload(25);
    // The backup's own `del` (the prune) succeeds; the cleanup's fails.
    blob.del.mockResolvedValueOnce(undefined).mockRejectedValueOnce(
      new Error("delete failed")
    );

    const res = await GET(authorized());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.stage).toBe("cleanup");
    // Today's data is safe; only the sweep needs attention. Whoever reads the
    // log has to be able to tell those apart.
    expect(body.backup.pathname).toMatch(/^backups\//);
  });
});

describe("GET /api/cron/daily — blob not configured", () => {
  it("refuses with 503 naming the variable rather than running half the job", async () => {
    blob.configured.value = false;

    const res = await GET(authorized());

    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("BLOB_READ_WRITE_TOKEN");
    expect(blob.put).not.toHaveBeenCalled();
  });
});

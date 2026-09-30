import { eq, and } from "drizzle-orm";
import { start } from "workflow/api";
import { createNotionFake } from "../../test/fakes/notion-fake";
import { useNotionFake as installNotionFake } from "../../test/msw/notion-mirror";
import { server } from "../../test/msw/server";
import { getMirror, saveMirrorConnection } from "../lib/data/mirrors";
import { getDb, resetDbForTests } from "../lib/db/client";
import { DEMO_ACCOUNTS } from "../lib/db/demo-seed";
import { mirrorPages, notionMirrors, tools } from "../lib/db/schema/index";
import { ensureMirrorDatabases } from "../lib/mirror/databases";
import { encryptMirrorToken } from "../lib/mirror/token-crypto";
import { mirrorPush } from "./mirror-push";

/**
 * The one in-process `@workflow/vitest` run of `mirrorPush` (spec §10, the
 * mirror's integration tier): the real workflow runtime, the real step
 * bundle, the seeded PGlite database, and the fake Notion answering on
 * `api.notion.com` through MSW — which, unlike `vi.mock()`, reaches step code
 * (the 2026-09-22 amendment). No network and no real credential: the token
 * and `AUTH_SECRET` are made up here.
 *
 * The step bundle has its own copy of `db/client.ts`, but that module keeps
 * its handle on `globalThis`, so calling `getDb()` here first means the steps
 * find this same PGlite database.
 */

const AUTH_SECRET = "mirror-workflow-test-secret-0123456789";
const TOKEN = `ntn_${"W0rkfl0wT3st".repeat(4)}`;

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  await getDb();
});

afterAll(() => {
  resetDbForTests();
});

describe("mirrorPush (in process)", () => {
  it("pushes the demo inventory into the fake Notion and records ok", { timeout: 120_000 }, async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("AUTH_SECRET", AUTH_SECRET);

    const printed: unknown[][] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        printed.push(args);
      });
    }

    const fake = createNotionFake({ token: TOKEN });
    const parentPageId = fake.addPage({ title: "MakerLab mirror" });
    installNotionFake(server, fake);

    const db = await getDb();
    await db.delete(notionMirrors);
    const { mirror } = await saveMirrorConnection({
      ownerUserId: DEMO_ACCOUNTS.admin.id,
      tokenCiphertext: encryptMirrorToken(TOKEN, AUTH_SECRET),
      parentPageId,
      parentPageTitle: "MakerLab mirror",
    });

    const ensured = await ensureMirrorDatabases(mirror.id);
    expect(ensured.ok).toBe(true);
    if (!ensured.ok) throw new Error("unreachable");
    const toolsDatabase = ensured.mapping.tools;
    expect(toolsDatabase).toBeTruthy();

    const run = await start(mirrorPush, [mirror.id]);
    const summary = await run.returnValue;

    expect(summary).toMatchObject({ mirrorId: mirror.id, state: "ok" });
    expect(summary.pushed).toBeGreaterThan(0);

    const after = await getMirror(mirror.id);
    expect(after?.lastStatus).toBe("ok");
    expect(after?.lastSyncedAt).not.toBeNull();
    expect(after?.lastError).toBeNull();
    expect(after?.runningSince).toBeNull();

    // Every tool — published or not — has a page in the tools database, and
    // a mirror_pages row pointing at it.
    const demoTools = await db.select({ id: tools.id }).from(tools);
    expect(demoTools.length).toBeGreaterThan(0);
    expect(fake.pagesIn(toolsDatabase!)).toHaveLength(demoTools.length);
    const recorded = await db
      .select({ entityId: mirrorPages.entityId, notionPageId: mirrorPages.notionPageId })
      .from(mirrorPages)
      .where(and(eq(mirrorPages.mirrorId, mirror.id), eq(mirrorPages.entity, "tools")));
    expect(recorded.map((row) => row.entityId).sort()).toEqual(demoTools.map((row) => row.id).sort());
    for (const row of recorded) expect(fake.pages.has(row.notionPageId)).toBe(true);

    // Never the token, anywhere a log line could carry it (§10 "cases that
    // would embarrass us"), nor the secret it is encrypted under.
    const output = printed.map((args) => args.map(printable).join(" ")).join("\n");
    expect(output).not.toContain(TOKEN);
    expect(output).not.toContain(AUTH_SECRET);
  });
});

/** One console argument as text, whatever it is. */
function printable(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return `${arg.message} ${arg.stack ?? ""} ${printable(arg.cause)}`;
  try {
    return JSON.stringify(arg) ?? String(arg);
  } catch {
    return String(arg);
  }
}

// @vitest-environment node
import { nextCacheMock } from "../../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());

/** Withhold or grant one permission — see `admin/corrections/actions.test.ts`. */
const override = vi.hoisted(() => ({ permissions: null as Set<string> | null }));

vi.mock("../../../lib/auth/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/auth/permissions")>();
  return {
    ...actual,
    can: (subject: Parameters<typeof actual.can>[0], permission: string) =>
      override.permissions
        ? override.permissions.has(permission)
        : actual.can(subject, permission as Parameters<typeof actual.can>[1]),
  };
});

/** The audit insert is a second statement, after the change; it can fail on its own. */
const audit = vi.hoisted(() => ({ failing: false }));

vi.mock("../../../lib/data/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/data/audit")>();
  return {
    ...actual,
    recordAuditEvent: async (event: Parameters<typeof actual.recordAuditEvent>[0]) => {
      if (audit.failing) throw new Error("connection terminated unexpectedly");
      return actual.recordAuditEvent(event);
    },
  };
});

/** A connect that throws, to prove a thrown error's text is scrubbed before it is logged. */
const connectThrow = vi.hoisted(() => ({ message: null as string | null }));

vi.mock("../../../lib/mirror/connect", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/mirror/connect")>();
  return {
    ...actual,
    connectMirror: async (...args: Parameters<typeof actual.connectMirror>) => {
      if (connectThrow.message) throw new Error(connectThrow.message);
      return actual.connectMirror(...args);
    },
  };
});

// Starting a workflow is Part B's; creating and validating databases is Part
// A's. Both are stubbed here so these tests are about the endpoints: who may
// call them, which mirror they reach, and what they answer.
vi.mock("../../../lib/mirror/start", () => ({
  syncMirrorNow: vi.fn(),
  startMirrorPush: vi.fn(),
  startCoalescedPush: vi.fn(),
}));

vi.mock("../../../lib/mirror/databases", () => ({
  ensureMirrorDatabases: vi.fn(),
  applyPastedMapping: vi.fn(),
}));

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { server } from "../../../../test/msw/server";
// Aliased: the name starts with `use`, which eslint's rules-of-hooks reads as a React hook.
import { useNotionFake as installNotionFake } from "../../../../test/msw/notion-mirror";
import { createNotionFake, type NotionFake } from "../../../../test/fakes/notion-fake";
import { signInAsNew, type SignedInSession } from "../../../../test/utils/session";
import { resetAuthForTests } from "../../../lib/auth/config";
import { saveMirrorConnection, setMirrorMapping } from "../../../lib/data/mirrors";
import { getDb, resetDbForTests } from "../../../lib/db/client";
import { auditEvents, notionMirrors, session, user } from "../../../lib/db/schema/index";
import type { Db } from "../../../lib/db/types";
import { applyPastedMapping, ensureMirrorDatabases } from "../../../lib/mirror/databases";
import { syncMirrorNow } from "../../../lib/mirror/start";
import { decryptMirrorToken, encryptMirrorToken } from "../../../lib/mirror/token-crypto";
import {
  connect,
  createDatabases,
  disconnect,
  saveMapping,
  setPaused,
  syncNow,
  testConnection,
} from "./actions";

/**
 * The mirror page's endpoints (spec §3.8, §5.8, §8), called directly with no
 * page — a server action is a POST endpoint with a generated name.
 *
 * What is under test: each action refuses anybody without `mirror.manage`; a
 * mirror is reachable only by its owner, because no action takes its id; a
 * token is validated by one read before anything is stored; the token appears
 * in no result and no console line; and a change that landed minus its audit
 * event is a warning on a success, never a failure.
 */

const AUTH_SECRET = "admin-mirror-actions-test-secret";
const TOKEN = "ntn_ACTIONStestToken0123456789abcdef";
const PAGE_ID = "0f5e4a3c-1111-2222-3333-44445555aaaa";
const PAGE_URL = `https://www.notion.so/acme/MakerLab-Tools-mirror-${PAGE_ID.replace(/-/g, "")}`;
const TITLE = "MakerLab Tools — mirror";
const TOOLS_DB = "1a2b3c4d-0000-4000-8000-000000000001";

let db: Db;
let fake: NotionFake;
let consoleLines: string[];

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  resetAuthForTests();
  override.permissions = null;
  audit.failing = false;
  connectThrow.message = null;
  vi.mocked(revalidatePath).mockClear();
  vi.mocked(syncMirrorNow).mockReset();
  vi.mocked(ensureMirrorDatabases).mockReset();
  vi.mocked(applyPastedMapping).mockReset();

  fake = createNotionFake({ token: TOKEN, pages: [{ id: PAGE_ID, title: TITLE }] });
  installNotionFake(server, fake);

  consoleLines = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      consoleLines.push(args.map((arg) => (arg instanceof Error ? `${arg.message}\n${arg.stack}` : String(arg))).join(" "));
    });
  }

  db = await getDb();
  await db.delete(notionMirrors);
  await db.delete(auditEvents);
  await db.delete(session);
  await db.delete(user);
});

afterEach(() => {
  // Whatever a test did, the token never reached the console (§8, §10).
  expect(consoleLines.join("\n")).not.toContain(TOKEN);
  vi.restoreAllMocks();
  override.permissions = null;
  audit.failing = false;
  resetAuthForTests();
});

afterAll(() => {
  resetDbForTests();
});

async function asAdmin(email = `admin-${Math.random().toString(36).slice(2)}@cornell.edu`) {
  const signedIn = await signInAsNew({ email, role: "admin" });
  setMockHeaders({ cookie: signedIn.cookie });
  return signedIn;
}

async function mirrorOf(owner: SignedInSession) {
  const [row] = await db.select().from(notionMirrors).where(eq(notionMirrors.ownerUserId, owner.user.id));
  return row ?? null;
}

/** A connected mirror, written straight to the table. */
async function seedMirror(owner: SignedInSession, mapping: Record<string, string> = { tools: TOOLS_DB }) {
  const { mirror } = await saveMirrorConnection(
    {
      ownerUserId: owner.user.id,
      tokenCiphertext: encryptMirrorToken(TOKEN, AUTH_SECRET),
      parentPageId: PAGE_ID,
      parentPageTitle: TITLE,
    },
    { db }
  );
  if (Object.keys(mapping).length) await setMirrorMapping(mirror.id, mapping, { db });
  return mirror;
}

/** Every action, once, with a well-formed body. */
function everyAction() {
  const body = { token: TOKEN, pageUrl: PAGE_URL };
  return [
    ["testConnection", () => testConnection(body)],
    ["connect", () => connect(body)],
    ["createDatabases", () => createDatabases()],
    ["saveMapping", () => saveMapping({ tools: TOOLS_DB })],
    ["syncNow", () => syncNow()],
    ["setPaused", () => setPaused({ paused: true })],
    ["disconnect", () => disconnect()],
  ] as const;
}

describe("the gate", () => {
  it("refuses an anonymous caller on every action, and touches nothing", async () => {
    setMockHeaders();
    for (const [name, call] of everyAction()) {
      expect(await call(), name).toEqual({ ok: false, error: "not_signed_in" });
    }
    expect(await db.select().from(notionMirrors)).toHaveLength(0);
    expect(fake.requests).toHaveLength(0);
  });

  it("refuses a student on every action", async () => {
    const student = await signInAsNew({ email: "casey@cornell.edu", role: "user" });
    setMockHeaders({ cookie: student.cookie });
    for (const [name, call] of everyAction()) {
      expect(await call(), name).toEqual({ ok: false, error: "not_permitted" });
    }
    expect(await db.select().from(notionMirrors)).toHaveLength(0);
    expect(fake.requests).toHaveLength(0);
  });

  it("checks mirror.manage itself, not some other admin permission", async () => {
    const admin = await asAdmin();
    await seedMirror(admin);

    // An account holding every other admin permission is still refused.
    override.permissions = new Set([
      "tools.edit",
      "tools.publish",
      "tools.approve",
      "users.manage",
      "maintenance.manage",
      "feedback.manage",
      "projects.moderate",
    ]);
    for (const [name, call] of everyAction()) {
      expect(await call(), name).toEqual({ ok: false, error: "not_permitted" });
    }

    override.permissions = new Set(["mirror.manage"]);
    expect(await setPaused({ paused: true })).toEqual({ ok: true });
  });

  it("rate-limits the setup calls that spend the admin's Notion token", async () => {
    await asAdmin();
    for (let i = 0; i < 10; i += 1) {
      expect(await testConnection({ token: TOKEN, pageUrl: PAGE_URL })).toMatchObject({ ok: true });
    }
    expect(await testConnection({ token: TOKEN, pageUrl: PAGE_URL })).toEqual({ ok: false, error: "rate_limited" });
    expect(await connect({ token: TOKEN, pageUrl: PAGE_URL })).toEqual({ ok: false, error: "rate_limited" });
    expect(fake.requests).toHaveLength(10);
  });

  it("refuses a body it does not recognise, including one that names a mirror", async () => {
    await asAdmin();
    expect(await setPaused({ paused: "yes" })).toEqual({ ok: false, error: "invalid_field" });
    expect(await setPaused({ paused: true, mirrorId: crypto.randomUUID() })).toEqual({
      ok: false,
      error: "invalid_field",
    });
    expect(await syncNow({ mirrorId: crypto.randomUUID() })).toEqual({ ok: false, error: "invalid_field" });
    expect(await testConnection("not an object")).toEqual({ ok: false, error: "invalid_field" });
  });
});

describe("Test connection and Connect", () => {
  it("tests the connection, answers the page's title, and stores nothing", async () => {
    const admin = await asAdmin();

    expect(await testConnection({ token: TOKEN, pageUrl: PAGE_URL })).toEqual({
      ok: true,
      pageId: PAGE_ID,
      title: TITLE,
    });
    expect(await mirrorOf(admin)).toBeNull();
    expect(await db.select().from(auditEvents)).toHaveLength(0);
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
  });

  it("connects: the token encrypted, the event recorded with the page id only, the page refreshed", async () => {
    const admin = await asAdmin();

    expect(await connect({ token: TOKEN, pageUrl: PAGE_URL })).toEqual({ ok: true, title: TITLE });

    const row = await mirrorOf(admin);
    expect(row?.parentPageId).toBe(PAGE_ID);
    expect(decryptMirrorToken(row?.tokenCiphertext as Uint8Array, AUTH_SECRET)).toBe(TOKEN);

    const [event] = await db.select().from(auditEvents);
    expect(event).toMatchObject({
      action: "mirror.connected",
      actorUserId: admin.user.id,
      subjectType: "mirror",
      subjectId: row?.id,
      detail: { parentPageId: PAGE_ID },
    });
    expect(JSON.stringify(event)).not.toContain(TOKEN);
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/admin/mirror");
  });

  it("stores nothing and records nothing when the read fails", async () => {
    const admin = await asAdmin();

    expect(await connect({ token: `${TOKEN}WRONG`, pageUrl: PAGE_URL })).toEqual({
      ok: false,
      error: "unauthorized",
    });
    expect(await connect({ token: TOKEN, pageUrl: crypto.randomUUID() })).toEqual({
      ok: false,
      error: "page_not_found",
    });
    expect(await connect({ token: "short", pageUrl: PAGE_URL })).toEqual({ ok: false, error: "invalid_token" });
    expect(await connect({ token: TOKEN, pageUrl: "https://example.com/" })).toEqual({
      ok: false,
      error: "invalid_page",
    });

    expect(await mirrorOf(admin)).toBeNull();
    expect(await db.select().from(auditEvents)).toHaveLength(0);
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
  });

  it("keeps the connection and warns when the audit event cannot be written", async () => {
    const admin = await asAdmin();
    audit.failing = true;

    expect(await connect({ token: TOKEN, pageUrl: PAGE_URL })).toEqual({
      ok: true,
      title: TITLE,
      warning: "audit_unavailable",
    });
    expect(await mirrorOf(admin)).not.toBeNull();
  });

  it("puts the token in no result, and scrubs it from the line a thrown error leaves", async () => {
    await asAdmin();

    const results = [
      await testConnection({ token: TOKEN, pageUrl: PAGE_URL }),
      await testConnection({ token: `${TOKEN}WRONG`, pageUrl: PAGE_URL }),
      await connect({ token: TOKEN, pageUrl: crypto.randomUUID() }),
      await connect({ token: TOKEN, pageUrl: PAGE_URL }),
    ];
    for (const result of results) expect(JSON.stringify(result)).not.toContain(TOKEN);

    connectThrow.message = `boom while holding ${TOKEN} for casey@cornell.edu`;
    expect(await connect({ token: TOKEN, pageUrl: PAGE_URL })).toEqual({ ok: false, error: "failed" });
    const logged = consoleLines.join("\n");
    expect(logged).toContain("[admin/mirror] the action failed");
    expect(logged).not.toContain("casey@cornell.edu");
    expect(logged).not.toContain(AUTH_SECRET);
    // `afterEach` asserts the token itself is absent.
  });

  it("connects nothing when AUTH_SECRET is unset", async () => {
    const admin = await asAdmin();
    vi.stubEnv("AUTH_SECRET", "");
    // Sessions are signed with the same secret the token key is derived from,
    // so with it gone nobody is signed in and the gate refuses first.
    // `connectMirror`'s own `key_unavailable` is covered in lib/mirror/connect.test.ts.
    expect(await connect({ token: TOKEN, pageUrl: PAGE_URL })).toEqual({ ok: false, error: "not_signed_in" });
    expect(await mirrorOf(admin)).toBeNull();
  });
});

describe("one admin cannot reach another's mirror", () => {
  it("answers not_connected to admin B for everything, and admin A's mirror is untouched", async () => {
    const adminA = await asAdmin("isaac@cornell.edu");
    const mirrorA = await seedMirror(adminA);
    const before = await mirrorOf(adminA);

    await asAdmin("niti@cornell.edu");
    vi.mocked(syncMirrorNow).mockResolvedValue({ ok: false, code: "not_connected" });

    expect(await createDatabases()).toEqual({ ok: false, error: "not_connected" });
    expect(await saveMapping({ tools: TOOLS_DB })).toEqual({ ok: false, error: "not_connected" });
    expect(await syncNow()).toEqual({ ok: false, error: "not_connected" });
    expect(await setPaused({ paused: true })).toEqual({ ok: false, error: "not_connected" });
    expect(await disconnect()).toEqual({ ok: false, error: "not_connected" });

    expect(vi.mocked(ensureMirrorDatabases)).not.toHaveBeenCalled();
    expect(vi.mocked(applyPastedMapping)).not.toHaveBeenCalled();
    expect(vi.mocked(syncMirrorNow)).not.toHaveBeenCalled();

    const after = await mirrorOf(adminA);
    expect(after?.pausedAt).toBeNull();
    expect(after?.tokenCiphertext).toEqual(before?.tokenCiphertext);
    expect(after?.mapping).toEqual({ tools: TOOLS_DB });
    expect(after?.id).toBe(mirrorA.id);
  });

  it("gives admin B a mirror of B's own when B connects", async () => {
    const adminA = await asAdmin("isaac@cornell.edu");
    const mirrorA = await seedMirror(adminA);

    const adminB = await asAdmin("niti@cornell.edu");
    expect(await connect({ token: TOKEN, pageUrl: PAGE_URL })).toMatchObject({ ok: true });

    const mirrorB = await mirrorOf(adminB);
    expect(mirrorB?.id).not.toBe(mirrorA.id);
    expect(mirrorB?.mapping).toEqual({});
    expect((await mirrorOf(adminA))?.mapping).toEqual({ tools: TOOLS_DB });
  });
});

describe("Create databases and the pasted mapping", () => {
  it("creates databases for the caller's own mirror and says which", async () => {
    const admin = await asAdmin();
    const mirror = await seedMirror(admin, {});
    vi.mocked(ensureMirrorDatabases).mockResolvedValue({
      ok: true,
      created: ["categories", "tools"],
      kept: [],
      mapping: {},
    });

    expect(await createDatabases()).toEqual({ ok: true, created: ["categories", "tools"], kept: [] });
    expect(vi.mocked(ensureMirrorDatabases)).toHaveBeenCalledWith(mirror.id);
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/admin/mirror");
  });

  it("reports a create that stopped part-way, and refreshes the page because it still made some", async () => {
    const admin = await asAdmin();
    await seedMirror(admin, {});
    vi.mocked(ensureMirrorDatabases).mockResolvedValue({
      ok: false,
      code: "notion_unavailable",
      created: ["categories"],
      entity: "locations",
    });

    expect(await createDatabases()).toEqual({
      ok: false,
      error: "notion_unavailable",
      created: ["categories"],
      entity: "locations",
    });
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/admin/mirror");
  });

  it("refuses without a token, and never asks Notion", async () => {
    const admin = await asAdmin();
    await seedMirror(admin);
    await disconnect();

    expect(await createDatabases()).toEqual({ ok: false, error: "not_connected" });
    expect(await saveMapping({ tools: TOOLS_DB })).toEqual({ ok: false, error: "not_connected" });
    expect(vi.mocked(ensureMirrorDatabases)).not.toHaveBeenCalled();
    expect(vi.mocked(applyPastedMapping)).not.toHaveBeenCalled();
  });

  it("turns pasted URLs into ids before checking them, and sends only what was pasted", async () => {
    const admin = await asAdmin();
    const mirror = await seedMirror(admin, {});
    vi.mocked(applyPastedMapping).mockResolvedValue({ ok: true, mapping: { tools: TOOLS_DB } });

    expect(
      await saveMapping({ tools: `https://www.notion.so/acme/${TOOLS_DB.replace(/-/g, "")}?v=abc`, units: "  " })
    ).toEqual({ ok: true });
    expect(vi.mocked(applyPastedMapping)).toHaveBeenCalledWith(mirror.id, { tools: TOOLS_DB });
  });

  it("refuses a paste that is not a database id without asking Notion", async () => {
    const admin = await asAdmin();
    await seedMirror(admin, {});

    expect(await saveMapping({ tools: "not an id", units: TOOLS_DB })).toEqual({
      ok: false,
      error: "invalid_database_id",
      problems: [{ entity: "tools", code: "invalid_database_id" }],
    });
    expect(await saveMapping({})).toEqual({ ok: false, error: "invalid_database_id", problems: [] });
    expect(await saveMapping({ widgets: TOOLS_DB })).toEqual({ ok: false, error: "invalid_field" });
    expect(vi.mocked(applyPastedMapping)).not.toHaveBeenCalled();
  });

  it("passes the per-entity problems through, and refreshes nothing", async () => {
    const admin = await asAdmin();
    await seedMirror(admin, {});
    const problems = [{ entity: "tools" as const, code: "schema_mismatch" as const, missing: ["Published"] }];
    vi.mocked(applyPastedMapping).mockResolvedValue({ ok: false, code: "schema_mismatch", problems });

    expect(await saveMapping({ tools: TOOLS_DB })).toEqual({ ok: false, error: "schema_mismatch", problems });
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
  });
});

describe("Sync now, Pause and Disconnect", () => {
  it("syncs the caller's own mirror", async () => {
    const admin = await asAdmin();
    await seedMirror(admin);
    vi.mocked(syncMirrorNow).mockResolvedValue({ ok: true });

    expect(await syncNow()).toEqual({ ok: true });
    expect(vi.mocked(syncMirrorNow)).toHaveBeenCalledWith(admin.user.id);
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/admin/mirror");
  });

  it("passes the 15-minute refusal through, with the time left", async () => {
    const admin = await asAdmin();
    await seedMirror(admin);
    vi.mocked(syncMirrorNow).mockResolvedValue({ ok: false, code: "sync_too_soon", retryAfterSeconds: 540 });

    expect(await syncNow()).toEqual({ ok: false, error: "sync_too_soon", retryAfterSeconds: 540 });
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
  });

  it("passes a failed start through as start_failed", async () => {
    const admin = await asAdmin();
    await seedMirror(admin);
    vi.mocked(syncMirrorNow).mockResolvedValue({ ok: false, code: "start_failed" });
    expect(await syncNow()).toEqual({ ok: false, error: "start_failed" });
  });

  it("pauses and resumes the caller's mirror", async () => {
    const admin = await asAdmin();
    await seedMirror(admin);

    expect(await setPaused({ paused: true })).toEqual({ ok: true });
    expect((await mirrorOf(admin))?.pausedAt).toBeInstanceOf(Date);
    expect(await setPaused({ paused: false })).toEqual({ ok: true });
    expect((await mirrorOf(admin))?.pausedAt).toBeNull();
  });

  it("disconnects: forgets the token, keeps the mapping, records the event", async () => {
    const admin = await asAdmin();
    const mirror = await seedMirror(admin);

    expect(await disconnect()).toEqual({ ok: true });

    const row = await mirrorOf(admin);
    expect(row?.tokenCiphertext).toBeNull();
    expect(row?.mapping).toEqual({ tools: TOOLS_DB });
    const [event] = await db.select().from(auditEvents);
    expect(event).toMatchObject({
      action: "mirror.disconnected",
      actorUserId: admin.user.id,
      subjectType: "mirror",
      subjectId: mirror.id,
    });

    // Nothing is left to disconnect.
    expect(await disconnect()).toEqual({ ok: false, error: "not_connected" });
  });

  it("keeps the disconnect and warns when the audit event cannot be written", async () => {
    const admin = await asAdmin();
    await seedMirror(admin);
    audit.failing = true;

    expect(await disconnect()).toEqual({ ok: true, warning: "audit_unavailable" });
    expect((await mirrorOf(admin))?.tokenCiphertext).toBeNull();
  });
});

// @vitest-environment node
import { eq } from "drizzle-orm";
import { server } from "../../../test/msw/server";
// Aliased: the name starts with `use`, which eslint's rules-of-hooks reads as a React hook.
import { useNotionFake as installNotionFake } from "../../../test/msw/notion-mirror";
import { createNotionFake, type NotionFake } from "../../../test/fakes/notion-fake";
import { createPgliteDb } from "../db/pglite";
import { notionMirrors, user } from "../db/schema/index";
import type { Db } from "../db/types";
import { connectMirror, testMirrorConnection } from "./connect";
import { decryptMirrorToken } from "./token-crypto";

/**
 * Connecting a mirror against the fake Notion (spec §3.8 "Connect", §8).
 *
 * Two promises are under test. A token is validated by one read before it is
 * stored — so every failure leaves `notion_mirrors` exactly as it was. And the
 * token goes nowhere it was not sent: not into a result, not into an error,
 * not into a console line.
 */

const TOKEN = "ntn_CONNECTtestToken0123456789abcdef";
const SECRET = "connect-test-auth-secret";
const PAGE_ID = "0f5e4a3c-1111-2222-3333-44445555aaaa";
const PAGE_URL = `https://www.notion.so/acme/MakerLab-Tools-mirror-${PAGE_ID.replace(/-/g, "")}?pvs=4`;
const TITLE = "MakerLab Tools — mirror";

let db: Db;
let fake: NotionFake;
let consoleLines: string[];

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", SECRET);
  fake = createNotionFake({ token: TOKEN, pages: [{ id: PAGE_ID, title: TITLE }] });
  installNotionFake(server, fake);

  consoleLines = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      consoleLines.push(args.map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack}` : String(arg))).join(" "));
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  // The token never reaches the console, whatever the test did.
  expect(consoleLines.join("\n")).not.toContain(TOKEN);
});

async function insertUser(): Promise<string> {
  const id = `u-${Math.random().toString(36).slice(2)}`;
  await db.insert(user).values({ id, name: "Mirror Owner", email: `${id}@cornell.edu`, role: "admin" });
  return id;
}

async function mirrorRows(owner: string) {
  return db.select().from(notionMirrors).where(eq(notionMirrors.ownerUserId, owner));
}

describe("testMirrorConnection", () => {
  it("reads the page and answers its id and title", async () => {
    const result = await testMirrorConnection(TOKEN, PAGE_URL);
    expect(result).toEqual({ ok: true, pageId: PAGE_ID, title: TITLE });
    expect(fake.requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      `GET /pages/${PAGE_ID}`,
    ]);
  });

  it("accepts a bare id and a pasted token with stray whitespace around it", async () => {
    expect(await testMirrorConnection(`  ${TOKEN}\n`, PAGE_ID.replace(/-/g, ""))).toMatchObject({ ok: true });
  });

  it("refuses a token that is not token-shaped without calling Notion", async () => {
    for (const bad of ["", "short", "ntn_has a space inside it 0123", "x".repeat(201), 42, null]) {
      expect(await testMirrorConnection(bad, PAGE_URL)).toEqual({ ok: false, code: "invalid_token" });
    }
    expect(fake.requests).toHaveLength(0);
  });

  it("refuses a page reference with no Notion id in it", async () => {
    for (const bad of ["", "https://example.com/page", "not a url", "https://www.notion.so/acme/No-id-here"]) {
      expect(await testMirrorConnection(TOKEN, bad)).toEqual({ ok: false, code: "invalid_page" });
    }
    expect(fake.requests).toHaveLength(0);
  });

  it("maps a wrong token to unauthorized", async () => {
    expect(await testMirrorConnection(`${TOKEN}WRONG`, PAGE_URL)).toEqual({ ok: false, code: "unauthorized" });
  });

  it("maps an unshared or missing page to page_not_found", async () => {
    expect(await testMirrorConnection(TOKEN, crypto.randomUUID())).toEqual({ ok: false, code: "page_not_found" });

    fake.failNext({ method: "GET" }, { status: 403, code: "restricted_resource" });
    expect(await testMirrorConnection(TOKEN, PAGE_URL)).toEqual({ ok: false, code: "page_not_found" });
  });

  it("maps Notion being down to notion_unavailable", async () => {
    fake.failNext({ method: "GET" }, { status: 503, code: "service_unavailable" });
    expect(await testMirrorConnection(TOKEN, PAGE_URL)).toEqual({ ok: false, code: "notion_unavailable" });
  });

  it("never carries the token in a result", async () => {
    const results = [
      await testMirrorConnection(TOKEN, PAGE_URL),
      await testMirrorConnection(TOKEN, crypto.randomUUID()),
      await testMirrorConnection(`${TOKEN}WRONG`, PAGE_URL),
    ];
    expect(JSON.stringify(results)).not.toContain(TOKEN);
  });
});

describe("connectMirror", () => {
  it("stores the page, its title and the token encrypted — never in plain text", async () => {
    const owner = await insertUser();
    const result = await connectMirror(owner, TOKEN, PAGE_URL, { db });

    expect(result).toMatchObject({ ok: true, created: true, pageId: PAGE_ID, title: TITLE });
    expect(JSON.stringify(result)).not.toContain(TOKEN);

    const [row] = await mirrorRows(owner);
    expect(row.parentPageId).toBe(PAGE_ID);
    expect(row.parentPageTitle).toBe(TITLE);
    expect(row.tokenCiphertext).not.toBeNull();
    expect(Buffer.from(row.tokenCiphertext as Uint8Array).toString("utf8")).not.toContain(TOKEN);
    expect(decryptMirrorToken(row.tokenCiphertext as Uint8Array)).toBe(TOKEN);
  });

  it("reconnects in place, keeping the mirror's id", async () => {
    const owner = await insertUser();
    const first = await connectMirror(owner, TOKEN, PAGE_URL, { db });
    const second = await connectMirror(owner, TOKEN, PAGE_ID, { db });
    expect(second).toMatchObject({ ok: true, created: false });
    if (!first.ok || !second.ok) throw new Error("expected both to connect");
    expect(second.mirror.id).toBe(first.mirror.id);
    expect(await mirrorRows(owner)).toHaveLength(1);
  });

  it("stores nothing when the read fails, whatever the reason", async () => {
    const owner = await insertUser();

    expect(await connectMirror(owner, "short", PAGE_URL, { db })).toEqual({ ok: false, code: "invalid_token" });
    expect(await connectMirror(owner, TOKEN, "https://example.com", { db })).toEqual({
      ok: false,
      code: "invalid_page",
    });
    expect(await connectMirror(owner, `${TOKEN}WRONG`, PAGE_URL, { db })).toEqual({
      ok: false,
      code: "unauthorized",
    });
    expect(await connectMirror(owner, TOKEN, crypto.randomUUID(), { db })).toEqual({
      ok: false,
      code: "page_not_found",
    });
    fake.failNext({ method: "GET" }, { status: 500 });
    expect(await connectMirror(owner, TOKEN, PAGE_URL, { db })).toEqual({ ok: false, code: "notion_unavailable" });

    expect(await mirrorRows(owner)).toHaveLength(0);
  });

  it("does not replace a working token with one that fails its read", async () => {
    const owner = await insertUser();
    await connectMirror(owner, TOKEN, PAGE_URL, { db });
    const [before] = await mirrorRows(owner);

    expect(await connectMirror(owner, `${TOKEN}WRONG`, PAGE_URL, { db })).toEqual({
      ok: false,
      code: "unauthorized",
    });
    const [after] = await mirrorRows(owner);
    expect(Buffer.from(after.tokenCiphertext as Uint8Array)).toEqual(Buffer.from(before.tokenCiphertext as Uint8Array));
  });

  it("refuses with key_unavailable, and stores nothing, when AUTH_SECRET is unset", async () => {
    vi.stubEnv("AUTH_SECRET", "");
    const owner = await insertUser();
    expect(await connectMirror(owner, TOKEN, PAGE_URL, { db })).toEqual({ ok: false, code: "key_unavailable" });
    expect(await mirrorRows(owner)).toHaveLength(0);
  });
});

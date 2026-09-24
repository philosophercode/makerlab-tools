# v5 Test Harness

Shared tooling every test in `v5/` builds on. **Don't edit `package.json` or run
`npm install`** — the foundation already wired the deps and scripts. Just add
your `*.test.ts(x)` files and import from here.

## Layout

| Path | What it is |
|---|---|
| `vitest.config.ts` | jsdom env, `@/`→`src/`, `server-only`→stub, globals on, `e2e/` excluded |
| `vitest.setup.ts` | jest-dom matchers, MSW lifecycle, per-test env/mocks cleanup |
| `test/msw/server.ts` | the MSW node `server` (lifecycle managed in setup) |
| `test/msw/handlers.ts` | default Notion + Upstash handlers, `DB_IDS` sentinels |
| `test/fixtures/notion.ts` | raw `NotionPage` fixtures + `notionQueryResponse(...)` |
| `test/fixtures/catalog.ts` | resolved `MakerLabTool` / `MakerLabUnit` objects |
| `test/mocks/next-cache.ts` | `nextCacheMock()` factory for `vi.mock("next/cache", …)` |
| `test/mocks/server-only.ts` | empty stub aliased for `import "server-only"` |
| `test/utils/render.tsx` | RTL `render` wrapped in `NextIntlClientProvider` + `userEvent` |
| `test/utils/session.ts` | `seedUser` / `signInAs` — be somebody, with no Google (see below) |
| `test/utils/better-auth-cookie.ts` | Just the cookie format, import-free, so Playwright can use it too |
| `playwright.config.ts` | E2E config; dev server boots with `DATABASE_URL` unset (PGlite demo seed) |

## Scripts

```bash
npm test            # vitest run (one-shot)
npm run test:watch  # vitest (watch)
npm run test:coverage
npm run test:e2e    # playwright (run `npx playwright install chromium` first, once)
npm run test:e2e:ui
```

`describe` / `it` / `expect` / `vi` and the lifecycle hooks are **globals** —
no imports needed. Types come from `test/vitest.d.ts`.

## Import paths (copy these)

```ts
import { server } from "../../test/msw/server";          // adjust depth to your file
import { handlers, DB_IDS } from "../../test/msw/handlers";
import { http, HttpResponse } from "msw";                // for server.use(...) overrides

import {
  toolsPage, categoriesPage, locationsPage, unitsPage,
  resourcesPage, maintenanceLogsPage, pagesById,
  notionQueryResponse, STALE_IMAGE_URL, FRESH_IMAGE_URL,
} from "../../test/fixtures/notion";

import {
  availableTool, inUseTool, offlineTool, toolWithLinks, mockCatalog,
} from "../../test/fixtures/catalog";

import { nextCacheMock } from "../../test/mocks/next-cache";
import { render, screen, userEvent } from "../../test/utils/render";
```

> Relative depth varies: from `src/lib/*.test.ts` use `../../test/...`; from
> `src/components/*.test.tsx` use `../../test/...`; from
> `src/app/api/**/route.test.ts` go up to the v5 root then into `test/`.

---

## The PGlite rule (read this first)

Catalogue reads run against Postgres, and the test suite never needs Notion
env for them. `getCatalogTools()` / `getCatalogTool(id)` read from **PGlite**
— an in-process Postgres, migrated and seeded with demo data (two tools:
`form-4`, `trotec-speedy-400`) — whenever `DATABASE_URL` is unset, which is
the default in every test. No MSW, no `vi.stubEnv` for Notion, no network.

- **The seeded demo database** (most catalogue tests): leave `DATABASE_URL`
  unset and call `getDb()` from `../../src/lib/db/client` — it lazily creates
  and memoises one PGlite instance per test file. Put `resetDbForTests()` in
  an `afterEach` if a test stubs `DATABASE_URL` to something else.
- **An isolated database** (schema tests, or a test that needs to seed its own
  rows without touching the shared demo data): call `createPgliteDb()` from
  `../../src/lib/db/pglite` directly — it returns a fresh, empty (or
  custom-seeded via its `seed` option) instance, migrated the same way Neon
  is.
- **`// @vitest-environment node` is required** at the top of any file that
  creates or touches a PGlite database — jsdom (the suite's default
  environment) doesn't have what PGlite's WASM build needs.

```ts
// @vitest-environment node
import { createPgliteDb } from "../../src/lib/db/pglite";
import type { Db } from "../../src/lib/db/types";

let db: Db;

beforeAll(async () => {
  db = await createPgliteDb();
});
```

```ts
// @vitest-environment node
import { getDb, resetDbForTests } from "../../src/lib/db/client";

afterEach(() => {
  resetDbForTests();
});

it("reads the seeded demo tools", async () => {
  vi.stubEnv("DATABASE_URL", "");
  const db = await getDb();
  // ...
});
```

`vi.unstubAllEnvs()` runs automatically after every test (setup file).

**Writes are on Postgres as of Phase 3** — maintenance tickets, corrections and
project submissions all write to the same PGlite database the reads come from,
so their tests stub **no Notion environment at all**. Assert by reading the row
back (`db.select().from(maintenanceLogs)`), not by inspecting a request body.

The only write still on Notion is intake's `create_tool` (Phase 6), which is
captured at the module boundary rather than over MSW — see the `vi.mock("../notion", …)`
block at the top of `src/lib/capabilities/intake.test.ts`.

**Vercel Blob is never called for real.** Its SDK talks to a signed API and
would need a token, so it is mocked at the seam `src/lib/blob.ts` exists to
provide. Copy this from `src/app/api/uploads/route.test.ts`:

```ts
const blob = vi.hoisted(() => ({
  configured: { value: true },
  put: vi.fn(),
  putUpload: vi.fn(),
  list: vi.fn(),
  del: vi.fn(),
}));

vi.mock("../../../lib/blob", () => ({
  isBlobConfigured: () => blob.configured.value,
  getBlobStore: () => ({ ...blob }),
}));
```

Set `blob.configured.value = false` to test the unconfigured path — the one that
has to refuse rather than invent an attachment id.

---

## Being signed in, without Google

Sessions are **database rows** as of Phase 4: the cookie carries only a token,
and every request looks the session and its user up. So a test does not need an
OAuth handshake to be somebody — it needs a `user` row, a `session` row, and a
cookie signed the way Better Auth signs one. That is `test/utils/session.ts`.

```ts
// @vitest-environment node          // it touches PGlite
import { resetAuthForTests } from "@/lib/auth/config";
import { seedUser, signInAs, signInAsNew } from "../../test/utils/session";

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", "whatever-this-file-wants");  // signs the cookie
  resetAuthForTests();                                     // drop the memoised instance
});

it("lets an admin refresh the catalogue", async () => {
  const { cookie } = await signInAsNew({ role: "admin" });
  const res = await POST(requestWith(cookie));
  expect(res.status).toBe(200);
});
```

- `seedUser({ id?, email?, name?, role?, banned? })` inserts the `user` row and
  returns it. `role` is one of `user | admin | super_admin`.
- `signInAs(person, { expiresInSeconds?, secret? })` inserts the `session` row
  and returns `{ user, token, cookie }`. `expiresInSeconds: -60` gives an
  expired session; `secret: "wrong"` gives a forged cookie. Both resolve to
  anonymous, which is the point.
- `signInAsNew(seedOptions, signInOptions)` does both in one call.
- `insertUserRow(db, options)` is the same seed against a handle you already
  hold — for the `src/lib/data/*` tests, which each run their own isolated
  `createPgliteDb()`.

**`AUTH_SECRET` must be stubbed before `signInAs`**, and `resetAuthForTests()`
belongs in `beforeEach`/`afterEach` of any file that stubs it: `getAuth()`
memoises the instance per env fingerprint plus substrate, and a stale one points
at the previous database.

**`created_by` references `user.id` since Phase 4.** A write whose author is not
a row is refused by the foreign key — which is correct, because in production
that id comes from a session. If a data test asserts on a specific author id,
seed it: `await insertUserRow(db, { id: "google-sub-1", email: "ada@cornell.edu" })`.

The old `makerlab.identity` cookie and `src/lib/auth/session-cookie.ts` are
retired. Do not mint one; nothing reads it.

**E2E** is the same idea one level out. `playwright.config.ts` boots the server
with a test-only `AUTH_SECRET` and blank `GOOGLE_*`, the demo seed ships one
account per role with a constant session token (`DEMO_ACCOUNTS` in
`src/lib/db/demo-seed.ts`), and `e2e/utils/session.ts`'s `signIn(context,
account, baseURL)` puts a properly signed cookie in the browser. Nothing is
intercepted — the real `/api/identity` reads the real row. See
`e2e/auth.spec.ts` and `e2e/admin-users.spec.ts`.

`DEMO_ACCOUNTS.promotable` exists for the one E2E that *changes* a role. The
suite runs its files in parallel against a single server, so a test that mutates
a shared row must mutate one nobody else asserts on — promoting
`DEMO_ACCOUNTS.user` would race `auth.spec.ts`.

## Server components and server actions

`resolveIdentityFromHeaders()` and the `/admin` server actions read the request
through `next/headers`, which only exists inside a Next request scope. Stub it
with `test/mocks/next-headers.ts`, and point it at a cookie `session.ts` minted:

```ts
// @vitest-environment node
import { nextCacheMock } from "../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());      // revalidatePath/Tag
vi.mock("next/headers", () => nextHeadersMock());

const { cookie } = await signInAsNew({ role: "super_admin" });
setMockHeaders({ cookie });                         // …or setMockHeaders() for anonymous
expect(await setUserRole({ userId, role: "admin" })).toEqual({ ok: true, role: "admin" });
```

The mutable state lives in the mock module rather than the test, because
`vi.mock`'s factory is hoisted above your imports and may not close over
anything. `setMockHeaders({ "x-forwarded-for": "198.51.100.7" })` gives an
anonymous caller their own rate-limit bucket — the limiter is a per-process
singleton, so a test that exhausts a window needs a key no other test shares.

---

## Env stubbing for module-load-time reads

`site-config.ts` reads `process.env.NEXT_PUBLIC_*` / `AUDIENCE` **at module
load**, and `rate-limit.ts` computes `useUpstash` from `UPSTASH_*` **at module
load**. `vi.stubEnv` after the module is already imported won't change those
captured values. Pattern: stub → `resetModules` → dynamic `import()`.

```ts
it("honors NEXT_PUBLIC_SITE_NAME override", async () => {
  vi.stubEnv("NEXT_PUBLIC_SITE_NAME", "Acme Lab");
  vi.resetModules();                                   // drop the cached module
  const { siteConfig } = await import("@/lib/site-config");
  expect(siteConfig.name).toBe("Acme Lab");
});
```

Same for the Upstash branch of the rate limiter:

```ts
it("uses the Upstash path when configured", async () => {
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example.com");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "tok");
  vi.resetModules();
  const { rateLimitAsync } = await import("@/lib/rate-limit");
  // MSW already mocks POST */pipeline → [{result:1},{result:1}] (allowed).
  const r = await rateLimitAsync("k", { limit: 5, windowMs: 1000 });
  expect(r.allowed).toBe(true);
});
```

> The in-memory limiter is a per-process singleton `Map`. Use distinct keys per
> test, or `vi.resetModules()` + re-import to get a fresh window.

---

## MSW `server.use(...)` override pattern

Defaults live in `handlers.ts`. Override per-test; the `afterEach` resets them.

```ts
import { server } from "../../test/msw/server";
import { http, HttpResponse } from "msw";
import { notionQueryResponse, toolsPage } from "../../test/fixtures/notion";

it("follows next_cursor pagination", async () => {
  let call = 0;
  server.use(
    http.post("https://api.notion.com/v1/databases/:id/query", () => {
      call += 1;
      return call === 1
        ? HttpResponse.json(notionQueryResponse([toolsPage], { hasMore: true, nextCursor: "c2" }))
        : HttpResponse.json(notionQueryResponse([toolsPage]));
    })
  );
  // ... call into notion.ts and assert both pages were collected
});
```

To simulate a 429 retry, a 500, or an Upstash fail-open, override the relevant
handler the same way (return `HttpResponse.json(..., { status })` or set
`Retry-After`). Unhandled outbound requests **fail the test** by design
(`onUnhandledRequest: "error"`).

---

## `vi.mock("next/cache")` pattern

`catalog.ts` imports `cacheTag`/`cacheLife`; `admin/revalidate/route.ts` imports
`revalidateTag`. Mock them with the factory:

```ts
import { nextCacheMock } from "../../test/mocks/next-cache";

vi.mock("next/cache", () => nextCacheMock());

// later, assert it was called:
import { revalidateTag } from "next/cache";
expect(vi.mocked(revalidateTag)).toHaveBeenCalledWith("catalog");
```

**Hoisting caveat:** `vi.mock(...)` is hoisted above your imports, so the
factory must not close over local module variables. Calling `nextCacheMock()`
inline (as above) is safe — its import is hoisted alongside the mock. The
`"use cache"` directive string in `catalog.ts` is harmless under esbuild.

---

## streamText-capture pattern (chat route) — VERIFIED

The chat route's tool `execute` fns are defined inline inside `POST` and the
helpers are module-private. Don't unit-test them directly — instead **mock
`ai`'s `streamText`** to capture the `{ system, messages, tools }` it receives,
then call `POST(req)` and assert on the captured args. You can invoke the
captured `tools.*.execute(...)` directly. Also mock `@ai-sdk/anthropic`
(`anthropic` model factory + `anthropic.tools.webFetch_20250910`).

This exact snippet was run against the real route and passes:

```ts
const captured: { args?: any } = {};

vi.mock("@ai-sdk/anthropic", () => {
  const anthropic = Object.assign(
    vi.fn(() => ({ modelId: "mock-model" })),
    { tools: { webFetch_20250910: vi.fn(() => ({ type: "web_fetch_mock" })) } }
  );
  return { anthropic };
});

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual, // keep convertToModelMessages, createUIMessageStream, tool, stepCountIs, ...
    streamText: vi.fn((args: unknown) => {
      captured.args = args;
      return {
        toUIMessageStream: () =>
          new ReadableStream({ start(c) { c.close(); } }),
      };
    }),
  };
});

import { POST } from "@/app/api/chat/route";

it("wires system + tools and runs a captured tool.execute", async () => {
  const req = new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4" },
    body: JSON.stringify({
      messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "hi" }] }],
    }),
  });

  const res = await POST(req);
  expect(res).toBeInstanceOf(Response);

  expect(typeof captured.args.system).toBe("string");
  expect(captured.args.tools).toHaveProperty("get_unit_details");
  expect(captured.args.tools).toHaveProperty("report_issue");
  expect(captured.args.tools).toHaveProperty("web_fetch");

  // Invoke a tool.execute directly (PGlite demo seed — DATABASE_URL unset):
  const miss = await captured.args.tools.get_unit_details.execute({
    unit_label: "no-such-unit",
  });
  expect(miss.found).toBe(false);
});
```

Notes:
- Spread `...actual` so the route's other `ai` imports (`convertToModelMessages`,
  `createUIMessageStream`, `createUIMessageStreamResponse`, `tool`,
  `stepCountIs`) still work — only `streamText` is replaced.
- The route rate-limits **before** parsing. To assert the 429 path, drive the
  in-memory limiter over its limit (21 calls in a window) or stub Upstash +
  override the `*/pipeline` handler to return a count over the limit.
- To test `report_issue.execute` filing a ticket, set nothing: the write lands
  in the same PGlite database (`DATABASE_URL` unset). Assert
  `result.success === true`, then read the `maintenance_logs` row back by
  `result.ticket_id`.
- For `get_unit_details` against the **PGlite demo seed** (`DATABASE_URL`
  unset), the catalog units are `Form 4 // A` and `Trotec Speedy 400`.

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
| `playwright.config.ts` | E2E config; dev server boots with Notion env unset |

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

## The mock-catalog fallback rule (read this first)

`getCatalogTools()` / `getCatalogTool(id)` return the built-in mock catalog when
`hasNotionCatalogEnv()` is false — i.e. **any** of the 8 Notion env vars
(`NOTION_API_KEY` + the 7 `NOTION_DB_*`) is missing — **and** on any thrown
error during the Notion fetch.

- **Mock path** (default in tests): leave Notion env unset. Catalog comes from
  `src/components/mock-catalog.ts`. No MSW needed.
- **Real Notion path**: `vi.stubEnv` all 8 vars (set the `NOTION_DB_*` ones to
  the `DB_IDS` sentinels so the default handlers route correctly), then let MSW
  serve `api.notion.com`.

```ts
import { DB_IDS } from "../../test/msw/handlers";

function stubNotionEnv() {
  vi.stubEnv("NOTION_API_KEY", "secret_test");
  vi.stubEnv("NOTION_DB_TOOLS", DB_IDS.tools);
  vi.stubEnv("NOTION_DB_CATEGORIES", DB_IDS.categories);
  vi.stubEnv("NOTION_DB_LOCATIONS", DB_IDS.locations);
  vi.stubEnv("NOTION_DB_UNITS", DB_IDS.units);
  vi.stubEnv("NOTION_DB_RESOURCES", DB_IDS.resources);
  vi.stubEnv("NOTION_DB_MAINTENANCE_LOGS", DB_IDS.maintenance_logs);
  vi.stubEnv("NOTION_DB_FLAGS", DB_IDS.flags);
}
```

`vi.unstubAllEnvs()` runs automatically after every test (setup file).

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

  // Invoke a tool.execute directly (mock-catalog path — no Notion env):
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
- To test `report_issue.execute` filing a ticket, stub the Notion env and let
  MSW's `POST /pages` handler respond (returns `id: "created-page-1"`), then
  assert `result.success === true` and `result.ticket_id`.
- For `get_unit_details` / `report_issue` against the **mock catalog** (no env),
  the catalog units come from `mock-catalog.ts` (`Form 4 // A`, `Trotec Speedy 400`).

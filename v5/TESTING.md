# Testing — v5

Practical runbook for the v5 test suite. For the full design rationale and the
per-file coverage matrix, see the design doc:
[`docs/specs/2026-05-29-v5-test-suite-design.md`](../docs/specs/2026-05-29-v5-test-suite-design.md)
(repo root). For harness internals (fixtures, mocks, render helper, the exact
import paths), see [`test/README.md`](./test/README.md).

## Overview

The suite has four layers, all **fully mocked — no live services**. Tests never
hit Postgres, Notion, the Vercel AI Gateway, or Upstash; there are no API keys
and no network cost. Everything is deterministic and offline.

| Layer | What | Where it lives | Runner |
|---|---|---|---|
| Unit | `src/lib`, `src/i18n` pure logic | colocated `*.test.ts` next to source | Vitest |
| Integration | API routes (`/api/*`) with HTTP + module mocks | colocated `route.test.ts` next to the route | Vitest |
| Component | React UI via React Testing Library | colocated `*.test.tsx` next to the component | Vitest |
| E2E | Full app against the PGlite demo catalog | `e2e/*.spec.ts` | Playwright |

Shared infra lives in `test/` (MSW server + handlers, fixtures, mocks, the RTL
`render` helper). Tests import from there; **don't edit `package.json` or run
`npm install`** — the harness deps and scripts are already wired.

## How to run

```bash
npm run test:all    # everything: lint + typecheck + vitest + playwright (one command)
npm test            # vitest run — one-shot, runs unit + integration + component
npm run test:watch  # vitest watch mode
npm run test:coverage   # vitest run --coverage (v8 reporter: text + html)
npm run test:e2e    # playwright test (E2E)
npm run test:e2e:ui # playwright test --ui (interactive)
```

**Prerequisite for E2E:** run this **once** before your first `npm run test:e2e`
— the harness installs `@playwright/test` but not the browser binary:

```bash
npx playwright install chromium
```

Playwright boots its own dev server (see E2E notes below), so no separate
`npm run dev` is required.

## The mocking model

- **MSW (Mock Service Worker)** intercepts all outbound HTTP: Notion
  (`api.notion.com/v1/*`), the Upstash `*/pipeline` REST endpoint, and — for
  the workflow tier only, which `vi.mock` cannot reach — the Gateway
  (`https://ai-gateway.vercel.sh`, via `test/gateway/msw.ts`'s
  `gatewayHandlers`). Everywhere else, the model is stubbed one layer up, at
  the registry (`test/ai/models-stub.ts`) — see "Stubbing the model" below.
  The node `server` lives in `test/msw/server.ts`; default handlers in
  `test/msw/handlers.ts`. Lifecycle (start / reset / stop) is managed in
  `vitest.setup.ts`. **Unhandled outbound requests fail the test by design**
  (`onUnhandledRequest: "error"`).
- **The Notion mirror** (`src/lib/mirror/*`) is tested against a stateful
  in-memory Notion, `test/fakes/notion-fake.ts` (`createNotionFake`), which
  checks the bearer token and the `Notion-Version` header, validates page
  properties against the database schema, and can be told to fail
  (`failNext`, including 429 with `Retry-After`). Install it into a test's MSW
  server with `useNotionFake(server, fake)` from `test/msw/notion-mirror.ts` —
  imported under another name (`import { useNotionFake as installNotionFake }`)
  outside a component, because ESLint's hooks rule reads any `use*` call as a
  hook. Workflow tests use the same fake through MSW, since `vi.mock` does not
  reach step code. PGlite's session time zone is the machine's, so compare
  `timestamptz` text in SQL (`$1::timestamptz = …`), never as strings.
- **`vi.mock("next/cache", …)`** — `catalog.ts` uses `cacheTag`/`cacheLife` and
  `admin/revalidate/route.ts` uses `revalidateTag`; these only work inside a Next
  build. Mock them with the `nextCacheMock()` factory from
  `test/mocks/next-cache.ts`.
- **`server-only`** is aliased to an empty stub (`test/mocks/server-only.ts`) in
  `vitest.config.ts`, so `rate-limit.ts` and its importers load under Vitest.
- **The PGlite rule.** `getCatalogTools()` / `getCatalogTool(id)` read from an
  in-process **PGlite** database — real Postgres, compiled to WebAssembly,
  migrated and seeded with demo data (two tools: `form-4`,
  `trotec-speedy-400`) — whenever `DATABASE_URL` is unset, which is the
  default in every test. So:
  - **Demo-seed path** (default in tests): leave `DATABASE_URL` unset → the
    seeded PGlite database, no MSW needed, no Notion env at all. Put
    `// @vitest-environment node` at the top of any file that touches PGlite.
  - **An isolated database**: `createPgliteDb()` from `src/lib/db/pglite.ts`
    returns a fresh instance for a test that seeds its own rows.
  - **Write paths still on Notion this phase** (tickets, corrections, project
    submission, uploads, intake): `vi.stubEnv` all 8 Notion vars (set
    `NOTION_DB_*` to the `DB_IDS` sentinels from `test/msw/handlers.ts`) → MSW
    serves `api.notion.com`. See the `stubNotionEnv()` helper in
    `test/README.md`.

## How to add a test

Place tests next to the code they cover. `describe` / `it` / `expect` / `vi` and
the lifecycle hooks are **globals** — no imports needed.

**Add a unit test** — create `src/lib/<name>.test.ts`:

```ts
import { isSupportedLocale } from "@/i18n/config";

it("recognizes a supported locale", () => {
  expect(isSupportedLocale("en")).toBe(true);
});
```

**Add a component test** — create `src/components/<Name>.test.tsx` and use the
custom `render` (it wraps the component in `NextIntlClientProvider` with the
`en` messages, which i18n-aware components need):

```ts
import { render, screen, userEvent } from "../../test/utils/render";
import { ToolCard } from "./ToolCard";
import { availableTool } from "../../test/fixtures/catalog";

it("renders the tool name", () => {
  render(<ToolCard tool={availableTool} />);
  expect(screen.getByText(availableTool.name)).toBeInTheDocument();
});
```

**Add an MSW override** — defaults live in `handlers.ts`; override per test with
`server.use(...)` (the `afterEach` reset undoes it):

```ts
import { server } from "../../test/msw/server";
import { http, HttpResponse } from "msw";

server.use(
  http.post("https://api.notion.com/v1/databases/:id/query", () =>
    HttpResponse.json({ object: "error" }, { status: 500 })
  )
);
```

**Add a fixture** — extend `test/fixtures/notion.ts` (raw `NotionPage` shapes +
the `notionQueryResponse(pages, { hasMore })` pagination helper) or
`test/fixtures/catalog.ts` (resolved `MakerLabTool` / `MakerLabUnit` objects for
component tests). Reuse the existing exports before adding new ones.

**Env stubbing for module-load-time reads.** `site-config.ts` reads
`NEXT_PUBLIC_*` / `AUDIENCE` at module load, and `rate-limit.ts` computes its
Upstash branch from `UPSTASH_*` at load. `vi.stubEnv` after import won't change
those captured values — stub, then `vi.resetModules()`, then dynamic `import()`:

```ts
it("honors NEXT_PUBLIC_SITE_NAME override", async () => {
  vi.stubEnv("NEXT_PUBLIC_SITE_NAME", "Acme Lab");
  vi.resetModules();
  const { siteConfig } = await import("@/lib/site-config");
  expect(siteConfig.name).toBe("Acme Lab");
});
```

`vi.unstubAllEnvs()` and `vi.restoreAllMocks()` run automatically after every
test (the setup file). The in-memory rate limiter is a per-process singleton
`Map` — use distinct keys per test, or `resetModules()` + re-import for a fresh
window.

**Blob mode.** The setup file sets `BLOB_LOCAL_DISABLE=1`, so with no
`BLOB_READ_WRITE_TOKEN` a test sees "no store" (`blob_not_configured`), as a
deploy without one does. To test the local `.blob-data/` store, stub
`BLOB_LOCAL_DISABLE` / `VERCEL` to `""` and `NODE_ENV` to `"development"`, and
point `process.cwd()` at a temp folder (`src/lib/blob-local.test.ts`).
`BLOB_LOCAL_DIR` (test-only) moves the folder and also allows the local store
in a production build — the intake E2E server's switch; never on Vercel.

**Stubbing the model (chat route and elsewhere).** The chat route's tool
`execute` functions are inline and its helpers are module-private, so don't
unit-test them directly. Instead mock the registry — `vi.mock("@/lib/ai/models", …)`
through `test/ai/models-stub.ts` — call `POST(req)`, and assert on the
response; `recordedCalls(model)` gives you back the `{ prompt, tools,
providerOptions }` a stubbed model received. Never mock `@ai-sdk/gateway` or
`@ai-sdk/anthropic` (unused) directly. The workflow tier, which `vi.mock` cannot reach,
stubs the Gateway's own HTTP boundary instead with `test/gateway/msw.ts`. The
full verified snippet and both seams are in
[`test/README.md`](./test/README.md#stubbing-the-model--two-seams-never-a-provider-mock).

## E2E notes

- Playwright's `webServer` builds and boots `npx next start -p 3100` with `DATABASE_URL`
  unset, so the app serves the seeded PGlite demo database regardless of your
  dev shell's environment. `testDir` is `./e2e`; `baseURL` is
  `http://localhost:3100`.
- `/api/chat` is intercepted **inside each spec** at the network layer via
  `page.route()` returning a UI-message stream chunk — no real model call.
- **Except `e2e/intake.spec.ts`** (gateway spec §10, formerly data platform
  spec §10 scenario 5), which needs `identify_tools` and the research
  workflow — including the image stage — to run on the server. Playwright
  boots a second web server, `e2e/stubs/gateway-stub.ts` on port 3101 (plain
  `node:http`, serving `test/gateway/wire.ts`'s builders under `node
  --experimental-strip-types`), and the app reaches it through
  `AI_GATEWAY_BASE_URL` with a fake `AI_GATEWAY_API_KEY` —
  `READ_PAGE_TEST_ORIGIN` also points at it, so the read step's and the
  chat's `read_page` fetches are exempted from the SSRF guard that would
  otherwise refuse a loopback address. The model is stubbed at the Gateway's
  own wire format, and everything else is the real app, including the
  Workflow SDK's local world. It is its own Playwright project (`intake`)
  that depends on `chromium`, so it runs after every other spec, and it runs
  **against its own server**: the same build started again with `npx next
  start -p 3103` and a local Blob folder (`BLOB_LOCAL_DIR=.blob-data-e2e`,
  git-ignored). So the image stage cuts the backdrop out of the stub's one
  candidate (a product on plain white; the cutout is deterministic and calls
  no model), the review page preselects
  the cleaned copy, and the test approves it and checks the gallery card shows
  the published copy — while port 3100 keeps no Blob store for
  `projects.spec.ts`'s "uploads unavailable" assertion. Its demo database is
  its own. Run it alone with `npx playwright test --project=intake --no-deps`
  (Playwright still starts every web server, including the 3100 build).
- **And `e2e/mirror.spec.ts`** (§10 scenario 8), the same shape for Notion: the
  mirror calls Notion from server actions and workflow steps, so a third web
  server, `e2e/stubs/notion-stub.ts` on port 3102, answers `/v1/*` with the
  in-memory fake the Vitest suites use (`test/fakes/notion-fake.ts`), and the
  app reaches it through `NOTION_API_BASE_URL` (test-only; production never
  sets it). Fixture values (fake token, page id and URL) are in
  `e2e/stubs/notion-fixture.ts`. It is its own project (`mirror`) that depends
  on `intake`, so it runs last of all: while a mirror is connected every write
  in the app schedules a push, and no other spec may be writing then. One
  test, `retries: 0` — each step is the next one's precondition. Run it alone
  with `npx playwright test --project=mirror --no-deps`.
- `reuseExistingServer: false` — Playwright **always** boots its own fresh
  PGlite-backed server on the dedicated port 3100. This means E2E never
  collides with (or accidentally reuses) a `next dev` you have running on the
  default port 3000 against a real database, so results are deterministic no
  matter what you have running locally. Port 3000 is left untouched.

## Coverage

`npm run test:coverage` produces a `v8` coverage report (`text` to stdout +
`html`). There is **no enforced threshold** and **no CI workflow** — by design.
Coverage is a diagnostic for developers, not a gate.

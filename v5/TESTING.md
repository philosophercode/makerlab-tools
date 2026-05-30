# Testing — v5

Practical runbook for the v5 test suite. For the full design rationale and the
per-file coverage matrix, see the design doc:
[`docs/superpowers/specs/2026-05-29-v5-test-suite-design.md`](../docs/superpowers/specs/2026-05-29-v5-test-suite-design.md)
(repo root). For harness internals (fixtures, mocks, render helper, the exact
import paths), see [`test/README.md`](./test/README.md).

## Overview

The suite has four layers, all **fully mocked — no live services**. Tests never
hit Notion, Anthropic, or Upstash; there are no API keys and no network cost.
Everything is deterministic and offline.

| Layer | What | Where it lives | Runner |
|---|---|---|---|
| Unit | `src/lib`, `src/i18n` pure logic | colocated `*.test.ts` next to source | Vitest |
| Integration | API routes (`/api/*`) with HTTP + module mocks | colocated `route.test.ts` next to the route | Vitest |
| Component | React UI via React Testing Library | colocated `*.test.tsx` next to the component | Vitest |
| E2E | Full app against the mock catalog | `e2e/*.spec.ts` | Playwright |

Shared infra lives in `test/` (MSW server + handlers, fixtures, mocks, the RTL
`render` helper). Tests import from there; **don't edit `package.json` or run
`npm install`** — the harness deps and scripts are already wired.

## How to run

```bash
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
  (`api.notion.com/v1/*`), the Anthropic web-fetch host, and the Upstash
  `*/pipeline` REST endpoint. The node `server` lives in `test/msw/server.ts`;
  default handlers in `test/msw/handlers.ts`. Lifecycle (start / reset / stop) is
  managed in `vitest.setup.ts`. **Unhandled outbound requests fail the test by
  design** (`onUnhandledRequest: "error"`).
- **`vi.mock("next/cache", …)`** — `catalog.ts` uses `cacheTag`/`cacheLife` and
  `admin/revalidate/route.ts` uses `revalidateTag`; these only work inside a Next
  build. Mock them with the `nextCacheMock()` factory from
  `test/mocks/next-cache.ts`.
- **`server-only`** is aliased to an empty stub (`test/mocks/server-only.ts`) in
  `vitest.config.ts`, so `rate-limit.ts` and its importers load under Vitest.
- **Mock-catalog fallback rule.** `getCatalogTools()` / `getCatalogTool(id)`
  return the built-in `src/components/mock-catalog.ts` data when
  `hasNotionCatalogEnv()` is false — i.e. **any** of the 8 Notion env vars
  (`NOTION_API_KEY` + the 7 `NOTION_DB_*`) is missing — and also on any thrown
  error during fetch. So:
  - **Mock path** (default in tests): leave `NOTION_*` unset → mock data, no MSW
    needed.
  - **Real Notion path**: `vi.stubEnv` all 8 vars (set `NOTION_DB_*` to the
    `DB_IDS` sentinels from `test/msw/handlers.ts`) → MSW serves
    `api.notion.com`. See the `stubNotionEnv()` helper in `test/README.md`.

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

**streamText-capture pattern (chat route).** The chat route's tool `execute`
functions are inline and its helpers are module-private, so don't unit-test them
directly. Instead mock `ai`'s `streamText` (spreading `...actual`) to capture
the `{ system, messages, tools }` it receives, call `POST(req)`, and assert on
the captured args — you can also invoke the captured `tools.*.execute(...)`
directly. Also mock `@ai-sdk/anthropic`. The full verified snippet is in
[`test/README.md`](./test/README.md#streamtext-capture-pattern-chat-route--verified).

## E2E notes

- Playwright's `webServer` boots `npm run dev` with all `NOTION_*` vars set to
  `""`, so `hasNotionCatalogEnv()` is false and the app serves the built-in mock
  catalog (`src/components/mock-catalog.ts`) regardless of your dev shell's
  environment. `testDir` is `./e2e`; `baseURL` is `http://localhost:3000`.
- `/api/chat` is intercepted **inside each spec** at the network layer via
  `page.route()` returning a UI-message stream chunk — no real Anthropic call.
- `reuseExistingServer: true` (when not in CI) means an already-running dev
  server on port 3000 is reused instead of starting a fresh one; in CI a new
  server is always spawned. If you have a stale dev server with the wrong env,
  stop it so Playwright boots its own with Notion unset.

## Coverage

`npm run test:coverage` produces a `v8` coverage report (`text` to stdout +
`html`). There is **no enforced threshold** and **no CI workflow** — by design.
Coverage is a diagnostic for developers, not a gate.

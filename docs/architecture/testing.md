# Testing

> Moved verbatim from `AGENTS.md` on 2026-09-29, when `AGENTS.md` became an
> index. Paths are relative to the repository root.

## Testing

Comprehensive, **fully-mocked** suite (no live Notion/Gateway/Redis/Postgres —
Article 3). Run everything with one command:

```bash
npm run test:all     # lint + typecheck + vitest + playwright
```

Or individually: `npm test` (Vitest: unit + integration + component),
`npm run test:e2e` (Playwright — run `npx playwright install chromium` once
first), `npm run test:coverage`.

- **Vitest** (jsdom) + React Testing Library + MSW; **Playwright** for E2E.
- **The whole suite runs with every environment variable unset.** Reads *and*
  writes go to an in-process PGlite database seeded with demo data; Vercel Blob
  is stubbed at the `src/lib/blob.ts` seam (`vi.mock`), never called for real.
  `vitest.setup.ts` sets `BLOB_LOCAL_DISABLE=1`, so "no token" still means "no
  store"; the local-store tests opt in and write to a temp folder.
  Only the mirror writes Notion; its tests talk to an in-memory Notion
  (`test/fakes/notion-fake.ts`) through MSW, never to `api.notion.com`.
  Email goes to Resend only when `RESEND_API_KEY` and `EMAIL_FROM` are set;
  unset, every delivery is recorded `not_configured` in process. Tests that
  send install `useResendFake(server)` (`test/msw/resend.ts`), which records
  each request and, like Resend, answers a repeated idempotency key with the
  first email, so "one per person" holds across retries. There is no default
  Resend handler: a send without the fake fails on MSW's unhandled request.
- **Every model call is stubbed, at one of two seams, and never with a
  provider-specific mock** (never `vi.mock("@ai-sdk/gateway")`):
  - **`test/ai/models-stub.ts`** — `vi.mock("@/lib/ai/models", …)` swaps
    `languageModelFor` for a `MockLanguageModelV3` (from `ai/test`) built
    with `textModel`, `toolCallModel`, `scriptedModel`, etc. This is
    the seam for anything that imports the registry directly — most unit and
    route-integration tests.
  - **`test/gateway/*`** — `wire.ts` (dependency-free request/response
    builders matching the Gateway's own wire format), `msw.ts`
    (`gatewayHandlers({ language?, image? })`, MSW handlers over it) and
    `png.ts` (`makePng`, a real decodable PNG with or without alpha, and
    `makeProductPng`, a product on a plain white backdrop — both no deps).
    `test/images/synthetic.ts` paints synthetic photos with `sharp` for the
    classifier and cutout tests. This is the seam for the **workflow tier**
    (`*.workflow.test.ts` under `@workflow/vitest`, where `vi.mock` does not
    reach step code) — it now talks to `https://ai-gateway.vercel.sh`
    (stubbed by MSW), not `api.anthropic.com`.
- **The workflow tier's event log is kept append-only**
  (`test/workflow/serial-event-log.ts`, a setup file of the workflow project).
  `@workflow/world-local` 4.x gives an event its place in the log before
  writing it, so two steps finishing together could land out of order; a
  replay draws step ids in log order and matches a stored step by id and name
  only, so one item could receive another's step result (`refreshBatch`,
  `researchBatch`). The shim runs `events.create` one call at a time. The same
  world serves `npm run dev` and the intake E2E, which the shim does not cover.
- E2E boots its own server on **port 3100** with `DATABASE_URL` unset (PGlite demo catalog) and intercepts `/api/chat` — it never touches your `:3000` dev server or real services.
- **The intake E2E is the exception** (`e2e/intake.spec.ts`): it needs `identify_tools` and the research workflow (including the image stage) to run server-side, so the model is stubbed at the Gateway's own wire format by a second local server (`e2e/stubs/gateway-stub.ts`, reached through `AI_GATEWAY_BASE_URL`, using the same `test/gateway/wire.ts`/`png.ts` builders under `node --experimental-strip-types`), and `READ_PAGE_TEST_ORIGIN` exempts that one loopback origin from the SSRF guard so the read step and `read_page` can reach the stub's own pages. The workflow runs on the SDK's local world. It is its own Playwright project, run after every other spec, **against its own server**: the same build started again on port 3103 with a local Blob folder (`BLOB_LOCAL_DIR=.blob-data-e2e`), so the image stage cleans the top candidate, the review page shows it through the cleaned-image route, and the test picks it and sees it on the gallery card — while the main server keeps the "uploads unavailable" branch `projects.spec.ts` asserts. Its demo database is separate, so the approved tool never reaches `gallery.spec.ts`'s count.
- **The mirror E2E** (`e2e/mirror.spec.ts`) is the same shape: Notion is a local stub (`e2e/stubs/notion-stub.ts`, port 3102, reached through `NOTION_API_BASE_URL`) serving the same fake, and the project runs after `intake`, last of all.
- Tests are colocated (`*.test.ts(x)` next to source); shared harness in `test/`.
- **Read these before writing tests:** `TESTING.md` (runbook), `test/README.md` (harness internals, the two model-stubbing seams above, and env-stubbing patterns), and `docs/specs/2026-05-29-v5-test-suite-design.md` (design + coverage matrix). The harness deps/scripts are already wired — don't hand-edit `package.json` for them.

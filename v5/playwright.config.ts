import { defineConfig, devices } from "@playwright/test";

import { GATEWAY_STUB_ORIGIN, INTAKE_APP_ORIGIN, INTAKE_APP_PORT } from "./e2e/stubs/intake-fixture";
import { NOTION_STUB_ORIGIN } from "./e2e/stubs/notion-fixture";

// E2E runs against a PRODUCTION build (`next build && next start`) booted with
// no `DATABASE_URL` and no Notion env, so the catalogue is the in-process
// PGlite database seeded with the two demo tools (src/lib/db/demo-seed.ts).
// The /api/chat call is intercepted at the network layer inside each spec via
// page.route(). No real external services are touched.
//
// The one exception is the intake scenario (e2e/intake.spec.ts): identifying
// equipment writes rows and research runs server-side in a workflow, neither of
// which a browser-side intercept can reach. For it the model is stubbed at the
// Gateway's own wire format instead (gateway spec §10) — a second web server
// (e2e/stubs/gateway-stub.ts) answers `/v3/ai/language-model` on
// localhost (background removal calls no model), and the app reaches it through
// AI_GATEWAY_BASE_URL with a fake AI_GATEWAY_API_KEY. It is still no network:
// the stub is on this machine. (This replaces the old anthropic-stub.ts, which
// answered the Anthropic Messages API directly — retired with the direct
// provider path; see docs/specs/2026-09-23-gateway-models-and-product-images-design.md.)
//
// The intake scenario also has its own app server: the same build, started a
// second time on INTAKE_APP_PORT with a local Blob folder (BLOB_LOCAL_DIR,
// src/lib/blob-mode.ts), because it must store the cleaned product image and
// publish it (gateway spec §10) while projects.spec.ts asserts the "uploads
// unavailable" branch on the main server. A second process also means a
// second, separate demo database, so the tool intake approves never reaches
// gallery.spec.ts's count.
//
// The mirror scenario (e2e/mirror.spec.ts) is the same shape: the mirror calls
// Notion from server actions and workflow steps, so a third web server
// (e2e/stubs/notion-stub.ts) answers the Notion API on localhost with the same
// in-memory fake the Vitest suites use, reached through NOTION_API_BASE_URL.
//
// Why not `next dev`: with parallel workers, the first request to each route
// compiled it on demand and Turbopack rewrote the root layout's client chunk
// while another worker was downloading it (ERR_CONTENT_LENGTH_MISMATCH), so
// pages intermittently never hydrated (data platform spec 2026-09-14, Phase 2
// amendment). A production server has no compiler in the loop, and it is the
// same bundle a Vercel preview without a database runs.
//
// NOTE FOR THE E2E AGENT: run `npx playwright install chromium` once before the
// first `npm run test:e2e` — the foundation harness does not install browsers.

// The main app server's environment (the long comment inside says why each
// value is what it is). The intake server starts from the same values.
const MAIN_APP_ENV: Record<string, string> = {
  ...process.env,
  DATABASE_URL: "",
  // A developer's persistent local database (.env.local) is refused in a
  // production build and must never be what E2E reads or writes.
  PGLITE_DATA_DIR: "",
  NOTION_API_KEY: "",
  NOTION_DB_TOOLS: "",
  NOTION_DB_CATEGORIES: "",
  NOTION_DB_LOCATIONS: "",
  NOTION_DB_UNITS: "",
  NOTION_DB_RESOURCES: "",
  NOTION_DB_MAINTENANCE_LOGS: "",
  NOTION_DB_FLAGS: "",
  // Blanked so the run is the same on a machine that happens to have a
  // Blob store linked: uploads must take the "unavailable" branch, which
  // is itself asserted in projects.spec.ts, and no test may put bytes in
  // somebody's real store.
  BLOB_READ_WRITE_TOKEN: "",
  // `next start` is a production build, so the local `.blob-data/` store
  // is off anyway; this says so explicitly (src/lib/blob-mode.ts).
  BLOB_LOCAL_DISABLE: "1",
  // Same reasoning for the nightly job: no E2E test should be able to
  // trigger a real backup.
  CRON_SECRET: "",
  // A test-only signing key, so sessions are real rows and a spec can be
  // somebody by presenting a properly signed cookie for one of the demo
  // accounts (src/lib/db/demo-seed.ts). GOOGLE_* stay blank below, so
  // *starting* a session is still impossible here: /api/auth/sign-in/social
  // answers 503 and the header says sign-in is not set up. That is the
  // state a deployment is in before its OAuth client exists, and it is the
  // state the anonymous specs assert against.
  AUTH_SECRET: "e2e-only-secret-not-used-anywhere-else",
  AUTH_BASE_URL: "http://localhost:3100",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  AUTH_SUPER_ADMIN_EMAILS: "",
  // The model, stubbed at the Gateway's own wire format for the intake
  // scenario (gateway spec §3.1, §10). The key is fake and the base URL
  // is the stub on this machine — gatewayProvider() uses
  // AI_GATEWAY_API_KEY when it is set, so no OIDC token is needed here.
  // Every MODEL_* override is blanked so each job's default id
  // (src/lib/ai/models.ts, MODEL_JOBS) applies — the gateway-stub
  // classifies requests by their shape, never by model id, so which
  // default is in effect does not matter to it.
  AI_GATEWAY_API_KEY: "e2e-stub-key",
  AI_GATEWAY_BASE_URL: `${GATEWAY_STUB_ORIGIN}/v3/ai`,
  MODEL_CHAT: "",
  MODEL_RESEARCH_SEARCH: "",
  MODEL_RESEARCH_READ: "",
  MODEL_IMAGE_RANK: "",
  // The read step's page fetches (src/lib/web/read-page.ts), link
  // verification (src/lib/research/verify-links.ts) and the image probe
  // all go through guardedFetch, whose SSRF guard otherwise refuses a
  // loopback address — exactly where the stub's own product pages,
  // manuals and images live. This one exact origin is exempted; every
  // other loopback or private address stays refused. Ignored whenever
  // VERCEL is set, so this has no effect outside E2E.
  READ_PAGE_TEST_ORIGIN: GATEWAY_STUB_ORIGIN,
  // The mirror's Notion calls go to the stub on this machine (test-only
  // override; production never sets it). The token the spec connects with
  // is accepted by nothing else, and is encrypted under AUTH_SECRET above.
  NOTION_API_BASE_URL: `${NOTION_STUB_ORIGIN}/v1`,
  // The Workflow SDK's local world (spec §3.7): its queue calls this
  // server's own /.well-known/workflow routes, so it needs the address
  // `next start -p 3100` serves on (the intake server overrides it with its
  // own). Runs are kept in their own folder, and
  // a previous run's leftovers are never replayed against a fresh demo
  // database.
  WORKFLOW_TARGET_WORLD: "local",
  WORKFLOW_LOCAL_BASE_URL: "http://localhost:3100",
  WORKFLOW_LOCAL_DATA_DIR: ".workflow-data/e2e",
  WORKFLOW_LOCAL_RECOVER_ACTIVE_RUNS: "0",
};

// The intake scenario's server: the same values, plus a local Blob folder
// (test-only BLOB_LOCAL_DIR, which alone lets a production build use the
// local store — never on Vercel, src/lib/blob-mode.ts), so research stores
// the cleaned image, the review page shows it through the cleaned-image
// route, and approval publishes it under /api/dev-blob/ on this origin
// (AUTH_BASE_URL is the local store's public origin too). Its workflow runs
// and its files are kept apart from the main server's and from a
// developer's own `.blob-data/`.
const INTAKE_APP_ENV: Record<string, string> = {
  ...MAIN_APP_ENV,
  AUTH_BASE_URL: INTAKE_APP_ORIGIN,
  BLOB_LOCAL_DISABLE: "",
  BLOB_LOCAL_DIR: ".blob-data-e2e",
  WORKFLOW_LOCAL_BASE_URL: INTAKE_APP_ORIGIN,
  WORKFLOW_LOCAL_DATA_DIR: ".workflow-data/e2e-intake",
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // One retry everywhere, not only in CI. With fourteen workers on a large
  // machine a handful of interactions a few hundred milliseconds after a
  // navigation still occasionally miss (about one test execution in a hundred
  // as of Phase 2); a retry keeps the gate green and Playwright reports the
  // test as "flaky" rather than hiding it, so the count stays visible.
  retries: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    // Dedicated test port (not 3000) so the suite never collides with — or
    // accidentally reuses — a `next dev` you have running locally against a
    // real database. The webServer below always boots its own demo instance.
    baseURL: "http://localhost:3100",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /(intake|mirror)\.spec\.ts/,
    },
    {
      // Against its own server (INTAKE_APP_ORIGIN, see the note at the top),
      // and after every other spec on purpose: research runs in a background
      // workflow on a deadline, and a machine busy with fourteen other workers
      // is where it would miss one. Depending on "chromium" runs it alone.
      name: "intake",
      use: { ...devices["Desktop Chrome"], baseURL: INTAKE_APP_ORIGIN },
      testMatch: /intake\.spec\.ts/,
      dependencies: ["chromium"],
    },
    {
      // Last of all: while a mirror is connected, every change in the app
      // schedules a push, and no other spec should be writing then. Intake now
      // writes to its own server, but depending on "intake" (which depends on
      // "chromium") still serialises all three, so the mirror scenario meets a
      // quiet machine. The spec disconnects at the end.
      name: "mirror",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /mirror\.spec\.ts/,
      dependencies: ["intake"],
    },
  ],
  webServer: [
    {
      // The stand-in for the Vercel AI Gateway (see the note at the top).
      command: "node --experimental-strip-types e2e/stubs/gateway-stub.ts",
      url: GATEWAY_STUB_ORIGIN,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      // The stand-in for the Notion API, for the mirror scenario.
      command: "node --experimental-strip-types e2e/stubs/notion-stub.ts",
      url: NOTION_STUB_ORIGIN,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      // `npm run build` runs `db:migrate` first, which is a no-op with the
      // blanked DATABASE_URL (MAIN_APP_ENV above), then `next build`.
      command: "npm run build && npx next start -p 3100",
      url: "http://localhost:3100",
      // Always boot a fresh demo-backed server; never reuse whatever is on the
      // port. Keeps E2E deterministic regardless of the local dev environment.
      reuseExistingServer: false,
      // The build is most of this budget; `next start` itself is seconds.
      timeout: 300_000,
      // MAIN_APP_ENV blanks `DATABASE_URL` so the catalogue is the demo seed,
      // and the Notion env so no write path can reach Notion. Spreading
      // process.env first, then overwriting with "" wins over both the dev
      // shell and `.env.local`, which Next will not override for a key that is
      // already present.
      env: MAIN_APP_ENV,
    },
    {
      // The intake scenario's server (see the note at the top): the build the
      // entry above just made, started again with a Blob store of its own.
      // Listed after it, so it starts once that build exists — Playwright
      // starts web servers one after another.
      command: `npx next start -p ${INTAKE_APP_PORT}`,
      url: INTAKE_APP_ORIGIN,
      reuseExistingServer: false,
      timeout: 60_000,
      env: INTAKE_APP_ENV,
    },
  ],
});

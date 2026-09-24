import { defineConfig, devices } from "@playwright/test";

import { ANTHROPIC_STUB_ORIGIN } from "./e2e/stubs/intake-fixture";
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
// provider boundary instead — a second web server (e2e/stubs/anthropic-stub.ts)
// answers the Messages API on localhost, and the app reaches it through
// ANTHROPIC_BASE_URL. It is still no network: the stub is on this machine.
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
      // Last, on purpose. Approving an item publishes a third tool into the one
      // demo database every spec shares, and gallery.spec.ts counts two while
      // admin-inventory.spec.ts expects no drafts. Depending on "chromium"
      // runs this project after every other spec has finished.
      name: "intake",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /intake\.spec\.ts/,
      dependencies: ["chromium"],
    },
    {
      // Last of all: while a mirror is connected, every change in the app
      // schedules a push, and no other spec should be writing then. That
      // includes intake, whose approval would schedule a coalesced push that
      // could meet Sync now's push at the overlap guard and leave the status
      // panel waiting on a run that sleeps two minutes first. Depending on
      // "intake" (which depends on "chromium") serialises all three, so the
      // mirror scenario meets a quiet app. The spec disconnects at the end.
      name: "mirror",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /mirror\.spec\.ts/,
      dependencies: ["intake"],
    },
  ],
  webServer: [
    {
      // The stand-in for the Anthropic API (see the note at the top).
      command: "node --experimental-strip-types e2e/stubs/anthropic-stub.ts",
      url: ANTHROPIC_STUB_ORIGIN,
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
      // blanked DATABASE_URL below, then `next build`.
      command: "npm run build && npx next start -p 3100",
      url: "http://localhost:3100",
      // Always boot a fresh demo-backed server; never reuse whatever is on the
      // port. Keeps E2E deterministic regardless of the local dev environment.
      reuseExistingServer: false,
      // The build is most of this budget; `next start` itself is seconds.
      timeout: 300_000,
      // Blank `DATABASE_URL` so the catalogue is the demo seed, and the Notion
      // env so no write path can reach Notion. Spreading process.env first, then
      // overwriting with "" wins over both the dev shell and `.env.local`, which
      // Next will not override for a key that is already present.
      env: {
        ...process.env,
        DATABASE_URL: "",
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
        // The model, stubbed at the provider boundary for the intake scenario.
        // The key is fake and the base URL is the stub on this machine; the
        // gateway key is blanked so resolveChatModel() takes the direct path.
        ANTHROPIC_API_KEY: "e2e-stub-key",
        ANTHROPIC_BASE_URL: `${ANTHROPIC_STUB_ORIGIN}/v1`,
        AI_GATEWAY_API_KEY: "",
        // The mirror's Notion calls go to the stub on this machine (test-only
        // override; production never sets it). The token the spec connects with
        // is accepted by nothing else, and is encrypted under AUTH_SECRET above.
        NOTION_API_BASE_URL: `${NOTION_STUB_ORIGIN}/v1`,
        // The Workflow SDK's local world (spec §3.7): its queue calls this
        // server's own /.well-known/workflow routes, so it needs the address
        // `next start -p 3100` serves on. Runs are kept in their own folder, and
        // a previous run's leftovers are never replayed against a fresh demo
        // database.
        WORKFLOW_TARGET_WORLD: "local",
        WORKFLOW_LOCAL_BASE_URL: "http://localhost:3100",
        WORKFLOW_LOCAL_DATA_DIR: ".workflow-data/e2e",
        WORKFLOW_LOCAL_RECOVER_ACTIVE_RUNS: "0",
      },
    },
  ],
});

import { defineConfig, devices } from "@playwright/test";

// E2E runs against the app booted with NO Notion env vars, so getCatalogTools()
// serves the built-in mock catalog (src/components/mock-catalog.ts). The
// /api/chat call is intercepted at the network layer inside each spec via
// page.route(). No real external services are touched.
//
// NOTE FOR THE E2E AGENT: run `npx playwright install chromium` once before the
// first `npm run test:e2e` — the foundation harness does not install browsers.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    // Dedicated test port (not 3000) so the suite never collides with — or
    // accidentally reuses — a `next dev` you have running locally against real
    // Notion. The webServer below always boots its own mock-backed instance.
    baseURL: "http://localhost:3100",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npx next dev -p 3100",
    url: "http://localhost:3100",
    // Always boot a fresh mock-backed server; never reuse whatever is on the
    // port. Keeps E2E deterministic regardless of the local dev environment.
    reuseExistingServer: false,
    timeout: 120_000,
    // Unset Notion env so the app serves the mock catalog. Spreading
    // process.env first, then overwriting with "" makes hasNotionCatalogEnv()
    // return false regardless of the dev shell's environment.
    env: {
      ...process.env,
      NOTION_API_KEY: "",
      NOTION_DB_TOOLS: "",
      NOTION_DB_CATEGORIES: "",
      NOTION_DB_LOCATIONS: "",
      NOTION_DB_UNITS: "",
      NOTION_DB_RESOURCES: "",
      NOTION_DB_MAINTENANCE_LOGS: "",
      NOTION_DB_FLAGS: "",
    },
  },
});

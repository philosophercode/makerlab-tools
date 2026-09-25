import { test, expect, type Locator } from "@playwright/test";

import { DEMO_ACCOUNTS } from "../src/lib/db/demo-seed";
import { NOTION_STUB_PAGE_TITLE, NOTION_STUB_PAGE_URL, NOTION_STUB_TOKEN } from "./stubs/notion-fixture";
import { signIn } from "./utils/session";

/**
 * The Notion mirror, end to end (data platform design spec §3.8, §10 E2E
 * scenario 8): an admin connects a mirror, presses Sync now, and sees a
 * last-synced time.
 *
 * **Notion is stubbed at the API boundary, not in the browser.** The mirror
 * reads Notion from server actions and writes it from workflow steps, neither
 * of which a `page.route()` can reach. So the server talks to
 * `e2e/stubs/notion-stub.ts` on localhost — the same in-memory Notion the
 * Vitest suites install through MSW — and everything in between is the real
 * app: the server actions and their gate, the token encryption, Create
 * databases, the `mirrorPush` workflow on the SDK's local world, and the
 * status panel polling until the push lands.
 *
 * **It is the director's mirror** — Isaac's, the first one (§3.8 "Owners") —
 * and it runs in its own Playwright project after the parallel specs, because
 * a connected mirror turns every later change in the app into a scheduled
 * push. It disconnects at the end for the same reason.
 *
 * **One test, not retried.** Each step is the next one's precondition, and a
 * second attempt would meet the first attempt's mirror — connected, mapped,
 * inside its 15-minute Sync now window.
 */

test.describe.configure({ retries: 0 });

/** The value beside a `<dt>` label in the status panel. */
function fact(panel: Locator, label: string): Locator {
  return panel.locator("dt", { hasText: label }).locator("xpath=following-sibling::dd[1]");
}

test("an admin connects a mirror, creates its databases, syncs, and sees when it last synced", async ({
  page,
  context,
  baseURL,
}) => {
  // Create databases makes seven, and the push writes every demo row, all at
  // three requests a second.
  test.setTimeout(180_000);
  await signIn(context, DEMO_ACCOUNTS.superAdmin, baseURL);

  // ── Step 1: the page, reached from /admin ─────────────────────────────────
  await page.goto("/admin");
  const surfaces = page.getByRole("navigation", { name: "Admin sections" });
  await surfaces.getByRole("link", { name: "Notion mirror" }).click({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/admin\/mirror$/);
  await expect(page.getByRole("heading", { name: "Notion mirror", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Before you connect" })).toBeVisible();

  // ── Step 2: test the connection, then connect ─────────────────────────────
  const token = page.getByLabel("Integration token");
  await expect(token).toHaveAttribute("type", "password");
  await token.fill(NOTION_STUB_TOKEN);
  await page.getByLabel("Page URL").fill(NOTION_STUB_PAGE_URL);

  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText(`Found the page “${NOTION_STUB_PAGE_TITLE}”.`)).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Connect", exact: true }).click();

  // The page re-renders into its connected state: status, controls, mapping.
  const status = page.getByRole("region", { name: "Status" });
  await expect(status.getByText(`Connected to “${NOTION_STUB_PAGE_TITLE}”.`)).toBeVisible({ timeout: 15_000 });
  await expect(fact(status, "Last synced")).toHaveText("Never");
  // The token went in and never came back out.
  await expect(page.locator("body")).not.toContainText(NOTION_STUB_TOKEN);

  // ── Step 3: Create databases → seven ids ──────────────────────────────────
  const mapping = page.getByRole("table", { name: "Notion databases, one per table" });
  await expect(mapping.getByText("Not set")).toHaveCount(7);
  await page.getByRole("button", { name: "Create databases" }).click();
  await expect(page.getByText("Created 7 databases.")).toBeVisible({ timeout: 30_000 });
  await expect(mapping.getByText("Not set")).toHaveCount(0, { timeout: 15_000 });
  await expect(mapping.locator("code")).toHaveCount(7);
  for (const id of await mapping.locator("code").allTextContents()) {
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  }

  // ── Step 4: Sync now → the workflow pushes → a last-synced time and OK ────
  const syncNow = page.getByRole("button", { name: "Sync now" });
  await expect(syncNow).toBeEnabled();
  await syncNow.click();
  await expect(page.getByText("Sync started.")).toBeVisible({ timeout: 15_000 });

  // The panel polls every five seconds while the push is requested or running.
  await expect(fact(status, "Last result")).toHaveText("OK", { timeout: 90_000 });
  const lastSynced = fact(status, "Last synced").locator("time");
  await expect(lastSynced).toBeVisible();
  await expect(lastSynced).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}T/);
  await expect(status.getByText("Last error")).toHaveCount(0);

  // ── Step 5: a second Sync now is refused, with the 15-minute reason ───────
  await expect(syncNow).toBeDisabled();
  await expect(page.getByText(/Sync now runs once every 15 minutes\./)).toBeVisible();
  // Minutes, not a raw timestamp; how many depends on how long the push took.
  await expect(page.getByText(/Available again in \d+ minutes?\./)).toBeVisible();

  // ── Step 6: disconnect, so nothing later pushes to the stub ───────────────
  await page.getByRole("button", { name: "Disconnect" }).click();
  await page.getByRole("button", { name: "Yes, disconnect" }).click();
  await expect(page.getByRole("heading", { name: "The connection needs a new token" })).toBeVisible({
    timeout: 15_000,
  });
  // The mapping is kept, so reconnecting would update the same pages.
  await expect(mapping.locator("code")).toHaveCount(7);
  await expect(page.getByLabel("Integration token")).toHaveValue("");
});

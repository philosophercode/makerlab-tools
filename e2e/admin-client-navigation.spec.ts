import { test, expect, type Locator, type Page } from "@playwright/test";
import { DEMO_ACCOUNTS } from "../src/lib/db/demo-seed";
import { signIn } from "./utils/session";

/**
 * Every admin section, reached by clicking — never by `page.goto` — against the
 * production build Playwright boots (see playwright.config.ts).
 *
 * The regression test for a click that was answered and never shown: the
 * destination's data arrived (200) and the new page never mounted. Every admin
 * page reads the request at its root, so its prefetched segment is a shell
 * with a dynamic hole where the page should be; the router rendered that
 * shell first, and with no Suspense boundary inside the new segment the hole
 * suspended the navigation behind a boundary already on screen — a transition
 * the React canary Next 16.1 bundles sometimes never retried. Each admin segment now has
 * a `loading.tsx` (DESIGN.md §8.12 "Admin navigation never waits on a hole";
 * `src/app/admin/loading-boundaries.test.ts`), so a hop commits at once.
 *
 * Before the fix every one of 15 walks stuck on some hop (the URL never
 * changed); after it, none of 15. The walk crosses every section a director
 * can open, the Intake tabs and Import a list, and comes back the other way.
 */

/** A few seconds, far less than the "never" this guards against. */
const HOP_TIMEOUT = 5_000;

type Where = (page: Page) => Locator;
const bar: Where = (page) => page.getByRole("navigation", { name: "Admin sections" });
const section = (name: string): Where => (page) => bar(page).getByRole("link", { name, exact: true });
const tab = (name: string): Where => (page) => page.getByRole("navigation", { name: "Intake" }).getByRole("link", { name, exact: true });
const importAList: Where = (page) => page.getByRole("link", { name: "Import a list", exact: true }).first();

interface Hop {
  label: string;
  click: Where;
  path: RegExp;
  /** The destination's own h2 — present only once its page has mounted. */
  heading: string;
  /** What must now be marked current, if anything. */
  current?: Where;
}

const to = (name: string, path: RegExp, heading = name): Hop => ({ label: name, click: section(name), path, heading, current: section(name) });

const WALK: readonly Hop[] = [
  to("Inventory", /\/admin\/inventory$/),
  to("Maintenance", /\/admin\/maintenance$/),
  to("Corrections", /\/admin\/corrections$/),
  to("Notion mirror", /\/admin\/mirror$/),
  to("Intake", /\/admin\/intake$/),
  { label: "Intake › Imports", click: tab("Imports"), path: /\/admin\/intake\/imports$/, heading: "Intake", current: tab("Imports") },
  { label: "Import a list", click: importAList, path: /\/admin\/intake\/imports\/new$/, heading: "Intake", current: section("Intake") },
  { label: "Intake › Queue", click: tab("Queue"), path: /\/admin\/intake$/, heading: "Intake", current: tab("Queue") },
  to("Refresh research", /\/admin\/refresh$/),
  to("Manuals", /\/admin\/research$/),
  to("People", /\/admin\/users$/),
  to("Projects", /\/admin\/projects$/),
  to("Overview", /\/admin$/),
  // …and back the other way, so each page is also left for a different neighbour.
  to("Projects", /\/admin\/projects$/),
  to("People", /\/admin\/users$/),
  to("Notion mirror", /\/admin\/mirror$/),
  to("Refresh research", /\/admin\/refresh$/),
  to("Intake", /\/admin\/intake$/),
  to("Corrections", /\/admin\/corrections$/),
  to("Maintenance", /\/admin\/maintenance$/),
  to("Inventory", /\/admin\/inventory$/),
  to("Overview", /\/admin$/),
];

test("clicking through every admin section mounts each page within seconds", async ({ page, context, baseURL }) => {
  test.setTimeout(120_000);
  await signIn(context, DEMO_ACCOUNTS.superAdmin, baseURL);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Overview", level: 2 })).toBeVisible({ timeout: 15_000 });

  // A marker on the window: a hop that fell back to a full document load —
  // which would hide a stuck client navigation — wipes it.
  await page.evaluate(() => {
    (window as unknown as { __adminWalk?: boolean }).__adminWalk = true;
  });

  for (const hop of WALK) {
    await hop.click(page).click();
    await expect(page, `URL after ${hop.label}`).toHaveURL(hop.path, { timeout: HOP_TIMEOUT });
    await expect(
      page.getByRole("heading", { name: hop.heading, level: 2, exact: true }),
      `${hop.label} mounted`
    ).toBeVisible({ timeout: HOP_TIMEOUT });
    if (hop.current) await expect(hop.current(page), `${hop.label} marked current`).toHaveAttribute("aria-current", "page");
  }

  // Still the document the walk started in: every hop was a client navigation.
  expect(await page.evaluate(() => (window as unknown as { __adminWalk?: boolean }).__adminWalk)).toBe(true);
});

import { test, expect, type Page } from "@playwright/test";
import { DEMO_ACCOUNTS } from "../src/lib/db/demo-seed";
import { signIn } from "./utils/session";

/**
 * The header does not move between pages (public polish, owner request).
 *
 * The bar is laid out once, in the root layout, so the only thing that could
 * move it between routes is the page beneath it — and it did: a page that
 * does not scroll gave the bar the scrollbar's 8px back, and every link
 * slid sideways. Playwright hides scrollbars by default, which is exactly the
 * case where the bug cannot be seen, so this file launches with them shown.
 *
 * Every control in the header (its links, buttons and the search field) must
 * have the same box on every route, at a desktop and a phone width.
 */
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

const ROUTES = ["/", "/projects", "/about", "/tools/form-4", "/admin", "/admin/maintenance", "/admin/research"];

async function headerBoxes(page: Page): Promise<string> {
  return page.evaluate(() => {
    const header = document.querySelector("header.top-nav");
    if (!header) return "no header";
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height].map((n) => Math.round(n)).join(",");
    };
    const controls = Array.from(header.querySelectorAll("a, button, input, select")).map(
      (el) => `${el.getAttribute("aria-label") ?? el.textContent?.trim()}@${box(el)}`
    );
    return JSON.stringify({ header: box(header), controls });
  });
}

for (const [width, height] of [
  [1440, 900],
  [390, 844],
] as const) {
  test(`the header's boxes are identical on every page at ${width}px`, async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width, height });
    await signIn(context, DEMO_ACCOUNTS.superAdmin, baseURL);

    const seen: Array<[string, string]> = [];
    for (const route of ROUTES) {
      await page.goto(route);
      // The profile control resolves after mount; measure once it has.
      await expect(page.getByRole("button", { name: /signed in as/i })).toBeVisible({ timeout: 15_000 });
      await page.waitForLoadState("networkidle");
      seen.push([route, await headerBoxes(page)]);
    }
    const [, first] = seen[0];
    for (const [route, boxes] of seen) {
      expect(boxes, `header on ${route}`).toBe(first);
    }
  });
}

test("clicking between Tools, Projects and About does not move the bar", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: /primary/i });
  await expect(nav.getByRole("link", { name: "Tools" })).toBeVisible();
  const before = await headerBoxes(page);
  for (const name of ["Projects", "About", "Tools"]) {
    await nav.getByRole("link", { name }).click();
    await page.waitForLoadState("networkidle");
    expect(await headerBoxes(page), `after clicking ${name}`).toBe(before);
  }
});

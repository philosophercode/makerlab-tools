import { test, expect, type Page } from "@playwright/test";
import { DEMO_ACCOUNTS } from "../src/lib/db/demo-seed";
import { LOCALE_CODES } from "../src/i18n/config";
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

// 1024 and 1280 are the two ends of the tighter one-row bar (lg to xl,
// DESIGN.md §8.12); 390 is the compact bar, 1440 the full one.
for (const [width, height] of [
  [1440, 900],
  [1280, 800],
  [1024, 768],
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

/**
 * The one-row bar fits (DESIGN.md §8.12). Between the old 860px phone switch
 * and ~1180px the brand ran into the Tools link and "Sign in" wrapped. At
 * each one-row width, signed in and not: every control on one line, the
 * brand, the links and the controls apart, and nothing wider than its box.
 */
async function headerFits(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const header = document.querySelector("header.top-nav")!;
    const rect = (selector: string) => header.querySelector(selector)!.getBoundingClientRect();
    const [brand, nav, actions] = [rect(".brand-lockup"), rect(".primary-nav"), rect(".nav-actions")];
    // Either side of each other: in Arabic and Hebrew the row runs right to left.
    const apart = (a: DOMRect, b: DOMRect) => Math.round(Math.max(b.left - a.right, a.left - b.right));
    if (apart(brand, nav) < 8) problems.push(`brand meets the links (${apart(brand, nav)}px apart)`);
    if (apart(nav, actions) < 8) problems.push(`links meet the controls (${apart(nav, actions)}px apart)`);
    if (header.scrollWidth > header.clientWidth) problems.push(`header is ${header.scrollWidth}px in ${header.clientWidth}px`);
    for (const el of Array.from(header.querySelectorAll<HTMLElement>(".brand-lockup, .primary-nav > a, .primary-nav > button, .primary-nav-profile"))) {
      const label = el.getAttribute("aria-label") ?? el.textContent?.trim();
      // One line: a wrapped label is taller than its own line height allows.
      if (el.getClientRects().length > 1 || el.offsetHeight > 44) problems.push(`"${label}" wraps (${el.offsetHeight}px tall)`);
      if (el.scrollWidth > el.clientWidth + 1) problems.push(`"${label}" is clipped`);
    }
    return problems;
  });
}

for (const width of [1024, 1280]) {
  test(`the one-row bar fits at ${width}px, signed in and not`, async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await expect(page.getByRole("button", { name: /sign in with/i })).toBeVisible({ timeout: 15_000 });
    expect(await headerFits(page), "anonymous").toEqual([]);

    await signIn(context, DEMO_ACCOUNTS.superAdmin, baseURL);
    await page.goto("/admin");
    await expect(page.getByRole("button", { name: /signed in as/i })).toBeVisible({ timeout: 15_000 });
    expect(await headerFits(page), "signed in").toEqual([]);
  });
}

// Every language, because the long ones are what broke it: at 1280 the
// language select, as wide as "Português (Brasil)", pushed the bar past the
// window in Spanish and Russian (DESIGN.md §8.12).
for (const width of [1024, 1280]) {
  test(`the one-row bar fits at ${width}px in every language`, async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width, height: 800 });
    const failures: string[] = [];
    for (const locale of LOCALE_CODES) {
      await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: baseURL! }]);
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.locator(".primary-nav-auth")).toBeVisible({ timeout: 15_000 });
      const problems = await headerFits(page);
      if (problems.length) failures.push(`${locale}: ${problems.join("; ")}`);
    }
    expect(failures).toEqual([]);
  });
}

/**
 * No horizontal page scroll, at any width (DESIGN.md §6, §8.15): a wide thing
 * scrolls inside itself. The inventory's table is wider than 1024px's column
 * even with the two demo tools, so it is the case that used to fail.
 */
const OVERFLOW_ROUTES = [
  "/",
  "/?view=table",
  "/tools/form-4",
  "/projects",
  "/admin",
  "/admin/inventory",
  "/admin/refresh",
  "/admin/maintenance",
  "/admin/corrections",
  "/admin/users",
  "/admin/mirror",
];

for (const [width, height] of [
  [390, 844],
  [1024, 768],
  [1440, 900],
] as const) {
  for (const route of OVERFLOW_ROUTES) {
    test(`${route} does not scroll sideways at ${width}px`, async ({ page, context, baseURL }) => {
      await page.setViewportSize({ width, height });
      await signIn(context, DEMO_ACCOUNTS.superAdmin, baseURL);
      await page.goto(route);
      // The profile control resolves after hydration, when every measured
      // layout (a table's frame) has had its first pass.
      await expect(page.getByRole("button", { name: /signed in as/i })).toBeVisible({ timeout: 15_000 });
      const excess = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await expect.poll(excess, { message: `${route} is wider than the page` }).toBeLessThanOrEqual(0);
    });
  }
}

test("a table wider than its column scrolls inside itself; one that fits keeps its sticky header", async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context, DEMO_ACCOUNTS.superAdmin, baseURL);
  const frame = page.locator("[data-slot=data-table-frame]");
  const toolHeader = page.getByRole("columnheader", { name: /^Tool/ });

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/admin/inventory");
  await expect(toolHeader).toBeVisible();
  const narrow = await frame.evaluate((el) => ({ overflow: getComputedStyle(el).overflowX, wider: el.scrollWidth > el.clientWidth }));
  expect(narrow).toEqual({ overflow: "auto", wider: true });
  await expect(toolHeader).toHaveCSS("position", "static");

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(toolHeader).toHaveCSS("position", "sticky");
  expect(await frame.evaluate((el) => getComputedStyle(el).overflowX)).toBe("visible");
});

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

test("opening ⌘K does not push the page sideways", async ({ page, context, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(context, DEMO_ACCOUNTS.superAdmin, baseURL);
  await page.goto("/");
  await expect(page.getByRole("button", { name: /signed in as/i })).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState("networkidle");
  const before = await headerBoxes(page);

  // The dialog's scroll lock must not add scrollbar compensation: the root
  // always keeps its scrollbar, so any padding would shift every control left.
  await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.body).paddingRight)).toBe("0px");
  expect(await headerBoxes(page)).toBe(before);
});

test("opening the assistant does not push the page sideways (UI system phase 5b)", async ({ page, context, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(context, DEMO_ACCOUNTS.superAdmin, baseURL);
  for (const route of ["/", "/admin"]) {
    await page.goto(route);
    await expect(page.getByRole("button", { name: /signed in as/i })).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState("networkidle");
    const before = await headerBoxes(page);

    // Public pages open it from the floating button; admin pages from the section bar.
    const opener =
      route === "/"
        ? page.getByRole("button", { name: "Open MakerLab assistant" })
        : page.getByRole("navigation", { name: "Admin sections" }).getByRole("button", { name: "Ask the assistant" });
    await opener.click();
    const sheet = page.getByRole("dialog", { name: "MAKERLAB ASSISTANT" });
    await expect(sheet).toBeVisible();
    expect(await page.evaluate(() => getComputedStyle(document.body).paddingRight)).toBe("0px");
    expect(await headerBoxes(page), `header with the assistant open on ${route}`).toBe(before);
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
  }
});

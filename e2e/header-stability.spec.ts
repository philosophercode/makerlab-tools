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

/**
 * The header is drawn and its identity has answered: the profile control
 * (signed in) or Sign in (not) exists. Attached rather than visible — on the
 * phone bar both sit in MENU and the bar's own copy is not drawn (DESIGN.md
 * §8.12, "The phone bar") — so the header itself must be visible too: in a
 * language other than the prerendered one the page draws nothing for a moment
 * after it loads, and every box measures 0.
 */
async function identityResolved(page: Page, signedIn: boolean) {
  await expect(page.locator(signedIn ? ".primary-nav-profile" : ".primary-nav-auth")).toBeAttached({ timeout: 15_000 });
  await expect(page.locator("header.top-nav")).toBeVisible();
}

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
// DESIGN.md §8.12); 390 is the phone bar, 1440 the full one, 844 × 390 the
// short bar (a phone on its side).
for (const [width, height] of [
  [1440, 900],
  [1280, 800],
  [1024, 768],
  [390, 844],
  [844, 390],
] as const) {
  test(`the header's boxes are identical on every page at ${width}×${height}`, async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width, height });
    await signIn(context, DEMO_ACCOUNTS.superAdmin, baseURL);

    const seen: Array<[string, string]> = [];
    for (const route of ROUTES) {
      await page.goto(route);
      // The profile control resolves after mount; measure once it has.
      await identityResolved(page, true);
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
    // The links (and ADMIN) sit in `.primary-nav-links` (the short bar's MENU
    // panel, `display: contents` everywhere else); on the short bar they are
    // hidden until MENU opens, so they measure nothing here.
    const controls = ".brand-lockup, .primary-nav > a, .primary-nav > button, .primary-nav-links > a, .primary-nav-links > button, .primary-nav-profile";
    for (const el of Array.from(header.querySelectorAll<HTMLElement>(controls))) {
      const label = el.getAttribute("aria-label") ?? el.textContent?.trim();
      // One line: a wrapped label is taller than its own line height allows.
      const tallest = el.classList.contains("brand-lockup") ? 76 : 44;
      if (el.getClientRects().length > 1 || el.offsetHeight > tallest) problems.push(`"${label}" wraps (${el.offsetHeight}px tall)`);
      if (el.scrollWidth > el.clientWidth + 1) problems.push(`"${label}" is clipped`);
    }
    return problems;
  });
}

const FIT_SIZES = [
  ["one-row", 1024, 800],
  ["one-row", 1280, 800],
  ["one-row", 1440, 800],
  ["short", 844, 390],
  ["phone", 390, 844],
  ["phone", 360, 740],
] as const;

for (const [bar, width, height] of FIT_SIZES) {
  test(`the ${bar} bar fits at ${width}×${height}, signed in and not`, async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await identityResolved(page, false);
    expect(await headerFits(page), "anonymous").toEqual([]);

    await signIn(context, DEMO_ACCOUNTS.superAdmin, baseURL);
    await page.goto("/admin");
    await identityResolved(page, true);
    expect(await headerFits(page), "signed in").toEqual([]);
  });
}

/**
 * The wordmark is the dominant brand mark, at the Director's mockup's size
 * (identity spec, amendment "Wordmark at the mockup's size"): about a fifth of
 * a 1440px page, smaller but still large on a phone. The bar is exactly
 * --nav-height, so the sticky status strip and table headers sit under it, and
 * the links stay centred.
 */
for (const [width, height, wordmarkHeight] of [
  [1440, 900, 48],
  [1280, 800, 40],
  [1024, 768, 30],
  [810, 1080, 36],
  [390, 844, 30],
  [844, 390, 24],
] as const) {
  test(`the wordmark is ${wordmarkHeight}px tall at ${width}×${height} and the bar fits it`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await identityResolved(page, false);
    const m = await page.evaluate(() => {
      const box = (s: string) => document.querySelector(s)!.getBoundingClientRect();
      const header = document.querySelector<HTMLElement>("header.top-nav")!;
      const nav = box(".primary-nav");
      return {
        wordmark: { width: Math.round(box(".brand-wordmark").width), height: Math.round(box(".brand-wordmark").height) },
        headerHeight: Math.round(header.getBoundingClientRect().height),
        navHeight: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--nav-height")),
        clipped: header.scrollHeight > header.clientHeight,
        navCentre: Math.round(nav.left + nav.width / 2 - document.documentElement.clientWidth / 2),
      };
    });
    expect(m.wordmark.height).toBe(wordmarkHeight);
    // The official lettering's own aspect ratio, 112.5 × 19.4.
    expect(Math.abs(m.wordmark.width - Math.round((wordmarkHeight * 112.5) / 19.4))).toBeLessThanOrEqual(1);
    expect(m.headerHeight).toBe(m.navHeight);
    expect(m.clipped).toBe(false);
    if (width >= 1024) expect(Math.abs(m.navCentre)).toBeLessThanOrEqual(1);
  });
}

// Every language, because the long ones are what broke it: at 1280 the
// language select, as wide as "Português (Brasil)", pushed the bar past the
// window in Spanish and Russian (DESIGN.md §8.12).
for (const [bar, width, height] of FIT_SIZES) {
  test(`the ${bar} bar fits at ${width}×${height} in every language`, async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width, height });
    const failures: string[] = [];
    for (const locale of LOCALE_CODES) {
      await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: baseURL! }]);
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await identityResolved(page, false);
      const problems = await headerFits(page);
      if (problems.length) failures.push(`${locale}: ${problems.join("; ")}`);
    }
    expect(failures).toEqual([]);
  });
}

// And signed in, since 2026-10-07: ADMIN and the profile control take the
// place of REPORT and SIGN IN (identity spec amendment "ADMIN in the bar").
// A SuperMaker is the least role that sees ADMIN. One load per language, then
// every size by resizing: the bar is laid out by CSS alone, and twelve loads
// rather than forty-eight keep this account's identity calls well inside
// `/api/identity`'s limit while the rest of the suite runs beside it.
test("the bar fits in every language signed in as a SuperMaker, at every one-row width, the short bar and the phone bar", async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context, DEMO_ACCOUNTS.admin, baseURL);
  const failures: string[] = [];
  for (const locale of LOCALE_CODES) {
    await page.setViewportSize({ width: FIT_SIZES[0][1], height: FIT_SIZES[0][2] });
    await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: baseURL! }]);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.locator(".primary-nav-profile")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".primary-nav-admin")).toBeVisible();
    for (const [bar, width, height] of FIT_SIZES) {
      await page.setViewportSize({ width, height });
      await page.waitForFunction((w) => window.innerWidth === w, width);
      // On the short and phone bars ADMIN is behind MENU and measures nothing.
      if (bar === "one-row") await expect(page.locator(".primary-nav-admin")).toBeVisible();
      const problems = await headerFits(page);
      if (problems.length) failures.push(`${locale} at ${width}×${height}: ${problems.join("; ")}`);
    }
  }
  expect(failures).toEqual([]);
});

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
  [844, 390],
  [1024, 768],
  [1440, 900],
] as const) {
  for (const route of OVERFLOW_ROUTES) {
    test(`${route} does not scroll sideways at ${width}×${height}`, async ({ page, context, baseURL }) => {
      await page.setViewportSize({ width, height });
      await signIn(context, DEMO_ACCOUNTS.superAdmin, baseURL);
      await page.goto(route);
      // The profile control resolves after hydration, when every measured
      // layout (a table's frame) has had its first pass.
      await identityResolved(page, true);
      const excess = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await expect.poll(excess, { message: `${route} is wider than the page` }).toBeLessThanOrEqual(0);
    });
  }
}

/**
 * No horizontal page scroll on a phone in any language (DESIGN.md §6). On the
 * home page, Categories | All tools and Filters were one unbreakable line:
 * "Todas las herramientas" pushed the page 72px sideways at 320 and 2px at 390
 * in Spanish (Portuguese, French and Russian too). The row wraps now, and the
 * sign-up buttons wrap where a translation is wider than a small phone. One
 * load per language and page, every width by resizing.
 */
test("the home page, About and the sign-up do not scroll sideways on a phone in any language", async ({ page, context, baseURL }) => {
  const failures: string[] = [];
  for (const locale of LOCALE_CODES) {
    await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: baseURL! }]);
    for (const route of ["/", "/about", "/demo"]) {
      await page.setViewportSize({ width: 320, height: 700 });
      await page.goto(route);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await identityResolved(page, false);
      for (const width of [320, 360, 390]) {
        await page.setViewportSize({ width, height: 700 });
        await page.waitForFunction((w) => window.innerWidth === w, width);
        const excess = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (excess > 0) failures.push(`${locale} ${route} at ${width}: ${excess}px too wide`);
      }
    }
  }
  expect(failures).toEqual([]);
});

/**
 * A phone on its side (DESIGN.md §8.12, amendment "A phone on its side"). The
 * compact bar and the status strip took 159px of a 390px screen, and the bar
 * stayed pinned. On a short viewport the bar is one 48px row with the links
 * behind MENU, and nothing sticks: the bar and the strip scroll away.
 */
for (const [width, height] of [
  [844, 390],
  [932, 430],
] as const) {
  test(`at ${width}×${height} the bar is one short row that scrolls away`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/tools/form-4");
    await identityResolved(page, false);

    const top = await page.evaluate(() => {
      const header = document.querySelector<HTMLElement>("header.top-nav")!;
      const strip = document.querySelector<HTMLElement>(".status-strip")!;
      return {
        header: Math.round(header.getBoundingClientRect().height),
        headerPosition: getComputedStyle(header).position,
        stripPosition: getComputedStyle(strip).position,
        stickyChrome: getComputedStyle(document.documentElement).getPropertyValue("--sticky-chrome-height").trim(),
      };
    });
    expect(top).toEqual({ header: 48, headerPosition: "relative", stripPosition: "static", stickyChrome: "0px" });
    // The breadcrumb stays (owner decision).
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, 400));
    await expect
      .poll(() => page.evaluate(() => document.querySelector(".status-strip")!.getBoundingClientRect().bottom))
      .toBeLessThanOrEqual(0);
  });
}

test("on a phone on its side MENU holds the links: Tab walks them, Escape returns to the button", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/tools/form-4");
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  const menu = nav.getByRole("button", { name: "MENU" });
  await expect(menu).toBeVisible({ timeout: 15_000 });
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(nav.getByRole("link", { name: "PROJECTS" })).toBeHidden();

  await menu.focus();
  await page.keyboard.press("Enter");
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  for (const name of ["TOOLS", "MAP", "PROJECTS", "ABOUT"]) {
    await page.keyboard.press("Tab");
    await expect(nav.getByRole("link", { name, exact: true })).toBeFocused();
  }
  // Every row inside the screen, and a touch row tall. (The account, language
  // and theme rows MENU holds on a phone are not drawn here: the short bar keeps
  // those controls in the bar.)
  const rows = await nav.locator(".primary-nav-links > a").evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { inside: r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, tall: r.height >= 40 };
    })
  );
  // TOOLS, MAP, PROJECTS, ABOUT — REPORT left the bar on 2026-10-07, and ADMIN
  // is only for those who can reach /admin.
  expect(rows).toEqual(Array(4).fill({ inside: true, tall: true }));

  await page.keyboard.press("Escape");
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeFocused();
  await expect(nav.getByRole("link", { name: "PROJECTS" })).toBeHidden();

  // Following a link closes it.
  await menu.click();
  await nav.getByRole("link", { name: "PROJECTS" }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(menu).toHaveAttribute("aria-expanded", "false");

  // On a tablet, the links are back in the bar and MENU is gone. (Upright on
  // a phone MENU stays: the phone bar, below.)
  await page.setViewportSize({ width: 810, height: 1080 });
  await expect(menu).toBeHidden();
  await expect(nav.getByRole("link", { name: "PROJECTS" })).toBeVisible();
});

/**
 * The phone bar (DESIGN.md §8.12, amendment "The phone bar", owner request
 * 2026-10-10). The compact bar was two rows — the lockup and five controls,
 * then the links — on a phone. Below sm it is one 56px row that still sticks:
 * the lockup, the search icon and MENU (☰). MENU holds the links and ADMIN,
 * the account, the language and the theme.
 */
test("on a phone the bar is the lockup, search and MENU; MENU holds the rest", async ({ page, context, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(context, DEMO_ACCOUNTS.superAdmin, baseURL);
  await page.goto("/tools/form-4");
  await identityResolved(page, true);

  const header = page.locator("header.top-nav");
  const shown = await header.evaluate((el) => {
    const visible = (c: Element) => {
      const r = c.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(c).visibility !== "hidden";
    };
    return {
      controls: Array.from(el.querySelectorAll("a, button, select")).filter(visible).map((c) => c.getAttribute("aria-label") ?? c.textContent?.trim()),
      height: Math.round(el.getBoundingClientRect().height),
      position: getComputedStyle(el).position,
    };
  });
  // In document order; on screen the search icon sits before MENU, which ends the row.
  expect(shown).toEqual({ controls: ["MakerLAB AI", "MENU", "Search tools and pages"], height: 56, position: "sticky" });

  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  const menu = nav.getByRole("button", { name: "MENU" });
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  const panel = page.locator(`#${await menu.getAttribute("aria-controls")}`);
  for (const name of ["TOOLS", "MAP", "PROJECTS", "ABOUT", "ADMIN", "ACCOUNT", "CONNECT AI ASSISTANT (MCP)"]) {
    await expect(panel.getByRole("link", { name, exact: true })).toBeVisible();
  }
  await expect(panel.getByRole("button", { name: "SIGN OUT" })).toBeVisible();
  await expect(panel.getByRole("combobox", { name: "Select language" })).toBeVisible();
  await expect(panel.getByRole("button", { name: /color theme/i })).toBeVisible();
  // The bar's own language and theme controls are not drawn.
  await expect(page.locator(".nav-actions").getByRole("combobox", { name: "Select language" })).toBeHidden();

  // The panel spans the screen under the bar, every row a touch row.
  const rows = await panel.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const tall = Array.from(el.querySelectorAll("a, button, label")).every((c) => c.getBoundingClientRect().height >= 40);
    // Its top border sits on the bar's bottom one.
    const under = Math.abs(r.top - document.querySelector("header.top-nav")!.getBoundingClientRect().bottom) <= 1;
    return { left: Math.round(r.left), right: Math.round(r.right), under, tall };
  });
  expect(rows).toEqual({ left: 0, right: await page.evaluate(() => document.documentElement.clientWidth), under: true, tall: true });

  // The theme changes from it.
  const before = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  await panel.getByRole("button", { name: /color theme/i }).click();
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).not.toBe(before);

  await page.keyboard.press("Escape");
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(panel.getByRole("link", { name: "PROJECTS" })).toBeHidden();

  // Wider than a phone, MENU is gone and the bar is the compact bar again.
  await menu.click();
  await page.setViewportSize({ width: 810, height: 1080 });
  await expect(menu).toBeHidden();
  // Hidden, MENU has no role to find it by.
  await expect(page.locator(".primary-nav-menu-toggle")).toHaveAttribute("aria-expanded", "false");
  await expect(nav.getByRole("link", { name: "PROJECTS" })).toBeVisible();
});

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
        ? page.getByRole("button", { name: "Open MakerLAB AI" })
        : page.getByRole("navigation", { name: "Admin sections" }).getByRole("button", { name: "Ask MakerLAB AI" });
    await opener.click();
    const sheet = page.getByRole("dialog", { name: "MakerLAB AI" });
    await expect(sheet).toBeVisible();
    expect(await page.evaluate(() => getComputedStyle(document.body).paddingRight)).toBe("0px");
    expect(await headerBoxes(page), `header with the assistant open on ${route}`).toBe(before);
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
  }
});

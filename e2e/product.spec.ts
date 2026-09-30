import { test, expect, type Page } from "@playwright/test";

/**
 * `/product` and `/product/quick-start` in a browser (identity spec amendment
 * 2026-09-28 "Product page and quick start"): reachable from the footer and
 * the About page, every screenshot actually loads, the video and its
 * captions are served, and a phone gets no sideways scroll.
 */

async function expectImagesLoaded(page: Page, root: string) {
  // Lazy images load when scrolled to: bring each one into view, then check it decoded.
  // Scoped to the page's own root: a client navigation keeps the previous route in the
  // DOM, hidden (cacheComponents), so an unscoped query would find its images too.
  const images = page.locator(`${root} figure[data-slot="product-shot"] img`);
  const count = await images.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    await images.nth(i).scrollIntoViewIfNeeded();
    await expect.poll(() => images.nth(i).evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  }
}

test("the footer leads to the product page, which offers Try it on the X1-Carbon", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("contentinfo").getByRole("link", { name: "Product" }).click();
  await expect(page).toHaveURL(/\/product$/);
  await expect(page.getByRole("heading", { level: 1, name: "MakerLAB AI" })).toBeVisible();
  await expect(page).toHaveTitle("MakerLAB AI · MakerLAB Tools");
  await expect(page.getByRole("link", { name: "Try it" }).first()).toHaveAttribute("href", "/tools/bambu-lab-x1-carbon-combo-3d-printer?ask=1");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/product\/og\.png$/);
});

test("every screenshot loads, and the video, poster and captions are served", async ({ page, request }) => {
  await page.goto("/product");
  await expectImagesLoaded(page, "[data-slot='product-page']");

  const video = page.locator("video");
  await expect(video).toHaveAttribute("preload", "none");
  for (const url of ["/product/walkthrough.mp4", "/product/walkthrough.webm", "/product/walkthrough-poster.webp", "/product/walkthrough.en.vtt", "/product/og.png"]) {
    const response = await request.get(url);
    expect(response.status(), url).toBe(200);
  }
  expect(await (await request.get("/product/walkthrough.en.vtt")).text()).toMatch(/^WEBVTT/);
});

test("Quick start from the product page: eight steps with screenshots, then things to try", async ({ page }) => {
  await page.goto("/product");
  await page.getByRole("link", { name: "Quick start" }).first().click();
  await expect(page).toHaveURL(/\/product\/quick-start$/);
  await expect(page.getByRole("heading", { level: 1, name: "Quick start" })).toBeVisible();
  await expect(page.locator("[data-step]")).toHaveCount(8);
  await expect(page.getByRole("region", { name: "Things to try" }).getByRole("link")).toHaveCount(7);
  await expectImagesLoaded(page, "ol:has(> [data-step])");
});

test("About links both pages", async ({ page }) => {
  await page.goto("/about");
  await page.getByRole("link", { name: "Quick start guide" }).click();
  await expect(page).toHaveURL(/\/product\/quick-start$/);
  await page.goto("/about");
  await page.getByRole("link", { name: "What MakerLAB Tools can do" }).click();
  await expect(page).toHaveURL(/\/product$/);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  for (const path of ["/product", "/product/quick-start"]) {
    test(`${path} has no sideways scroll`, async ({ page }) => {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});

test("the kiosk draws no footer", async ({ page }) => {
  await page.goto("/kiosk");
  await expect(page.locator("[data-slot='site-footer']")).toHaveCount(0);
});

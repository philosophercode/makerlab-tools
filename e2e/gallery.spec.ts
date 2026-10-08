import { test, expect } from "@playwright/test";

// The app boots with DATABASE_URL and NOTION_* unset (see playwright.config.ts
// webServer.env), so getCatalogTools() serves the PGlite demo seed
// (src/lib/db/demo-seed.ts): "Form 4" (3D Printing) and "Trotec Speedy 400"
// (Laser Cutting & Engraving).
//
// The home page (student home spec 2026-10-07, amendment "One page: the list
// at rest", revised): "MakerLAB AI", the search, a quiet row — Categories |
// All tools and Filters — then the category tiles, a category's tools, or
// all tools grouped by category. Typing swaps the view for the matches.
// /tools redirects here.

const SEARCH = "Search tools, or ask MakerLAB AI a question";

test.describe("Student home at rest", () => {
  test("is headed MakerLAB AI and rests on the category tiles, the filters closed", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "MakerLAB AI", level: 1 })).toBeVisible();
    const tiles = page.getByRole("list", { name: "Categories" });
    await expect(tiles.getByRole("heading", { name: "3D Printing", level: 2 })).toBeVisible();
    await expect(tiles.getByRole("heading", { name: "Laser Cutting & Engraving", level: 2 })).toBeVisible();
    await expect(page.getByRole("group", { name: "Browse" }).getByRole("button", { name: "Categories" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Filters", exact: true })).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("search", { name: "Filter the tools" })).toHaveCount(0);
  });

  test("the header's lockup steps aside on the home page only", async ({ page }) => {
    await page.goto("/");
    const brand = page.locator("header .brand-lockup");
    await expect(brand).toHaveAttribute("data-concealed", "");
    await expect(brand).toHaveCSS("opacity", "0");
    await page.goto("/about");
    await expect(page.locator("header .brand-lockup")).not.toHaveAttribute("data-concealed", "");
    await expect(page.locator("header .brand-lockup")).toHaveCSS("opacity", "1");
  });

  test("a tile opens its category's tools on the page, and All categories goes back", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("list", { name: "Categories" }).getByRole("link", { name: /3D Printing/ }).click();
    await expect(page).toHaveURL(/\/\?category=3D\+Printing$/);
    await expect(page.getByRole("heading", { name: "3D Printing", level: 2 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Form 4", level: 3 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Trotec Speedy 400", level: 3 })).toHaveCount(0);
    await page.getByRole("button", { name: "All categories" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("list", { name: "Categories" })).toBeVisible();
  });

  test("All tools shows every tool grouped by category, each card linking to its page", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("group", { name: "Browse" }).getByRole("button", { name: "All tools" }).click();
    await expect(page).toHaveURL(/\/\?show=all$/);
    await expect(page.getByRole("region", { name: /3D Printing/ }).getByRole("heading", { name: "Form 4", level: 3 })).toBeVisible();
    await expect(page.getByRole("region", { name: /Laser Cutting & Engraving/ }).getByRole("heading", { name: "Trotec Speedy 400", level: 3 })).toBeVisible();
    const formCard = page.getByRole("link").filter({ has: page.getByRole("heading", { name: "Form 4", level: 3 }) });
    await expect(formCard).toHaveAttribute("href", "/tools/form-4");
  });

  test("Filters opens the panel: the list's controls and its count", async ({ page }) => {
    await page.goto("/?show=all");
    const button = page.getByRole("button", { name: "Filters", exact: true });
    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    const panel = page.getByRole("search", { name: "Filter the tools" });
    await expect(panel.getByText("Showing 2 of 2")).toBeVisible();
    await panel.getByRole("button", { name: /^Category/ }).click();
    await page.getByRole("menuitemradio", { name: /^Laser/ }).click();
    await expect(page).toHaveURL(/category=Laser/);
    await expect(page.getByRole("button", { name: "Filters, 1 set" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Form 4", level: 3 })).toHaveCount(0);
  });

  test("shows the catalog status strip count", async ({ page }) => {
    await page.goto("/");
    // GlobalChrome status strip renders status.toolsInInventory:
    // "{count} TOOLS IN INVENTORY" with count=2 (the demo seed has 2 tools).
    await expect(page.getByText("2 TOOLS IN INVENTORY")).toBeVisible();
  });
});

test.describe("Student home: searching", () => {
  test("typing swaps the tiles for the matching tools, and clearing brings them back", async ({ page }) => {
    await page.goto("/");
    const search = page.getByRole("combobox", { name: SEARCH });
    await search.fill("speedy");
    await expect(page.getByRole("region", { name: /Results for “speedy”/ }).getByRole("heading", { name: "Trotec Speedy 400", level: 3 })).toBeVisible();
    await expect(page.getByRole("list", { name: "Categories" })).toHaveCount(0);
    await expect(page).toHaveURL(/\?q=speedy$/);
    // The box's own list keeps the Ask row, and says what Enter opens.
    await expect(page.getByRole("option", { name: /Ask MakerLAB AI: “speedy”/ })).toBeVisible();
    await expect(page.getByText("Enter opens Trotec Speedy 400")).toBeVisible();

    await page.getByRole("button", { name: "Clear the search" }).click();
    await expect(page.getByRole("list", { name: "Categories" })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test("Enter opens the first result", async ({ page }) => {
    await page.goto("/");
    const search = page.getByRole("combobox", { name: SEARCH });
    await search.fill("speedy");
    await expect(page.getByRole("heading", { name: "Trotec Speedy 400", level: 3 })).toBeVisible();
    await search.press("Enter");
    await expect(page).toHaveURL(/\/tools\/trotec-speedy-400$/);
  });

  test("Enter sends nothing to MakerLAB AI when nothing matches", async ({ page }) => {
    await page.goto("/");
    const search = page.getByRole("combobox", { name: SEARCH });
    await search.fill("how do I load filament");
    await expect(page.getByText("No tool or category matches “how do I load filament”.")).toBeVisible();
    await search.press("Enter");
    await expect(page.getByRole("dialog", { name: "MakerLAB AI" })).toHaveCount(0);
    await expect(page).toHaveURL(/\/\?q=how/);
  });
});

test.describe("Old links", () => {
  test("/tools lands on the home page", async ({ page }) => {
    await page.goto("/tools");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "MakerLAB AI", level: 1 })).toBeVisible();
  });

  test("a /tools link to a category opens that category", async ({ page }) => {
    await page.goto("/tools?category=3D%20Printing");
    await expect(page).toHaveURL(/\/\?category=3D(%20|\+)Printing$/);
    await expect(page.getByRole("heading", { name: "3D Printing", level: 2 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Form 4", level: 3 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Trotec Speedy 400", level: 3 })).toHaveCount(0);
  });
});

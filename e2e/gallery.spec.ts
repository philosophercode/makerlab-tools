import { test, expect } from "@playwright/test";

// The app boots with DATABASE_URL and NOTION_* unset (see playwright.config.ts
// webServer.env), so getCatalogTools() serves the PGlite demo seed
// (src/lib/db/demo-seed.ts): "Form 4" (3D Printing) and "Trotec Speedy 400"
// (Laser Cutting & Engraving).
//
// The student home (spec 2026-10-07): "/" shows the categories and the smart
// search; the full list of tools is "/tools".

test.describe("Student home", () => {
  test("is titled Tools and browses by category", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Tools", exact: true, level: 1 })).toBeVisible();
    const tiles = page.getByRole("list", { name: "Tools" });
    await expect(tiles.getByRole("heading", { name: "3D Printing", level: 2 })).toBeVisible();
    await expect(tiles.getByRole("heading", { name: "Laser Cutting & Engraving", level: 2 })).toBeVisible();
    await expect(page.getByText(/what do you want to make/i)).toHaveCount(0);
  });

  test("a category tile opens the full list filtered to it", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link").filter({ has: page.getByRole("heading", { name: "3D Printing", level: 2 }) }).click();
    await expect(page).toHaveURL(/\/tools\?category=3D\+Printing$/);
    await expect(page.getByRole("heading", { name: "Form 4", level: 2 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Trotec Speedy 400", level: 2 })).toHaveCount(0);
  });

  test("the smart search opens the first match on Enter", async ({ page }) => {
    await page.goto("/");
    const search = page.getByRole("combobox", { name: "Search tools, or ask MakerLAB AI a question" });
    await search.fill("speedy");
    await expect(page.getByRole("option", { name: /Trotec Speedy 400/ })).toBeVisible();
    await expect(page.getByRole("option", { name: /Ask MakerLAB AI: “speedy”/ })).toBeVisible();
    await search.press("Enter");
    await expect(page).toHaveURL(/\/tools\/trotec-speedy-400$/);
  });

  test("Enter sends nothing to MakerLAB AI when nothing matches", async ({ page }) => {
    await page.goto("/");
    const search = page.getByRole("combobox", { name: "Search tools, or ask MakerLAB AI a question" });
    await search.fill("how do I load filament");
    await expect(page.getByText("No tool or category matches “how do I load filament”.")).toBeVisible();
    await search.press("Enter");
    await expect(page.getByRole("dialog", { name: "MakerLAB AI" })).toHaveCount(0);
    await expect(page).toHaveURL(/\/$/);
  });

  test("See all tools opens the full list", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /See all 2 tools/ }).first().click();
    await expect(page).toHaveURL(/\/tools$/);
    await expect(page.getByRole("heading", { name: "All tools", level: 1 })).toBeVisible();
  });

  test("an old link to a filtered home page lands on the full list", async ({ page }) => {
    await page.goto("/?category=3D%20Printing");
    await expect(page).toHaveURL(/\/tools\?category=3D(%20|\+)Printing$/);
  });

  test("shows the catalog status strip count", async ({ page }) => {
    await page.goto("/");
    // GlobalChrome status strip renders status.toolsInInventory:
    // "{count} TOOLS IN INVENTORY" with count=2 (the demo seed has 2 tools).
    await expect(page.getByText("2 TOOLS IN INVENTORY")).toBeVisible();
  });
});

test.describe("All tools", () => {
  test("loads at /tools and shows the demo-catalogue tools", async ({ page }) => {
    await page.goto("/tools");
    await expect(page.getByRole("heading", { name: "All tools", exact: true })).toBeVisible();
    // Both tools render as cards (ToolCard renders an <h2> with the name).
    await expect(page.getByRole("heading", { name: "Form 4", level: 2 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Trotec Speedy 400", level: 2 })).toBeVisible();
    await expect(page.getByText("Showing 2 of 2")).toBeVisible();
  });

  test("each tool card links to its detail route", async ({ page }) => {
    await page.goto("/tools");
    const formCard = page.getByRole("link").filter({
      has: page.getByRole("heading", { name: "Form 4", level: 2 }),
    });
    await expect(formCard).toHaveAttribute("href", "/tools/form-4");
  });
});

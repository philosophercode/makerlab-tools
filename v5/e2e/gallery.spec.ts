import { test, expect } from "@playwright/test";

// The app boots with NOTION_* unset (see playwright.config.ts webServer.env),
// so getCatalogTools() serves the built-in mock catalog
// (src/components/mock-catalog.ts): "Form 4" and "Trotec Speedy 400".

test.describe("Gallery", () => {
  test("loads at / and shows the mock-catalog tools", async ({ page }) => {
    await page.goto("/");

    // Gallery heading from messages/en.json gallery.title => "TOOLS // MACHINES".
    await expect(
      page.getByRole("heading", { name: "TOOLS // MACHINES" })
    ).toBeVisible();

    // Both mock tools render as cards (ToolCard renders an <h2> with the name).
    await expect(
      page.getByRole("heading", { name: "Form 4", level: 2 })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Trotec Speedy 400", level: 2 })
    ).toBeVisible();
  });

  test("each tool card links to its detail route", async ({ page }) => {
    await page.goto("/");

    const formCard = page.getByRole("link").filter({
      has: page.getByRole("heading", { name: "Form 4", level: 2 }),
    });
    await expect(formCard).toHaveAttribute("href", "/tools/form-4");
  });

  test("shows the catalog status strip count", async ({ page }) => {
    await page.goto("/");
    // GlobalChrome status strip renders status.toolsInInventory:
    // "{count} TOOLS IN INVENTORY" with count=2 (mock catalog has 2 tools).
    await expect(page.getByText("2 TOOLS IN INVENTORY")).toBeVisible();
  });
});

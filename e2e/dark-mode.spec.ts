import { test, expect } from "@playwright/test";

// Guards the tool-detail dark-mode work (#23). The ThemeToggle cycles
// system → light → dark; we click until the explicit dark theme is active,
// then assert the dark design tokens actually resolve on a tool-detail page.
// This protects the token wiring (not every pixel) from regressions.

const DARK_BACKGROUND = "#0f0f0f"; // --background under [data-theme="dark"]

async function cycleToDark(page: import("@playwright/test").Page) {
  const toggle = page.getByRole("button", {
    name: "Cycle color theme (system → light → dark)",
  });
  // At most 3 clicks reaches "dark" from any starting point in the cycle.
  for (let i = 0; i < 3; i++) {
    const theme = await page.evaluate(() =>
      document.documentElement.getAttribute("data-theme")
    );
    if (theme === "dark") return;
    await toggle.click();
  }
}

test.describe("Dark mode", () => {
  test("tool-detail page resolves dark design tokens when dark is active", async ({
    page,
  }) => {
    await page.goto("/tools/form-4");
    await expect(
      page.getByRole("heading", { name: "Form 4", level: 1 })
    ).toBeVisible();

    await cycleToDark(page);

    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    const background = await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--background")
        .trim()
    );
    expect(background).toBe(DARK_BACKGROUND);
  });

  test("dark theme persists across a reload", async ({ page }) => {
    await page.goto("/tools/form-4");
    await cycleToDark(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });
});

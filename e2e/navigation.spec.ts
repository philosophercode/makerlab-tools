import { test, expect } from "@playwright/test";

// PrimaryNav links: / (TOOLS), /projects (PROJECTS), /about (ABOUT).
// An unknown tool slug calls notFound() -> Next's not-found page.

test.describe("Navigation", () => {
  test("all primary nav links are reachable", async ({ page }) => {
    await page.goto("/");

    const nav = page.getByRole("navigation", { name: "Primary navigation" });

    await expect(
      nav.getByRole("link", { name: "TOOLS", exact: true })
    ).toHaveAttribute("href", "/");

    await nav.getByRole("link", { name: "PROJECTS" }).click();
    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    await page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: "ABOUT" })
      .click();
    await expect(page).toHaveURL(/\/about$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // Brand lockup returns home.
    await page.getByRole("link", { name: /MakerLab/i }).first().click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("an unknown tool slug renders the not-found page", async ({ page }) => {
    await page.goto("/tools/does-not-exist");

    // notFound() renders Next's default not-found page. Under `npm run dev`
    // (what the E2E webServer runs) Next streams it with HTTP 200, so we assert
    // on the rendered content rather than the status code. (Production builds
    // return a real 404.)
    await expect(
      page.getByText(/404|not found|could not be found/i).first()
    ).toBeVisible();

    // The known tool name must NOT appear.
    await expect(
      page.getByRole("heading", { name: "Form 4", level: 1 })
    ).toHaveCount(0);
  });
});

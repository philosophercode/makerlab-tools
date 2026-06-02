import { test, expect } from "@playwright/test";

// GalleryShell has a search input (aria-label from gallery.searchAria) that
// fuzzy-ranks tools via match-sorter, plus single-select facet chips for
// category / materials / location. Mock catalog: "Form 4" (3D Printing,
// Standard resin) and "Trotec Speedy 400" (Laser, Acrylic).

test.describe("Search and filter", () => {
  test("typing a query narrows the grid to the matching tool", async ({
    page,
  }) => {
    await page.goto("/");

    const form = page.getByRole("heading", { name: "Form 4", level: 2 });
    const trotec = page.getByRole("heading", {
      name: "Trotec Speedy 400",
      level: 2,
    });

    await expect(form).toBeVisible();
    await expect(trotec).toBeVisible();

    // Search input is labelled by gallery.searchAria => "Search inventory".
    // match-sorter is fuzzy and ranks across long description text, so most
    // queries surface both tools; "Speedy" is distinctive enough to isolate
    // the Trotec Speedy 400 and drop Form 4 entirely.
    const search = page.getByRole("textbox", { name: "Search inventory" });
    await search.fill("Speedy");

    await expect(trotec).toBeVisible();
    await expect(form).toHaveCount(0);
  });

  test("a no-match query shows the empty state", async ({ page }) => {
    await page.goto("/");

    await page
      .getByRole("textbox", { name: "Search inventory" })
      .fill("zzzznotarealtool");

    // gallery.empty => "No matching tools found."
    await expect(page.getByText("No matching tools found.")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Form 4", level: 2 })
    ).toHaveCount(0);
  });

  test("a category facet chip filters the grid", async ({ page }) => {
    await page.goto("/");

    // Category chips are buttons labelled with the category name. Selecting
    // "Laser" should keep Trotec and drop Form 4.
    await page.getByRole("button", { name: "Laser", exact: true }).click();

    await expect(
      page.getByRole("heading", { name: "Trotec Speedy 400", level: 2 })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Form 4", level: 2 })
    ).toHaveCount(0);
  });
});

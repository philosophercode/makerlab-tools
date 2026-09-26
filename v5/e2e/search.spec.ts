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
    const search = page.getByRole("searchbox", { name: "Search inventory" });
    await search.fill("Speedy");

    await expect(trotec).toBeVisible();
    await expect(form).toHaveCount(0);
  });

  test("a no-match query shows the empty state", async ({ page }) => {
    await page.goto("/");

    await page
      .getByRole("searchbox", { name: "Search inventory" })
      .fill("zzzznotarealtool");

    // gallery.emptyFiltered names the search that emptied the gallery.
    await expect(page.getByText('No tools match "zzzznotarealtool".')).toBeVisible();
    // …and the view is a link: the query is in the URL.
    await expect(page).toHaveURL(/\?q=zzzznotarealtool/);
    await expect(
      page.getByRole("heading", { name: "Form 4", level: 2 })
    ).toHaveCount(0);
  });

  test("a category facet filters the grid", async ({ page }) => {
    await page.goto("/");

    // Category is a FilterBar facet (UI system phase 5a): a menu button whose
    // values are radio items with the count each would leave. Selecting
    // "Laser" should keep Trotec and drop Form 4.
    await page.getByRole("search").getByRole("button", { name: /^Category/ }).click();
    await page.getByRole("menuitemradio", { name: /^Laser/ }).click();

    await expect(
      page.getByRole("heading", { name: "Trotec Speedy 400", level: 2 })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Form 4", level: 2 })
    ).toHaveCount(0);
  });

  test("group by category shows labelled sections with counts, kept in the URL", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("search").getByRole("button", { name: /^Group by/ }).click();
    await page.getByRole("menuitemradio", { name: /^Category group/ }).click();
    await expect(page).toHaveURL(/group=categoryGroup/);
    await expect(page.getByRole("region", { name: /3D Printing/ }).getByRole("heading", { name: "Form 4", level: 3 })).toBeVisible();
    await expect(page.getByRole("region", { name: /Laser/ }).getByRole("heading", { name: "Trotec Speedy 400", level: 3 })).toBeVisible();

    // A reload keeps the grouping: the view is a link.
    await page.reload();
    await expect(page.getByRole("heading", { name: /3D Printing/, level: 2 })).toBeVisible();
  });
});

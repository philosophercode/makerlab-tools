import { test, expect } from "@playwright/test";

// The tool list is the home page (student home spec 2026-10-07, amendment
// "One page: the list at rest"). Its search box (a combobox, labelled from
// gallery.search.label) ranks the tools with the ⌘K palette's matcher and
// shows them in place of the category groups; the category chips and the
// FilterBar's facets narrow the list. Demo catalogue: "Form 4" (3D Printing)
// and "Trotec Speedy 400" (Laser Cutting & Engraving).

const SEARCH = "Search tools, or ask MakerLAB AI a question";

test.describe("Search and filter", () => {
  test("typing a query narrows the list to the matching tool", async ({ page }) => {
    await page.goto("/");

    const form = page.getByRole("heading", { name: "Form 4", level: 3 });
    const trotec = page.getByRole("heading", { name: "Trotec Speedy 400", level: 3 });
    await expect(form).toBeVisible();
    await expect(trotec).toBeVisible();

    await page.getByRole("combobox", { name: SEARCH }).fill("Speedy");

    await expect(trotec).toBeVisible();
    await expect(form).toHaveCount(0);
  });

  test("a no-match query shows the empty state and the Ask button", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("combobox", { name: SEARCH }).fill("zzzznotarealtool");
    await page.keyboard.press("Escape");

    // gallery.emptyFiltered names the search that emptied the list.
    await expect(page.getByText('No tools match "zzzznotarealtool".')).toBeVisible();
    await expect(page.getByRole("button", { name: /Ask MakerLAB AI: “zzzznotarealtool”/ })).toBeVisible();
    // …and the view is a link: the query is in the URL.
    await expect(page).toHaveURL(/\?q=zzzznotarealtool/);
    await expect(page.getByRole("heading", { name: "Form 4", level: 3 })).toHaveCount(0);
  });

  test("a category chip filters the list", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("group", { name: "Categories" }).getByRole("button", { name: /^Laser/ }).click();

    await expect(page.getByRole("heading", { name: "Trotec Speedy 400", level: 3 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Form 4", level: 3 })).toHaveCount(0);
  });

  test("the list rests grouped by category; Group by None is one list, kept in the URL", async ({ page }) => {
    await page.goto("/");
    const filters = page.getByRole("search", { name: "Filter the tools" });
    await expect(filters.getByRole("button", { name: "Group by: Category" })).toBeVisible();
    await filters.getByRole("button", { name: /^Group by/ }).click();
    await page.getByRole("menuitemradio", { name: /^None/ }).click();
    await expect(page).toHaveURL(/group=none/);
    await expect(page.getByRole("heading", { name: "Form 4", level: 2 })).toBeVisible();

    // A reload keeps the grouping: the view is a link.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Form 4", level: 2 })).toBeVisible();
  });
});

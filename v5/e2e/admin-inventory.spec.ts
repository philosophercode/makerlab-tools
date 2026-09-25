import { test, expect } from "@playwright/test";

import { DEMO_ACCOUNTS } from "../src/lib/db/demo-seed";
import { signIn } from "./utils/session";

/**
 * `/admin/inventory`, end to end (data platform design spec §5.3(a), §6).
 *
 * This part of Phase 5 builds the review table and its filters; the editor
 * panel that opens from a row is the next part, and its scenarios land here
 * beside these. What is checked now is the page's own contract: who may open
 * it, that it lists the inventory rather than the catalogue, that a filtered
 * view is a link, and that an empty table says which filter emptied it.
 *
 * Nothing here writes, so these tests share the demo database happily with
 * every other spec.
 */

test.describe("/admin/inventory — who may open it", () => {
  test("an anonymous visitor is told to sign in, not 404ed", async ({ page }) => {
    await page.goto("/admin/inventory");

    await expect(
      page.getByRole("heading", { name: "You are not signed in", level: 1 })
    ).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
  });

  test("an ordinary student is refused, and told why", async ({ page, context, baseURL }) => {
    await signIn(context, DEMO_ACCOUNTS.user, baseURL);
    await page.goto("/admin/inventory");

    await expect(
      page.getByRole("heading", { name: /do not have access/i, level: 1 })
    ).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
  });

  test("a SuperMaker holds tools.edit, so the review table opens for them", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, DEMO_ACCOUNTS.admin, baseURL);
    await page.goto("/admin");

    // The index lists exactly what this account's permissions open.
    await page.getByRole("link", { name: "Inventory" }).click();

    // Headroom, the way `admin-users.spec.ts` gives its saves some: this is
    // often the first request this server sees for the route, and the table
    // streams in behind the layout's Suspense boundary.
    await expect(page.getByRole("heading", { name: "Inventory", level: 2 })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("row", { name: /Form 4/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /Trotec Speedy 400/ })).toBeVisible();
  });
});

test.describe("/admin/inventory — filtering", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await signIn(context, DEMO_ACCOUNTS.admin, baseURL);
  });

  test("a filtered view arrives filtered when its link is opened", async ({ page }) => {
    await page.goto("/admin/inventory?state=draft");

    // The demo seed's two tools are both published, so this filter empties the
    // table — and the page says which filter did it (§6, States). The facet
    // button names its value (UI system spec §7.2, FacetFilter).
    const filters = page.getByRole("search", { name: "Filter the inventory" });
    await expect(filters.getByRole("button", { name: "State: Draft" })).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(page.getByText(/State: Draft/)).toBeVisible();
  });

  test("changing a filter puts it in the URL, so the view can be sent to somebody", async ({
    page,
  }) => {
    await page.goto("/admin/inventory");
    await expect(page.getByText("Showing 2 of 2")).toBeVisible();

    // A facet is a menu that says how many rows each value would leave.
    await page
      .getByRole("search", { name: "Filter the inventory" })
      .getByRole("button", { name: "Needs attention" })
      .click();
    const neverReviewed = page.getByRole("menuitemradio", { name: /Never reviewed/ });
    await expect(neverReviewed).toContainText("2");
    await neverReviewed.click();

    await expect(page).toHaveURL(/\?attention=never_reviewed$/);
    // Nothing in the demo seed has ever been reviewed, so both rows stay.
    await expect(page.getByText("Showing 2 of 2")).toBeVisible();
    await expect(page.getByRole("row", { name: /Form 4/ })).toBeVisible();
  });

  test("clearing the filters empties the query string too", async ({ page }) => {
    await page.goto("/admin/inventory?attention=no_photo");

    // Clear can also appear in an empty table's own message; take the bar's.
    await page
      .getByRole("search", { name: "Filter the inventory" })
      .getByRole("button", { name: "Clear filters" })
      .click();

    await expect(page).toHaveURL(/\/admin\/inventory$/);
    await expect(
      page.getByRole("search", { name: "Filter the inventory" }).getByRole("button", { name: "Needs attention" })
    ).toBeVisible();
  });
});

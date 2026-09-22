import { test, expect } from "@playwright/test";

import { DEMO_ACCOUNTS } from "../src/lib/db/demo-seed";
import { signIn } from "./utils/session";

/**
 * The three queues (data platform design spec §5.6, §9).
 *
 * The demo seed carries one row for each of them — an open ticket against the
 * Trotec, a correction about the Form 4's materials, and a project waiting for
 * a decision — so each page here has something real to show.
 *
 * **Only one test writes**, and it writes a field nothing else in the suite
 * reads: the ticket's priority. Every spec shares one PGlite database and the
 * workers run in parallel, so publishing the waiting project (which would put
 * it in the gallery `projects.spec.ts` counts) or resolving the ticket is left
 * to each surface's own `actions.test.ts`, which runs against rows it seeds
 * itself. What only a browser can check is the round trip: a server action
 * handed down to a client island as a prop, called from a real click, landing
 * in Postgres.
 */

test.describe("who may open each queue", () => {
  test("a student is refused all three, and told so rather than 404ed", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, DEMO_ACCOUNTS.user, baseURL);

    for (const path of ["/admin/maintenance", "/admin/corrections", "/admin/projects"]) {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { name: /do not have access/i, level: 1 })
      ).toBeVisible();
    }
  });

  test("the admin index lists exactly what this account's permissions open", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, DEMO_ACCOUNTS.admin, baseURL);
    await page.goto("/admin");

    // Scoped to the index's own list: the header's navigation has a Projects
    // link of its own, and it means the public gallery.
    const surfaces = page.getByRole("list", { name: "Admin pages your account can open" });
    await expect(surfaces.getByRole("link", { name: "Maintenance" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(surfaces.getByRole("link", { name: "Corrections" })).toBeVisible();
    await expect(surfaces.getByRole("link", { name: "Projects" })).toBeVisible();
    // A SuperMaker does not hold `users.manage`, so the roster is not offered.
    await expect(surfaces.getByRole("link", { name: "People" })).toHaveCount(0);
    // Every lede on this page is shared with the page it names, so none of them
    // takes an argument — a next-intl placeholder rendered without one renders
    // literally (Article 6).
    await expect(page.locator("body")).not.toContainText("{");
  });
});

test.describe("the queues have the lab's work in them", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await signIn(context, DEMO_ACCOUNTS.admin, baseURL);
  });

  test("the maintenance queue shows the open ticket and the machine it is about", async ({
    page,
  }) => {
    await page.goto("/admin/maintenance");

    await expect(page.getByRole("heading", { name: "Laser bed out of focus" })).toBeVisible({
      timeout: 15_000,
    });
    // The unit lives on its tool's page, which is where the link goes.
    await expect(page.getByRole("link", { name: "Trotec Speedy 400" })).toHaveAttribute(
      "href",
      "/tools/trotec-speedy-400"
    );
    await expect(page.getByRole("combobox", { name: /^Status for/ })).toHaveValue("open");
  });

  test("a correction is one click from the field it corrects", async ({ page }) => {
    await page.goto("/admin/corrections");

    await expect(page.getByText(/missing Rigid 10K/)).toBeVisible({ timeout: 15_000 });
    await page.getByRole("link", { name: "Form 4" }).click();

    // The tool's own page: the field is on it, and so is the editor for
    // anybody holding `tools.edit` (§5.3(b)).
    await expect(page).toHaveURL(/\/tools\/form-4$/);
    await expect(page.getByRole("heading", { name: "Form 4", level: 1 })).toBeVisible();
  });

  test("the moderation queue shows the whole submission, since it has no page yet", async ({
    page,
  }) => {
    await page.goto("/admin/projects");

    await expect(page.getByRole("heading", { name: "Resin dice tower" })).toBeVisible({
      timeout: 15_000,
    });
    // Everything a visitor would see, because a visitor cannot see it at all.
    await expect(page.getByText(/printed in three parts/)).toBeVisible();
    await expect(page.getByText(/Not in the gallery yet/)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Publish Resin dice tower$/ })).toBeVisible();
  });
});

test.describe("working a ticket", () => {
  // One database, parallel workers: the two halves of this have to happen in
  // order, and they are the only tests in the suite that touch this field.
  test.describe.configure({ mode: "serial" });

  test("a priority set from the queue survives a reload", async ({ page, context, baseURL }) => {
    await signIn(context, DEMO_ACCOUNTS.admin, baseURL);
    await page.goto("/admin/maintenance");

    const priority = page.getByRole("combobox", { name: /^Priority for/ });
    await expect(priority).toHaveValue("high", { timeout: 15_000 });

    await priority.selectOption("critical");
    // The control confirms from the action's own answer rather than waiting for
    // the revalidation behind it — see `use-row-action.ts`.
    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible({
      timeout: 15_000,
    });

    await page.reload();
    await expect(page.getByRole("combobox", { name: /^Priority for/ })).toHaveValue("critical", {
      timeout: 15_000,
    });
  });

  test("and is put back, so the seed reads the way the other specs expect", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, DEMO_ACCOUNTS.admin, baseURL);
    await page.goto("/admin/maintenance");

    await page.getByRole("combobox", { name: /^Priority for/ }).selectOption("high");
    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible({
      timeout: 15_000,
    });
  });
});

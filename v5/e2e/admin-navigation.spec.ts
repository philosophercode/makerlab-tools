import { test, expect } from "@playwright/test";
import { DEMO_ACCOUNTS } from "../src/lib/db/demo-seed";
import { signIn } from "./utils/session";

/**
 * Admin navigation, end to end (UI system spec §8.1, phase 4): the section bar
 * on every admin page, Add equipment's tabs, and the ⌘K palette — each
 * offering only what the viewer's permissions open.
 */

test.describe("the section bar", () => {
  test("is on every admin page, and moves between them without the home", async ({ page, context, baseURL }) => {
    await signIn(context, DEMO_ACCOUNTS.superAdmin, baseURL);
    await page.goto("/admin/inventory");

    const bar = page.getByRole("navigation", { name: "Admin sections" });
    await expect(bar.getByRole("link", { name: "Inventory", exact: true })).toHaveAttribute("aria-current", "page", {
      timeout: 15_000,
    });
    // No stacked display "ADMIN" above the page's own title any more.
    await expect(page.getByRole("heading", { name: "Inventory", level: 2 })).toBeVisible();

    await bar.getByRole("link", { name: "Maintenance", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/maintenance$/);
    await expect(page.getByRole("heading", { name: "Maintenance", level: 2 })).toBeVisible({ timeout: 15_000 });
    await expect(bar.getByRole("link", { name: "Maintenance", exact: true })).toHaveAttribute("aria-current", "page");
    // A director sees People; the bar carries no waiting counts.
    await expect(bar.getByRole("link", { name: "People", exact: true })).toBeVisible();
    await expect(bar.getByRole("list", { name: "Queues" })).not.toContainText(/\d/);
  });

  test("is not shown to a signed-in student, who is refused in words", async ({ page, context, baseURL }) => {
    await signIn(context, DEMO_ACCOUNTS.user, baseURL);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: /do not have access/i, level: 1 })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("navigation", { name: "Admin sections" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open the command palette" })).toHaveCount(0);
  });
});

test("Add equipment is one header over Queue, Imports and Import a list", async ({ page, context, baseURL }) => {
  await signIn(context, DEMO_ACCOUNTS.admin, baseURL);
  await page.goto("/admin/intake");

  await expect(page.getByRole("heading", { name: "Add equipment", level: 2 })).toBeVisible({ timeout: 15_000 });
  const tabs = page.getByRole("navigation", { name: "Add equipment" });
  await expect(tabs.getByRole("link", { name: "Queue" })).toHaveAttribute("aria-current", "page");

  await tabs.getByRole("link", { name: "Imports" }).click();
  await expect(page).toHaveURL(/\/admin\/intake\/imports$/);
  await expect(tabs.getByRole("link", { name: "Imports" })).toHaveAttribute("aria-current", "page", { timeout: 15_000 });
  await expect(page.getByRole("table", { name: "Recent imports" }).or(page.getByText("No imports yet."))).toBeVisible();

  await tabs.getByRole("link", { name: "Import a list" }).click();
  await expect(page).toHaveURL(/\/admin\/intake\/imports\/new$/);
  // The section bar marks the most specific surface: Import a list, not Intake.
  const bar = page.getByRole("navigation", { name: "Admin sections" });
  await expect(bar.getByRole("link", { name: "Import a list" })).toHaveAttribute("aria-current", "page", { timeout: 15_000 });
  await expect(bar.getByRole("link", { name: "Intake", exact: true })).not.toHaveAttribute("aria-current");
});

test("⌘K jumps to a tool by name, and offers a SuperMaker no People", async ({ page, context, baseURL }) => {
  await signIn(context, DEMO_ACCOUNTS.admin, baseURL);
  await page.goto("/admin/maintenance");
  await expect(page.getByRole("heading", { name: "Maintenance", level: 2 })).toBeVisible({ timeout: 15_000 });

  // The shortcut is the island's own listener: press until it has hydrated.
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(async () => {
    await page.keyboard.press("ControlOrMeta+k");
    await expect(palette).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await expect(palette.getByRole("option", { name: /^People/ })).toHaveCount(0);

  await palette.getByRole("combobox").fill("form 4");
  await expect(palette.getByRole("option", { name: /Form 4/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/tools\/form-4$/, { timeout: 15_000 });
});

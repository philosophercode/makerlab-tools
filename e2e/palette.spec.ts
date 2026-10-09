import { test, expect } from "@playwright/test";
import { DEMO_ACCOUNTS } from "../src/lib/db/demo-seed";
import { signIn } from "./utils/session";

/**
 * ⌘K on every page (public polish): the header's search field opens the
 * palette for anybody; it finds tools, categories and pages; admin pages
 * appear only for a role that opens them; `/` still focuses the page's own
 * filter search.
 */

test("an anonymous visitor opens the palette from the header and jumps to a tool", async ({ page }) => {
  await page.goto("/about");
  const trigger = page.getByRole("button", { name: /Search tools…/ });
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(async () => {
    await trigger.click();
    await expect(palette).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await expect(palette.getByText("Admin pages")).toHaveCount(0);

  await palette.getByRole("combobox").fill("form 4");
  await expect(palette.getByRole("option", { name: /Form 4/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/tools\/form-4$/, { timeout: 15_000 });
});

test("⌘K works on a public page, and offers an admin their admin pages there", async ({ page, context, baseURL }) => {
  await signIn(context, DEMO_ACCOUNTS.admin, baseURL);
  await page.goto("/projects");
  await expect(page.getByRole("button", { name: /signed in as/i })).toBeVisible({ timeout: 15_000 });
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(async () => {
    await page.keyboard.press("ControlOrMeta+k");
    await expect(palette).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  // Admin pages are named by tab, with their section beside them (admin sections spec 2026-10-07).
  await expect(palette.getByRole("option", { name: /^Tickets\s*Maintenance/ })).toBeVisible();
  await expect(palette.getByRole("option", { name: /^QR labels/ })).toBeVisible();
  await expect(palette.getByRole("option", { name: /^Roster/ })).toHaveCount(0);

  await palette.getByRole("combobox").fill("about");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/about$/, { timeout: 15_000 });
});

test("/ focuses the home page's smart search, not the palette", async ({ page }) => {
  await page.goto("/");
  const search = page.getByRole("combobox", { name: "Search tools, or ask MakerLAB AI a question" });
  await expect(search).toBeVisible();
  await expect(async () => {
    await page.locator("body").click({ position: { x: 5, y: 300 } });
    await page.keyboard.press("/");
    await expect(search).toBeFocused({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await expect(page.getByRole("dialog", { name: "Command palette" })).toHaveCount(0);
});

test("a category in the palette filters the home page's list in place", async ({ page }) => {
  // The list is the home page (student home spec, amendment "One page: the list at rest"):
  // choosing a category there must change the list, not only the address.
  await page.goto("/");
  await expect(page.getByRole("list", { name: "Categories" }).getByRole("link", { name: /3D Printing/ })).toBeVisible();
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(async () => {
    await page.keyboard.press("ControlOrMeta+k");
    await expect(palette).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await palette.getByRole("combobox").fill("3d printing");
  await palette.getByRole("option", { name: /^3D Printing/ }).click();
  await expect(page).toHaveURL(/\/\?category=3D\+Printing$/);
  await expect(page.getByRole("heading", { name: "3D Printing", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Form 4", level: 3 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Trotec Speedy 400", level: 3 })).toHaveCount(0);
});

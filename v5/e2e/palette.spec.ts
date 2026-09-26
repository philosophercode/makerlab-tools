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
  await expect(palette.getByRole("option", { name: /^Maintenance/ })).toBeVisible();
  await expect(palette.getByRole("option", { name: /^People/ })).toHaveCount(0);

  await palette.getByRole("combobox").fill("about");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/about$/, { timeout: 15_000 });
});

test("/ focuses the gallery's own search, not the palette", async ({ page }) => {
  await page.goto("/");
  const search = page.getByRole("searchbox", { name: "Search inventory" });
  await expect(search).toBeVisible();
  await expect(async () => {
    await page.locator("body").click({ position: { x: 5, y: 300 } });
    await page.keyboard.press("/");
    await expect(search).toBeFocused({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await expect(page.getByRole("dialog", { name: "Command palette" })).toHaveCount(0);
});

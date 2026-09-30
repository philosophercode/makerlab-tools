import { test, expect } from "@playwright/test";

import { DEMO_ACCOUNTS } from "../src/lib/db/demo-seed";
import { signIn } from "./utils/session";

/**
 * `/assistant` in a browser (assistant–GUI parity spec, amendment 2026-09-29
 * "The capabilities page"): public, reached from the chat, About, `/mcp` and
 * the product page; the viewer's own role column is highlighted; the deny
 * list is under "never"; and a phone gets no sideways page scroll (the matrix
 * scrolls inside its own box).
 */

// PR #117 renames the chat to "MakerLAB AI"; accept either name.
const OPEN_CHAT = /Open the MakerLAB (Assistant|AI)/;

test("an anonymous visitor sees the page, the Visitor column highlighted, and the never list", async ({ page }) => {
  await page.goto("/assistant");
  await expect(page.getByRole("heading", { level: 1, name: "What MakerLAB AI can and can't do" })).toBeVisible();
  await expect(page).toHaveTitle("What MakerLAB AI can do · MakerLAB Tools");
  await expect(page.locator('th[aria-current="true"]')).toHaveAttribute("data-role", "anonymous");
  await expect(page.locator("[data-slot=for-you]")).toContainText("prepare no changes for you to confirm");

  const never = page.getByRole("region", { name: "Never, on any surface, whatever your role" });
  await expect(never).toContainText("Make someone a super admin");
  await expect(never).toContainText("Send emails or messages");
  await expect(page.locator('[data-item="action:tools.archive"]')).toContainText("can't be undone — type the name to confirm");
});

test("a signed-in super admin sees their own column highlighted", async ({ page, context, baseURL }) => {
  await signIn(context, DEMO_ACCOUNTS.superAdmin, baseURL);
  await page.goto("/assistant");
  await expect(page.locator('th[aria-current="true"]')).toHaveAttribute("data-role", "super_admin");
  await expect(page.locator("[data-slot=for-you]")).toContainText("You're signed in as a super admin.");
});

test("the chat links to the page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: OPEN_CHAT }).click();
  await page.getByRole("link", { name: "What can MakerLAB AI do?" }).click();
  await expect(page).toHaveURL(/\/assistant$/);
  await expect(page.getByRole("heading", { level: 1, name: "What MakerLAB AI can and can't do" })).toBeVisible();
});

for (const [from, name] of [
  ["/about", "What MakerLAB AI can and can't do"],
  ["/mcp", "What MakerLAB AI can and can't do, by role"],
  ["/product", "What MakerLAB AI can and can't do, by role"],
] as const) {
  test(`${from} links to the page`, async ({ page }) => {
    await page.goto(from);
    await expect(page.getByRole("link", { name })).toHaveAttribute("href", "/assistant");
  });
}

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("/assistant has no sideways page scroll", async ({ page }) => {
    await page.goto("/assistant");
    await expect(page.locator("[data-slot=capability-matrix]")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

import { test, expect } from "@playwright/test";

import { DEMO_ACCOUNTS } from "../src/lib/db/demo-seed";
import { signIn } from "./utils/session";

/**
 * `/admin/taxonomy` (taxonomy v2 spec §5.3) against the demo seed's v2 tree.
 *
 * What only a browser can check is the round trip: the page renders the tree
 * the migration writes, a server action handed to the island as a prop lands
 * in Postgres from a real click, and the page re-renders with it. The one
 * write here is a proposal this spec makes and then accepts — a new category
 * with no tools, which no other spec reads (the gallery's categories come from
 * tools, and intake runs on its own server).
 */

test("a student is refused, and told so rather than 404ed", async ({ page, context, baseURL }) => {
  await signIn(context, DEMO_ACCOUNTS.user, baseURL);
  await page.goto("/admin/taxonomy");
  await expect(page.getByRole("heading", { name: /do not have access/i, level: 1 })).toBeVisible();
});

test("an admin sees the nine top-level categories with slugs, counts and the hidden flag", async ({ page, context, baseURL }) => {
  await signIn(context, DEMO_ACCOUNTS.admin, baseURL);
  await page.goto("/admin/taxonomy");

  await expect(page.getByRole("heading", { name: "Taxonomy", level: 2 })).toBeVisible({ timeout: 15_000 });
  // In the admin section bar, beside the other Keep-data-fresh surfaces.
  await expect(page.getByRole("navigation", { name: "Admin sections" }).getByRole("link", { name: "Taxonomy" })).toBeVisible();

  const tree = page.getByRole("region", { name: "Categories" });
  for (const name of ["3D Printing", "Laser Cutting & Engraving", "CNC & Waterjet", "Power Tools", "Hand Tools", "Electronics", "Textiles, Vinyl & Crafts", "Scanning, XR & Media", "Shop Infrastructure & Supplies"]) {
    await expect(tree.getByRole("heading", { name, level: 4 })).toBeVisible();
  }
  const shop = page.locator('[data-category="shop-infrastructure-supplies"]');
  await expect(shop.getByText("Hidden from the gallery")).toBeVisible();
  const laser = page.locator('[data-category="laser-cutting-engraving"]');
  await expect(laser.getByText("laser-cutting-engraving", { exact: true })).toBeVisible();
  await expect(laser.getByText("1 tool", { exact: true })).toBeVisible();
});

test("a proposal made on the page waits in the queue, and accepting it adds the category to the tree", async ({ page, context, baseURL }) => {
  await signIn(context, DEMO_ACCOUNTS.admin, baseURL);
  await page.goto("/admin/taxonomy");
  const name = `E2E Oscillating Tools ${Date.now().toString(36)}`;

  await page.getByRole("button", { name: "Propose a category" }).click();
  const form = page.getByRole("form", { name: "Propose a category" });
  await form.getByLabel("Name", { exact: true }).fill(name);
  await form.getByLabel("Under").selectOption({ label: "Power Tools" });
  await form.getByLabel("Description", { exact: true }).fill("Oscillating multi-tools. Not rotary tools.");
  await form.getByRole("button", { name: "Propose", exact: true }).click();

  const card = page.getByRole("article", { name: `Proposal: ${name}` });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card.getByText("From a person")).toBeVisible();

  await card.getByRole("button", { name: "Accept" }).click();
  await expect(card.getByText("Accepted: the category exists now.")).toBeVisible();

  await page.reload();
  const powerTools = page.locator('[data-category="power-tools"]').locator("xpath=..");
  await expect(powerTools.getByRole("heading", { name, level: 5 })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("article", { name: `Proposal: ${name}` })).toHaveCount(0);
});

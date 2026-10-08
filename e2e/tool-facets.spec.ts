import { test, expect } from "@playwright/test";

import { DEMO_ACCOUNTS } from "../src/lib/db/demo-seed";
import { signIn } from "./utils/session";

/**
 * The taxonomy v2 facets (Item kind, Accessory of) where they are read: the
 * gallery's and the inventory's Item kind facet, and the editor's two fields.
 * **Nothing here writes** — every spec shares one database, and the one write
 * (setting and clearing the facets on the Trotec) is in `tool-editor.spec.ts`'s
 * serial describe, beside the other Trotec write it would otherwise race.
 */

test("the gallery's Item kind facet reads from the URL and counts equipment", async ({ page }) => {
  await page.goto("/?show=all&kind=equipment");
  const search = page.getByRole("search", { name: "Filter the tools" });
  await expect(search.getByRole("button", { name: "Item kind: Equipment" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("link", { name: /Form 4/ }).first()).toBeVisible();

  await page.goto("/?show=all&kind=consumable");
  await expect(page.getByText(/No tools match/)).toBeVisible({ timeout: 15_000 });
});

test("the inventory offers Item kind as a facet", async ({ page, context, baseURL }) => {
  await signIn(context, DEMO_ACCOUNTS.admin, baseURL);
  await page.goto("/admin/inventory?kind=equipment");
  await expect(page.getByRole("search").getByRole("button", { name: /^Item kind/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("row", { name: /Form 4/ })).toBeVisible();
});

test("the editor shows Item kind and Accessory of, offering the other tools", async ({ page, context, baseURL }) => {
  await signIn(context, DEMO_ACCOUNTS.admin, baseURL);
  await page.goto("/admin/inventory");
  await page.getByRole("row", { name: /Form 4/ }).getByRole("button", { name: "Edit" }).click();
  const panel = page.getByRole("complementary", { name: "Editing Form 4" });
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await expect(panel.getByLabel("Item kind")).toHaveValue("equipment");
  await expect(panel.getByLabel("Accessory of")).toHaveValue("");
  await expect(panel.getByLabel("Accessory of").getByRole("option", { name: "Trotec Speedy 400" })).toHaveCount(1);
  await expect(panel.getByLabel("Accessory of").getByRole("option", { name: "Form 4" })).toHaveCount(0);
});

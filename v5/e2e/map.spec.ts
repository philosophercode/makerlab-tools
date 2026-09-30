import { test, expect } from "@playwright/test";

import { DEMO_ACCOUNTS, DEMO_PROJECT_SLUG } from "../src/lib/db/demo-seed";
import { signIn } from "./utils/session";

/**
 * The floor map (map UX pass): signed-in only; a zone is a place in the
 * browser's history, so Back returns to the whole map; the way out is the
 * "Whole map" button, the zone bar's "All zones", the breadcrumb and Escape.
 * The demo seed's two tools are not on the Studio 101 plan, so the zones are
 * empty — navigation is what is under test, not placement (unit-tested).
 */

test("signed out, /map is the sign-in notice with no plan", async ({ page }) => {
  await page.goto("/map");
  await expect(page.getByText("Sign in to see the floor map.")).toBeVisible();
  await expect(page.locator("svg.floor-map")).toHaveCount(0);
});

test("a zone is a history entry: Back, Whole map and Escape all return to the plan", async ({ page, context, baseURL }) => {
  await signIn(context, DEMO_ACCOUNTS.user, baseURL);
  await page.goto("/map");
  const zones = page.getByRole("navigation", { name: "Zones" });
  const zoneHeading = page.getByRole("heading", { level: 2, name: "Zone 2 · 3D Printing Hub" });

  await zones.getByRole("link", { name: /2 · 3D Printing Hub/ }).click();
  await expect(page).toHaveURL(/\/map\?highlight=Z2$/);
  await expect(zoneHeading).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/map$/);
  await expect(zoneHeading).toHaveCount(0);

  await page.goForward();
  await expect(zoneHeading).toBeVisible();
  await page.getByRole("button", { name: "Whole map" }).click();
  await expect(page).toHaveURL(/\/map$/);
  await expect(zoneHeading).toHaveCount(0);

  // A zone on the plan itself, then Escape.
  await page.locator('svg.floor-map a[data-zone="Z4"]').click();
  await expect(page).toHaveURL(/\/map\?highlight=Z4$/);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/map$/);
});

test("a project page shows a signed-in visitor where its tools are, and nobody else", async ({ page, context, baseURL }) => {
  await page.goto(`/projects/${DEMO_PROJECT_SLUG}`);
  await expect(page.getByRole("heading", { name: "Tools used" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Where you’ll work" })).toHaveCount(0);

  await signIn(context, DEMO_ACCOUNTS.user, baseURL);
  await page.reload();
  const work = page.locator('[data-slot="project-work-map"]');
  await expect(work.getByRole("heading", { name: "Where you’ll work" })).toBeVisible();
  // The demo tools are not on the plan: listed, said, never guessed.
  await expect(work.getByText("Not on the map")).toBeVisible();
  await expect(work.getByRole("link", { name: /Form 4/ })).toHaveAttribute("href", "/tools/form-4");
});

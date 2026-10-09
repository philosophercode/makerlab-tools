import { test, expect } from "@playwright/test";

import { DEMO_ACCOUNTS } from "../src/lib/db/demo-seed";
import { signIn } from "./utils/session";

// Demo seed: Form 4 (slug "form-4") has one unit "Form 4 // A" (serial
// ML-F4-001), two resource links (Form 4 SOP / Resin handling safety), and a
// `notionPageId` of 1f2e3d4c-5b6a-4789-8abc-def012345678 (src/lib/db/demo-seed.ts)
// used below to exercise the legacy `/tools/<notion-id>` redirect (spec Goal 2).

test.describe("Tool detail", () => {
  test("deep-link /tools/form-4 shows name, units and resources", async ({
    page,
  }) => {
    await page.goto("/tools/form-4");

    // Hero heading is the tool name.
    await expect(
      page.getByRole("heading", { name: "Form 4", level: 1 })
    ).toBeVisible();

    // Description text from the mock seed.
    await expect(
      page.getByText(/production-grade resin printer/i)
    ).toBeVisible();

    // Physical machines (units) table: the unit by name. Scoped to the
    // table: the DataTable also renders a phone list with the same rows
    // (hidden at this width), so a page-wide getByText matches twice.
    // A visitor sees the serial's last four only, masked: the whole serial
    // is staff only (data platform spec amendment 2026-10-06), and not in
    // the page at all.
    const units = page.getByRole("table", { name: "Physical Machines" });
    await expect(units.getByText("Form 4 // A")).toBeVisible();
    await expect(units.getByRole("columnheader", { name: "Serial" })).toBeVisible();
    await expect(units.getByText("•••• -001")).toBeVisible();
    await expect(units.getByText("Serial ending -001")).toHaveCount(1);
    expect(await page.content()).not.toContain("ML-F4-001");

    // Resources / documents: link labels from the seed.
    await expect(page.getByText("Form 4 SOP")).toBeVisible();
    await expect(page.getByText("Resin handling safety")).toBeVisible();
  });

  test("clicking a gallery card navigates to the detail page", async ({
    page,
  }) => {
    // The cards are the home page's All tools view, grouped by category
    // (student home spec 2026-10-07, amendment "One page: the list at rest").
    await page.goto("/?show=all");

    await page
      .getByRole("link")
      .filter({
        has: page.getByRole("heading", { name: "Trotec Speedy 400", level: 3 }),
      })
      .click();

    await expect(page).toHaveURL(/\/tools\/trotec-speedy-400$/);
    await expect(
      page.getByRole("heading", { name: "Trotec Speedy 400", level: 1 })
    ).toBeVisible();
    // The Trotec's unit, by name, and its serial's masked last four; the
    // whole serial is for staff only. Scoped to the table: the demo seed
    // reuses the same string as the location's Map ID, which the
    // specifications show to everyone.
    const units = page.getByRole("table", { name: "Physical Machines" });
    await expect(units.getByText("Trotec Speedy 400")).toBeVisible();
    await expect(units.getByText("•••• -400")).toBeVisible();
    await expect(units.getByText("ML-LSR-400")).toHaveCount(0);
  });

  // Data platform spec amendment 2026-10-06: whole serials for staff; a
  // student sees the last four, masked.
  test("a student sees each serial's last four, masked; a SuperMaker sees each whole serial", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, DEMO_ACCOUNTS.user, baseURL);
    await page.goto("/tools/form-4");
    const units = page.getByRole("table", { name: "Physical Machines" });
    await expect(units.getByText("Form 4 // A")).toBeVisible();
    await expect(units.getByRole("columnheader", { name: "Serial" })).toBeVisible();
    await expect(units.getByText("•••• -001")).toBeVisible();
    expect(await page.content()).not.toContain("ML-F4-001");

    await context.clearCookies();
    await signIn(context, DEMO_ACCOUNTS.admin, baseURL);
    await page.goto("/tools/form-4");
    await expect(units.getByRole("columnheader", { name: "Serial" })).toBeVisible();
    await expect(units.getByText("ML-F4-001")).toBeVisible();
    await expect(units.getByText("•••• -001")).toHaveCount(0);
  });

  test("a legacy Notion-id link redirects permanently to the slug, preserving ?src=qr", async ({
    page,
  }) => {
    // Undashed, as it appears in a printed QR code — lands on the current slug.
    await page.goto("/tools/1f2e3d4c5b6a47898abcdef012345678");
    await expect(page).toHaveURL(/\/tools\/form-4$/);
    await expect(
      page.getByRole("heading", { name: "Form 4", level: 1 })
    ).toBeVisible();

    // Dashed, with the QR marker — the marker survives the redirect.
    await page.goto(
      "/tools/1f2e3d4c-5b6a-4789-8abc-def012345678?src=qr"
    );
    await expect(page).toHaveURL(/\/tools\/form-4\?src=qr$/);
    await expect(
      page.getByRole("heading", { name: "Form 4", level: 1 })
    ).toBeVisible();
  });
});

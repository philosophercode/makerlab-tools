import { test, expect } from "@playwright/test";

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

    // Physical machines (units) table: unit name + serial.
    await expect(page.getByText("Form 4 // A")).toBeVisible();
    await expect(page.getByText("ML-F4-001")).toBeVisible();

    // Resources / documents: link labels from the seed.
    await expect(page.getByText("Form 4 SOP")).toBeVisible();
    await expect(page.getByText("Resin handling safety")).toBeVisible();
  });

  test("clicking a gallery card navigates to the detail page", async ({
    page,
  }) => {
    await page.goto("/");

    await page
      .getByRole("link")
      .filter({
        has: page.getByRole("heading", { name: "Trotec Speedy 400", level: 2 }),
      })
      .click();

    await expect(page).toHaveURL(/\/tools\/trotec-speedy-400$/);
    await expect(
      page.getByRole("heading", { name: "Trotec Speedy 400", level: 1 })
    ).toBeVisible();
    // Trotec unit serial.
    await expect(page.getByText("ML-LSR-400").first()).toBeVisible();
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

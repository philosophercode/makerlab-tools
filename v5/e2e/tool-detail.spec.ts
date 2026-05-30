import { test, expect } from "@playwright/test";

// Mock catalog: Form 4 (slug "form-4") has one unit "Form 4 // A" (serial
// ML-F4-001) and two resource links (Form 4 SOP / Resin handling safety).

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
});

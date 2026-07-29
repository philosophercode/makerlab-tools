import { test, expect } from "@playwright/test";

// "Report a correction" (design spec 2026-07-29 §5, §6): a quiet control in the
// tool-detail footer opens a short modal; submit stays disabled until there is a
// description; the confirmation replaces the form in place rather than firing a
// toast.
//
// The E2E server boots with NOTION_DB_FLAGS unset (see playwright.config.ts), so
// the real POST /api/flags would answer 503 `not_configured`. The submit test
// intercepts that request with page.route() instead — the same technique
// chat.spec.ts uses — so nothing leaves the machine.
//
// Mock catalog: "Form 4" is slug `form-4`, Notion id `tool-form-4`
// (src/components/mock-catalog.ts). Strings are `flag.*` in messages/en.json.

const FLAG_ENDPOINT = "**/api/flags";
const TOOL_ID = "tool-form-4";

test.describe("Report a correction", () => {
  test("the control is reachable from a tool detail page", async ({ page }) => {
    await page.goto("/");

    // Arrive the way a student does: from the catalog, not a deep link.
    await page
      .getByRole("link")
      .filter({
        has: page.getByRole("heading", { name: "Form 4", level: 2 }),
      })
      .click();

    await expect(
      page.getByRole("heading", { name: "Form 4", level: 1 })
    ).toBeVisible();

    // flag.trigger => "Report a correction". Distinct from the nav's REPORT
    // control, whose accessible name is "Report a problem".
    await expect(
      page.getByRole("button", { name: "Report a correction" })
    ).toBeVisible();
  });

  test("opening it shows the form, with submit disabled until a description is typed", async ({
    page,
  }) => {
    await page.goto("/tools/form-4");

    await page.getByRole("button", { name: "Report a correction" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: "Report a correction" })
    ).toBeVisible();
    await expect(
      dialog.getByRole("combobox", { name: "Which field is wrong?" })
    ).toBeVisible();

    // flag.submit => "Send report".
    const submit = dialog.getByRole("button", { name: "Send report" });
    await expect(submit).toBeDisabled();

    const description = dialog.getByRole("textbox", { name: /what.s wrong/i });

    // Whitespace is not a description — the control trims before enabling.
    await description.fill("   ");
    await expect(submit).toBeDisabled();

    await description.fill("The build volume says 220 mm, but it is 256 mm.");
    await expect(submit).toBeEnabled();
  });

  test("submitting shows the confirmation and names the flagged field", async ({
    page,
  }) => {
    // Intercept BEFORE opening the form so the real route is never reached.
    let submitted: Record<string, unknown> | null = null;
    await page.route(FLAG_ENDPOINT, async (route) => {
      submitted = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "flag-e2e" }),
      });
    });

    await page.goto("/tools/form-4");
    await page.getByRole("button", { name: "Report a correction" }).click();

    const dialog = page.getByRole("dialog");
    await dialog
      .getByRole("textbox", { name: /what.s wrong/i })
      .fill("The build volume says 220 mm, but it is 256 mm.");
    await dialog.getByRole("button", { name: "Send report" }).click();

    // flag.sentTitle / flag.sentBody — inline, replacing the form (spec §6).
    await expect(
      dialog.getByRole("heading", { name: "Report sent" })
    ).toBeVisible();
    await expect(dialog.getByText(/staff will review this/i)).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Send report" })
    ).toHaveCount(0);

    // The report identifies the specific field, not just the tool (spec §2), and
    // carries the tool's Notion id rather than its slug.
    expect(submitted).toMatchObject({
      tool_id: TOOL_ID,
      field_flagged: "description",
      issue_description: "The build volume says 220 mm, but it is 256 mm.",
    });
  });
});

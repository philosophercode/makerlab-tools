import { test, expect } from "@playwright/test";

// QR codes on machines (design spec 2026-07-29 §5, §8). A label encodes the
// ordinary tool URL plus `?src=qr`. Arriving with that marker surfaces the
// assistant for this machine — it does not open it, because a panel that opens
// itself over the specs someone came to read is an interruption.
//
// `?src=qr` is presentation only. The parity test below is the one that matters:
// the spec names "`?src=qr` changing what data is displayed" as a case that
// would embarrass us, so the assertion is not "the page still works" but "the
// page renders byte-identical content either way".
//
// Mock catalog: "Form 4" is slug `form-4`. Strings are `qr.*` in messages/en.json.

/** qr.arrivalLabel — the notice's aria-label, so it is addressable as a region. */
const ARRIVAL_REGION = "Scanned from this machine";

/** The detail shell renders as the page's <main>; the notice is a sibling div. */
async function detailContent(
  page: import("@playwright/test").Page,
  url: string
): Promise<string> {
  await page.goto(url);
  await expect(
    page.getByRole("heading", { name: "Form 4", level: 1 })
  ).toBeVisible();
  return (await page.getByRole("main").innerText()).trim();
}

test.describe("QR arrival", () => {
  test("?src=qr renders the tool page with the assistant surfaced", async ({
    page,
  }) => {
    await page.goto("/tools/form-4?src=qr");

    // Still the ordinary tool page.
    await expect(
      page.getByRole("heading", { name: "Form 4", level: 1 })
    ).toBeVisible();

    const notice = page.getByRole("region", { name: ARRIVAL_REGION });
    await expect(notice).toBeVisible();
    // qr.arrivalTitle => "Ask about the {tool}" — the placeholder is passed, so
    // a literal "{tool}" here would be a real bug (Article 6).
    await expect(
      notice.getByRole("heading", { name: "Ask about the Form 4" })
    ).toBeVisible();
    await expect(
      notice.getByRole("button", { name: "Ask MakerLAB AI about this machine" })
    ).toBeEnabled();

    // Surfaced, not auto-opened (spec §5): the chat panel stays shut until the
    // student taps.
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("Report a problem opens the quick report form, not the chat", async ({ page }) => {
    await page.goto("/tools/form-4?src=qr");
    const notice = page.getByRole("region", { name: ARRIVAL_REGION });
    // The form is a client island: wait for hydration before the click counts.
    const report = notice.getByRole("button", { name: "Report a problem" });
    await expect(report).toBeEnabled();
    await expect(async () => {
      await report.click();
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 1_000 });
    }).toPass();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Form 4" })).toBeVisible();
    await expect(dialog.getByLabel("Tell us what's wrong with this machine")).toBeFocused();
    // One unit: nothing to choose.
    await expect(dialog.getByRole("group", { name: "Which unit?" })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Send report" })).toBeDisabled();
  });

  test("the same page without ?src=qr does not surface it", async ({ page }) => {
    await page.goto("/tools/form-4");

    await expect(
      page.getByRole("heading", { name: "Form 4", level: 1 })
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: ARRIVAL_REGION })
    ).toHaveCount(0);
    // Only the hero's pair (quick report spec §6): the notice adds none.
    await expect(
      page.getByRole("button", { name: "Ask MakerLAB AI about this machine" })
    ).toHaveCount(1);
  });

  test("?src=qr changes presentation only — the tool data is identical", async ({
    page,
  }) => {
    const plain = await detailContent(page, "/tools/form-4");
    const scanned = await detailContent(page, "/tools/form-4?src=qr");

    // Guard against two empty strings passing as "identical". The unit by
    // name and its serial's masked last four: the whole serial is for staff
    // only (amendment 2026-10-06), and a QR scan by a visitor shows none.
    expect(plain).toContain("Form 4 // A");
    expect(plain).toContain("•••• -001");
    expect(plain).not.toContain("ML-F4-001");
    expect(plain.length).toBeGreaterThan(200);

    expect(scanned).toBe(plain);
  });
});

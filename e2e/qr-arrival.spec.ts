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
      notice.getByRole("button", { name: "Ask about this machine" })
    ).toBeEnabled();

    // Surfaced, not auto-opened (spec §5): the chat panel stays shut until the
    // student taps.
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("the same page without ?src=qr does not surface it", async ({ page }) => {
    await page.goto("/tools/form-4");

    await expect(
      page.getByRole("heading", { name: "Form 4", level: 1 })
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: ARRIVAL_REGION })
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Ask about this machine" })
    ).toHaveCount(0);
  });

  test("?src=qr changes presentation only — the tool data is identical", async ({
    page,
  }) => {
    const plain = await detailContent(page, "/tools/form-4");
    const scanned = await detailContent(page, "/tools/form-4?src=qr");

    // Guard against two empty strings passing as "identical".
    expect(plain).toContain("ML-F4-001");
    expect(plain.length).toBeGreaterThan(200);

    expect(scanned).toBe(plain);
  });
});

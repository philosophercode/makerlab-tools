import { test, expect } from "@playwright/test";

// ThemeToggle cycles system -> light -> dark, writing data-theme on <html> and
// persisting to localStorage["theme"]. ThemeScript re-applies it before paint.
//
// LanguageSelector is a <select> (aria-label "Select language"). Choosing a
// locale runs the changeLocale server action (sets the NEXT_LOCALE cookie) then
// router.refresh(); LocaleHtmlScript reads that cookie and sets <html lang/dir>.

test.describe("Theme toggle", () => {
  test("persists across reload", async ({ page }) => {
    await page.goto("/");

    const toggle = page.getByRole("button", { name: /color theme/i });
    const html = page.locator("html");

    // Starts as "system" (no data-theme attribute).
    await expect(html).not.toHaveAttribute("data-theme", /.+/);

    // system -> light
    await toggle.click();
    await expect(html).toHaveAttribute("data-theme", "light");
    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem("theme")))
      .toBe("light");

    // light -> dark
    await toggle.click();
    await expect(html).toHaveAttribute("data-theme", "dark");

    // Reload: ThemeScript should re-apply "dark" from localStorage before paint.
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem("theme")))
      .toBe("dark");
  });
});

test.describe("Language switch", () => {
  test("switching to Spanish updates visible chrome and <html lang>", async ({
    page,
  }) => {
    await page.goto("/");

    // English nav label present initially (exact: brand lockup also links home).
    await expect(
      page.getByRole("link", { name: "TOOLS", exact: true })
    ).toBeVisible();

    await page
      .getByRole("combobox", { name: "Select language" })
      .selectOption("es");

    // Server re-render after router.refresh() localizes the visible chrome:
    // Spanish gallery title from messages/es.json => "HERRAMIENTAS // MÁQUINAS".
    await expect(
      page.getByRole("heading", { name: "HERRAMIENTAS // MÁQUINAS" })
    ).toBeVisible();

    // <html lang>/<dir> are corrected from the NEXT_LOCALE cookie by
    // LocaleHtmlScript, which runs on a fresh page load (not on the in-app
    // router.refresh()). Reload so the script re-applies the attributes.
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "es");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  });

  test("switching to Arabic sets dir=rtl", async ({ page }) => {
    await page.goto("/");

    await page
      .getByRole("combobox", { name: "Select language" })
      .selectOption("ar");

    // Arabic gallery title from messages/ar.json.
    await expect(
      page.getByRole("heading", { name: "الأدوات // الآلات" })
    ).toBeVisible();

    // Reload so LocaleHtmlScript applies lang/dir from the cookie before paint.
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  });
});

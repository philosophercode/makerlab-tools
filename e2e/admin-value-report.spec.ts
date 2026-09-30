import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";

import { DEMO_ACCOUNTS } from "../src/lib/db/demo-seed";
import { signIn } from "./utils/session";

/**
 * `/admin/insights/value` (usage insight spec amendment "Value report"): the
 * demo seed's synthetic week as a value report — refused to a student, the
 * headline numbers and formulas for a SuperMaker, the CSV download, the
 * one-page print, and the assumptions changing the estimate.
 *
 * `VALUE_REPORT_SHOTS=<dir>` also saves the screen and print screenshots
 * there (the PR's screenshot; never committed).
 */

const SHOTS = process.env.VALUE_REPORT_SHOTS;

// One worker, in order: the last test saves (and restores) the lab's
// assumptions, which every other test here reads.
test.describe.configure({ mode: "default" });

/** The last eight lab days, so the demo week is inside the range whatever the date. */
function lastEightDays(): { from: string; to: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
  const now = Date.now();
  return { from: fmt.format(new Date(now - 8 * 86_400_000)), to: fmt.format(new Date(now)) };
}

async function openWeek(page: Page) {
  const { from, to } = lastEightDays();
  await page.goto(`/admin/insights/value?from=${from}&to=${to}`);
  await expect(page.getByRole("heading", { level: 3, name: /^MakerLAB Assistant — .+ value report$/ })).toBeVisible();
}

test("a student is refused, and told so rather than 404ed", async ({ page, context, baseURL }) => {
  await signIn(context, DEMO_ACCOUNTS.user, baseURL);
  await page.goto("/admin/insights/value");
  await expect(page.getByRole("heading", { name: /do not have access/i, level: 1 })).toBeVisible();
});

test("a SuperMaker reaches the report from Insights and sees the current term", async ({ page, context, baseURL }) => {
  await signIn(context, DEMO_ACCOUNTS.admin, baseURL);
  await page.goto("/admin/insights");
  await page.getByRole("navigation", { name: "Insights views" }).getByRole("link", { name: "Value report" }).click();
  await expect(page).toHaveURL(/\/admin\/insights\/value$/);
  await expect(page.getByRole("heading", { level: 3, name: /^MakerLAB Assistant — (Spring|Summer|Fall) \d{4} value report$/ })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Term" }).locator('a[aria-current="page"]')).toHaveCount(1);
});

test("the demo week: headline numbers, the formulas in words, and the breakdowns", async ({ page, context, baseURL }) => {
  await signIn(context, DEMO_ACCOUNTS.admin, baseURL);
  await openWeek(page);

  const questions = Number((await page.locator('[data-value-metric="questionsAnswered"] dd > span').first().textContent())?.replace(/,/g, ""));
  expect(questions).toBeGreaterThan(20);
  await expect(page.locator('[data-value-metric="staffHoursSaved"] dd > span').first()).toHaveText(/^\d+\.\d$/);
  await expect(page.locator('[data-value-metric="dollarValue"] dd > span').first()).toHaveText(/^\$\d/);
  await expect(page.locator('[data-value-metric="afterHoursShare"] dd > span').first()).toHaveText(/^\d+%$/);

  const formulas = page.getByRole("region", { name: "How these numbers are calculated" }).getByRole("listitem");
  await expect(formulas).toHaveCount(5);
  await expect(formulas.nth(2)).toContainText("minutes a staff member would otherwise spend ÷ 60");
  await expect(page.getByRole("list", { name: "Most asked-about tools" }).getByRole("listitem").first()).toContainText(/Form 4|Trotec/);
  await expect(page.getByText(/Assumptions set by the lab: 4 min of staff time per question · \$40 per staff hour/)).toBeVisible();
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "value-report.png"), fullPage: true });
});

test("Download CSV saves the numbers, named after the report", async ({ page, context, baseURL }) => {
  await signIn(context, DEMO_ACCOUNTS.admin, baseURL);
  await openWeek(page);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download CSV" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^makerlab-assistant-.*-value-report\.csv$/);
  const csv = await readFile((await download.path())!, "utf8");
  const lines = csv.trim().split("\r\n");
  expect(lines[0]).toMatch(/^Section,Metric,/);
  expect(lines.find((line) => line.startsWith("Headline,Questions answered,"))).toMatch(/,\d+,\d+,$/);
  expect(csv).toContain("Assumptions,Minutes of staff time per question,4");
});

test("printed, the report is the whole page: no site header, admin bar, picker or form", async ({ page, context, baseURL }) => {
  await signIn(context, DEMO_ACCOUNTS.admin, baseURL);
  await openWeek(page);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("[data-value-report]")).toBeVisible();
  for (const hidden of ['[data-slot="value-period"]', '[data-slot="value-assumptions"]', '[data-slot="value-report-export"]']) {
    await expect(page.locator(hidden)).toBeHidden();
  }
  // The site header and the admin section bar take no space on paper.
  await expect(page.locator("body > header, header").first()).toBeHidden();
  await expect(page.getByRole("navigation", { name: "Insights views" })).toBeHidden();
  const box = await page.locator("[data-value-report]").boundingBox();
  expect(box?.y ?? 99).toBeLessThan(2);
  if (SHOTS) {
    await page.screenshot({ path: join(SHOTS, "value-report-print.png"), fullPage: true });
    await page.pdf({ path: join(SHOTS, "value-report.pdf"), format: "Letter", printBackground: true });
  }
  const pdf = await page.pdf({ format: "Letter", printBackground: true });
  // One page: a PDF's page count is the number of "/Type /Page" objects (not "/Pages").
  expect((pdf.toString("latin1").match(/\/Type\s*\/Page(?!s)/g) ?? []).length).toBe(1);
});

test.describe("the assumptions", () => {
  test("a SuperMaker changes the hourly cost and the estimate follows, then puts it back", async ({ page, context, baseURL }) => {
    await signIn(context, DEMO_ACCOUNTS.admin, baseURL);
    await openWeek(page);
    const value = page.locator('[data-value-metric="dollarValue"] dd > span').first();
    const before = Number((await value.textContent())!.replace(/[$,]/g, ""));
    const cost = page.getByLabel("Loaded staff cost per hour (USD)");
    await expect(cost).toBeEnabled();
    await cost.fill("80");
    await page.getByRole("button", { name: "Save assumptions" }).click();
    await expect(page.locator('[data-slot="value-assumptions"]').getByText("Saved")).toBeVisible();
    const footer = page.locator("[data-value-report] footer");
    await expect(footer).toContainText("$80 per staff hour");
    const after = Number((await value.textContent())!.replace(/[$,]/g, ""));
    expect(Math.abs(after - before * 2)).toBeLessThanOrEqual(1);

    await page.getByRole("button", { name: "Reset to defaults" }).click();
    await page.getByRole("button", { name: "Save assumptions" }).click();
    await expect(footer).toContainText("$40 per staff hour");
  });
});

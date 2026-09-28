import { test, expect } from "@playwright/test";

import { DEMO_ACCOUNTS } from "../src/lib/db/demo-seed";
import { signIn } from "./utils/session";

/**
 * `/admin/insights` (usage insight spec §6, §10): the demo seed's synthetic
 * week, read by a SuperMaker; refused to a student; the staff toggle; and a
 * tool page telling the server it was seen.
 *
 * Nothing here decides a gap: every spec shares one database, and the
 * decisions are covered row by row in `app/admin/insights/actions.test.ts`.
 */

test("a student is refused, and told so rather than 404ed", async ({ page, context, baseURL }) => {
  await signIn(context, DEMO_ACCOUNTS.user, baseURL);
  await page.goto("/admin/insights");
  await expect(page.getByRole("heading", { name: /do not have access/i, level: 1 })).toBeVisible();
});

test("a SuperMaker sees the demo week: totals, the Unanswered queue, tools, kinds and busiest times", async ({ page, context, baseURL }) => {
  await signIn(context, DEMO_ACCOUNTS.admin, baseURL);
  await page.goto("/admin/insights");

  await expect(page.getByRole("heading", { name: "Insights", level: 2 })).toBeVisible();
  await expect(page.getByText("Staff left out")).toBeVisible();

  const queue = page.getByRole("list", { name: "Unanswered questions", exact: true });
  await expect(queue.getByText("Do you have a waterjet cutter?")).toBeVisible();
  await expect(queue.getByRole("button", { name: /File “Can the Trotec cut glass/ })).toBeVisible();
  await expect(queue.getByRole("link", { name: "Add a manual to Trotec Speedy 400" })).toHaveAttribute("href", "/tools/trotec-speedy-400");

  const tools = page.getByRole("table", { name: /Tools by how often they were asked about/ });
  await expect(tools.getByRole("link", { name: "Form 4" })).toBeVisible();
  await expect(page.getByRole("table", { name: /by day of the week and hour/ })).toBeVisible();
  await expect(page.getByRole("img", { name: /How to use: \d+ in the period/ })).toBeVisible();

  // Where it sits: Keep data fresh, in the section bar every admin page shares.
  await expect(page.getByRole("link", { name: "Insights" }).first()).toBeVisible();
});

test("Include staff adds the SuperMakers' own testing to the counts", async ({ page, context, baseURL }) => {
  await signIn(context, DEMO_ACCOUNTS.admin, baseURL);
  await page.goto("/admin/insights");
  const turns = page.locator('[data-insight-total="chatTurns"] dd');
  const without = Number(await turns.textContent());

  await page.getByRole("button", { name: "Include staff" }).click();
  await expect(page).toHaveURL(/staff=1/);
  await expect(page.getByRole("button", { name: /Staff included/ })).toHaveAttribute("aria-pressed", "true");
  const withStaff = Number(await page.locator('[data-insight-total="chatTurns"] dd').textContent());
  expect(withStaff).toBeGreaterThan(without);
});

test("a tool page reached from its QR label tells the server it was seen, once", async ({ page }) => {
  const beacons: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/usage") && request.method() === "POST") beacons.push(request.postDataBuffer()?.toString("utf8") ?? "");
  });
  const answered = page.waitForResponse((res) => res.url().endsWith("/api/usage") && res.request().method() === "POST");
  await page.goto("/tools/form-4?src=qr");
  expect((await answered).status()).toBe(204);
  expect(beacons).toHaveLength(1);
  // A beacon's Blob body is not always visible to the browser's devtools; when it is, it says only this.
  if (beacons[0]) expect(JSON.parse(beacons[0])).toMatchObject({ kind: "tool_view", source: "qr" });

  // The same tab again: sessionStorage remembers, so nothing more is sent.
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(750);
  expect(beacons).toHaveLength(1);
});

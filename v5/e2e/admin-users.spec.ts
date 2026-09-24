import { test, expect } from "@playwright/test";

import { DEMO_ACCOUNTS } from "../src/lib/db/demo-seed";
import { signIn } from "./utils/session";

/**
 * `/admin/users`, end to end (data platform design spec §5.2, §10 scenario 6).
 *
 * The scenario the spec names is one sentence long and is the whole reason
 * Phase 4 exists: **a super admin changes a user to admin, and that person's
 * Add button appears on their next page load.** Nothing is cached across
 * requests, nothing is carried in a cookie, and the only thing that changed is
 * a column.
 *
 * The account it promotes is `DEMO_ACCOUNTS.promotable`, a spare that exists
 * for exactly this: the suite runs its files in parallel against one server,
 * so a test that mutates a shared row must mutate one nobody else asserts on.
 *
 * Sign-in is still unconfigured on this server (`GOOGLE_*` blank), and no test
 * here touches Google. Being somebody is a signed cookie for a seeded session
 * row — see `e2e/utils/session.ts`.
 */

const PLACEHOLDER_LEAK = "{institution}";

/** The tests below run in order: one promotes, the next reads the result. */
test.describe.configure({ mode: "serial" });

/**
 * Headroom for a save. It normally lands in a couple of hundred milliseconds —
 * `RoleSelect` confirms from the action's result rather than waiting out the
 * revalidation that follows it — but this runs beside thirteen other workers
 * against one PGlite database, and five seconds has not always been enough.
 */
const SAVE_TIMEOUT = 15_000;

test.describe("/admin/users — who may open it", () => {
  test("an anonymous visitor is told to sign in, not 404ed", async ({ page }) => {
    await page.goto("/admin/users");

    // A 404 would lie about the page existing; an error boundary would say
    // something went wrong when nothing did (§6).
    await expect(
      page.getByRole("heading", { name: "You are not signed in", level: 1 })
    ).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(PLACEHOLDER_LEAK);
  });

  test("an ordinary student is refused, and told why", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, DEMO_ACCOUNTS.user, baseURL);
    await page.goto("/admin/users");

    await expect(
      page.getByRole("heading", { name: /do not have access/i, level: 1 })
    ).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
  });

  test("a SuperMaker reaches /admin but not the people page", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, DEMO_ACCOUNTS.admin, baseURL);

    // `tools.edit` gets them through the layout…
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Admin surfaces" })).toBeVisible();
    await expect(page.getByRole("link", { name: "People" })).toHaveCount(0);

    // …and `users.manage`, which only a director holds, stops them here.
    await page.goto("/admin/users");
    await expect(
      page.getByRole("heading", { name: /do not have access/i, level: 1 })
    ).toBeVisible();
  });

  test("the header offers the admin link only to those who can use it", async ({
    page,
    context,
    baseURL,
  }) => {
    const nav = page.getByRole("navigation", { name: "Primary navigation" });

    await page.goto("/");
    await expect(nav.getByRole("link", { name: "ADMIN" })).toHaveCount(0);

    await signIn(context, DEMO_ACCOUNTS.admin, baseURL);
    await page.reload();
    // The way into /admin is in the profile menu (2026-09-23).
    await nav.getByRole("button", { name: /signed in as/i }).click();
    await expect(nav.getByRole("menuitem", { name: "ADMIN" })).toBeVisible();
  });
});

test.describe("/admin/users — changing a role", () => {
  test("a director sees the roster, with the last director's own row locked", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, DEMO_ACCOUNTS.superAdmin, baseURL);
    await page.goto("/admin/users");

    await expect(page.getByRole("heading", { name: "People" })).toBeVisible();

    const ownRow = page.getByRole("row", { name: new RegExp(DEMO_ACCOUNTS.superAdmin.name) });
    await expect(ownRow.getByText("you", { exact: true })).toBeVisible();
    // This server boots with AUTH_SUPER_ADMIN_EMAILS blank, so there is no
    // floor — the only thing standing between the lab and a lock-out is the
    // "last director" guard, and it is visible rather than a surprise on save.
    await expect(
      ownRow.getByRole("combobox", { name: new RegExp(DEMO_ACCOUNTS.superAdmin.name) })
    ).toBeDisabled();
    await expect(ownRow.getByText(/last director/i)).toBeVisible();

    await expect(page.locator("body")).not.toContainText(PLACEHOLDER_LEAK);
  });

  test("a director promotes a student, and the change is in the database", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, DEMO_ACCOUNTS.superAdmin, baseURL);
    await page.goto("/admin/users");

    const row = page.getByRole("row", { name: new RegExp(DEMO_ACCOUNTS.promotable.name) });
    const select = row.getByRole("combobox", {
      name: new RegExp(DEMO_ACCOUNTS.promotable.name),
    });

    // This test changes a row and the suite retries a failed test once, so it
    // puts the account back where it expects to find it first. Without this a
    // retry starts from the half-applied state the first attempt left.
    if ((await select.inputValue()) !== "user") {
      await select.selectOption("user");
      await expect(select).toBeEnabled({ timeout: SAVE_TIMEOUT });
    }
    await expect(select).toHaveValue("user");

    await select.selectOption("admin");
    await expect(row.getByText("Saved")).toBeVisible({ timeout: SAVE_TIMEOUT });

    // A reload, not the optimistic state: the row is what the server holds.
    await page.reload();
    await expect(
      page
        .getByRole("row", { name: new RegExp(DEMO_ACCOUNTS.promotable.name) })
        .getByRole("combobox", { name: new RegExp(DEMO_ACCOUNTS.promotable.name) })
    ).toHaveValue("admin");
  });

  test("and that person's Add button appears on their next page load", async ({
    page,
    context,
    baseURL,
  }) => {
    // Spec §10 scenario 6, the half that matters. Same cookie they had before
    // the promotion — sessions are rows, the role is read per request, and
    // nothing had to expire.
    await signIn(context, DEMO_ACCOUNTS.promotable, baseURL);
    await page.goto("/");

    const nav = page.getByRole("navigation", { name: "Primary navigation" });
    await nav.getByRole("button", { name: /signed in as/i }).click();
    await expect(nav.getByRole("menuitem", { name: /add equipment/i })).toBeVisible();
    await expect(nav.getByRole("menuitem", { name: "ADMIN" })).toBeVisible();
  });
});

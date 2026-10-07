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
    await expect(page.getByRole("heading", { name: "Overview", level: 2 })).toBeVisible();
    // Their People section opens Student projects; the roster is never offered.
    await expect(page.getByRole("link", { name: "Roster", exact: true })).toHaveCount(0);

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
    // "last super admin" guard, and it is visible rather than a surprise on
    // save: a short badge, with the full reason as the select's description.
    const ownRole = ownRow.getByRole("combobox", { name: new RegExp(DEMO_ACCOUNTS.superAdmin.name) });
    await expect(ownRole).toBeDisabled();
    await expect(ownRow.getByText("Last super admin", { exact: true })).toBeVisible();
    await expect(ownRole).toHaveAccessibleDescription(/last super admin/i);
    // Roles are named for what they authorize; titles live in their own column.
    await expect(ownRole.locator("option")).toHaveText(["User", "Admin", "Super admin"]);

    await expect(page.locator("body")).not.toContainText(PLACEHOLDER_LEAK);
  });

  test("a director promotes a student, and the change is in the database", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, DEMO_ACCOUNTS.superAdmin, baseURL);
    // No wait for hydration on purpose: `RoleSelect` is disabled until React
    // owns it (`use-hydrated.ts`), and `selectOption` waits for it to be
    // enabled. Before that fix a role chosen early looked saved and was not.
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

test.describe("/admin/users — removing a person (auth spec amendment 2026-09-25)", () => {
  const robin = DEMO_ACCOUNTS.removable;

  test("a director removes somebody and blocks their address; they are signed out at once", async ({
    page,
    context,
    baseURL,
    browser,
  }) => {
    // Robin is signed in somewhere else before the removal.
    const robinContext = await browser.newContext({ baseURL });
    await signIn(robinContext, robin, baseURL);

    await signIn(context, DEMO_ACCOUNTS.superAdmin, baseURL);
    await page.goto("/admin/users");
    const table = page.getByRole("table", { name: "People and their roles" });
    const blocked = page.getByRole("table", { name: "Blocked email addresses" });
    const robinRow = table.getByRole("row", { name: new RegExp(robin.name) });

    // A retry after the removal landed finds Robin already gone and blocked:
    // it checks that state rather than failing on a row that cannot come back.
    // The roster draws its table once it has hydrated, so wait for it before
    // counting: `count()` does not wait, and an unhydrated page has no rows.
    await expect(table.getByRole("row").first()).toBeVisible();
    if ((await robinRow.count()) > 0) {
      await robinRow.getByRole("button", { name: `Remove ${robin.name}` }).click();

      // It asks first, inline, and says what happens.
      await expect(
        robinRow.getByText(
          `Remove ${robin.name}? They lose access and their account is deleted. Their reports and history stay.`
        )
      ).toBeVisible();
      await robinRow.getByRole("checkbox", { name: "Also block this email from signing up again" }).click();
      await robinRow.getByRole("textbox", { name: `Reason for blocking ${robin.email}` }).fill("E2E removal");
      await robinRow.getByRole("button", { name: `Remove ${robin.name}` }).click();

      await expect(
        page.getByText(`${robin.name} was removed, and ${robin.email} is blocked from signing up again.`)
      ).toBeVisible({ timeout: SAVE_TIMEOUT });
      await expect(robinRow).toHaveCount(0);
    }

    // A reload: the server agrees.
    await page.reload();
    await expect(robinRow).toHaveCount(0);
    await expect(blocked.getByRole("row", { name: new RegExp(robin.email) })).toContainText("E2E removal");

    // Robin's session went with the account: the same cookie is anonymous now.
    const identity = await robinContext.request.get("/api/identity");
    expect((await identity.json()).role).toBe("anonymous");
    await robinContext.close();
  });

  test("the director cannot remove themselves, and is told why", async ({ page, context, baseURL }) => {
    await signIn(context, DEMO_ACCOUNTS.superAdmin, baseURL);
    await page.goto("/admin/users");

    const ownRow = page
      .getByRole("table", { name: "People and their roles" })
      .getByRole("row", { name: new RegExp(DEMO_ACCOUNTS.superAdmin.name) });
    await expect(ownRow.getByRole("button", { name: `Remove ${DEMO_ACCOUNTS.superAdmin.name}` })).toBeDisabled();
    await expect(ownRow.getByText("Your account", { exact: true })).toBeVisible();
    await expect(
      ownRow.getByRole("button", { name: `Remove ${DEMO_ACCOUNTS.superAdmin.name}` })
    ).toHaveAccessibleDescription("You cannot remove yourself.");
  });

  test("and unblocks the address from the Blocked emails list", async ({ page, context, baseURL }) => {
    await signIn(context, DEMO_ACCOUNTS.superAdmin, baseURL);
    await page.goto("/admin/users");
    const blocked = page.getByRole("table", { name: "Blocked email addresses" });

    // Wait for the roster before counting (see the removal test above).
    await expect(page.getByRole("table", { name: "People and their roles" }).getByRole("row").first()).toBeVisible();
    if ((await blocked.getByRole("row", { name: new RegExp(robin.email) }).count()) > 0) {
      await blocked.getByRole("button", { name: `Unblock ${robin.email}` }).click();
      await expect(page.getByText(`${robin.email} can sign up again.`)).toBeVisible({ timeout: SAVE_TIMEOUT });
    }

    await page.reload();
    await expect(page.getByRole("heading", { name: "Blocked emails" })).toBeVisible();
    await expect(page.getByText("No addresses are blocked.")).toBeVisible();
  });
});

test.describe("/admin/users — adding somebody before they sign in", () => {
  const email = "e2e-added-person@cornell.edu";

  test("a super admin adds a person, who shows as not signed in yet, and can be removed again", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, DEMO_ACCOUNTS.superAdmin, baseURL);
    await page.goto("/admin/users");
    const table = page.getByRole("table", { name: "People and their roles" });
    const row = table.getByRole("row", { name: new RegExp(email) });
    const addForm = page.locator("form").filter({ has: page.getByRole("textbox", { name: "Email" }) });

    // A retry after the add landed finds the row already there — once the
    // roster is on screen (see the removal test above).
    await expect(table.getByRole("row").first()).toBeVisible();
    if ((await row.count()) === 0) {
      await page.getByRole("button", { name: "Add person" }).click();
      // One "Add person" on screen at a time: the opener is gone while the form is open.
      await expect(page.getByRole("button", { name: "Add person" })).toHaveCount(0);
      await page.getByRole("textbox", { name: "Email" }).fill(email.toUpperCase());
      await page.getByRole("combobox", { name: "Role", exact: true }).selectOption("admin");
      await page.getByRole("textbox", { name: "Title", exact: true }).fill("Tech Lead");
      await addForm.getByRole("button", { name: "Add", exact: true }).click();
      await expect(page.getByText(`${email} was added.`)).toBeVisible({ timeout: SAVE_TIMEOUT });
    }

    await page.reload();
    await expect(row).toHaveCount(1, { timeout: SAVE_TIMEOUT });
    await expect(row.getByText("Not signed in yet")).toBeVisible();
    await expect(row.getByTestId("person-title")).toHaveText("Tech Lead");
    await expect(row.getByRole("combobox", { name: new RegExp(email) })).toHaveValue("admin");

    // Adding the same address again is refused, in words.
    await page.getByRole("button", { name: "Add person" }).click();
    await page.getByRole("textbox", { name: "Email" }).fill(email);
    await addForm.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText("Somebody with that address is already on the list.")).toBeVisible({
      timeout: SAVE_TIMEOUT,
    });
    await addForm.getByRole("button", { name: "Cancel" }).click();

    // A super admin names them before they ever sign in; Google will not replace it.
    if ((await row.getByTestId("person-name").textContent()) === email) {
      await row.getByRole("button", { name: `Edit the name for ${email}` }).click();
      const nameField = row.getByRole("textbox", { name: `Name for ${email}` });
      await nameField.fill("  E2E   Added Person ");
      await nameField.press("Enter");
      await expect(row.getByTestId("person-name")).toHaveText("E2E Added Person", { timeout: SAVE_TIMEOUT });
    }
    await page.reload();
    await expect(row.getByTestId("person-name")).toHaveText("E2E Added Person");
    // Their address is said under the name now that it is no longer the name.
    await expect(row.getByText(email, { exact: true })).toBeVisible();

    // And somebody who never signed in can be removed like anyone else.
    await row.getByRole("button", { name: "Remove E2E Added Person" }).click();
    await row.getByRole("button", { name: "Remove E2E Added Person" }).click();
    await expect(page.getByText("E2E Added Person was removed.")).toBeVisible({ timeout: SAVE_TIMEOUT });
    await page.reload();
    await expect(row).toHaveCount(0);
  });

  test("Cancel and Escape close the form without adding anybody, and hand focus back", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, DEMO_ACCOUNTS.superAdmin, baseURL);
    await page.goto("/admin/users");
    const opener = page.getByRole("button", { name: "Add person" });
    const emailField = page.getByRole("textbox", { name: "Email" });

    await opener.click();
    await emailField.fill("never-added@cornell.edu");
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(emailField).toHaveCount(0);
    await expect(opener).toBeFocused();

    await opener.click();
    await expect(emailField).toHaveValue("");
    await emailField.fill("never-added@cornell.edu");
    await emailField.press("Escape");
    await expect(emailField).toHaveCount(0);
    await expect(opener).toBeFocused();

    await expect(page.getByRole("row", { name: /never-added@cornell\.edu/ })).toHaveCount(0);
  });
});

test.describe("/admin/users — sorting and filtering the roster", () => {
  test("sorts by Person from the header, with aria-sort", async ({ page, context, baseURL }) => {
    await signIn(context, DEMO_ACCOUNTS.superAdmin, baseURL);
    await page.goto("/admin/users");
    const table = page.getByRole("table", { name: "People and their roles" });
    const personHeader = table.getByRole("columnheader", { name: /Person/ });
    const names = async () => (await table.getByTestId("person-name").allTextContents()).map((n) => n.trim());

    await personHeader.getByRole("button").click();
    await expect(personHeader).toHaveAttribute("aria-sort", "ascending");
    const ascending = await names();
    expect(ascending).toEqual([...ascending].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));

    await personHeader.getByRole("button").click();
    await expect(personHeader).toHaveAttribute("aria-sort", "descending");
    expect(await names()).toEqual([...ascending].reverse());
  });

  test("filters by signed in and by title, into a link that reopens the same view", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, DEMO_ACCOUNTS.superAdmin, baseURL);
    await page.goto("/admin/users");
    const table = page.getByRole("table", { name: "People and their roles" });
    const filters = page.getByRole("search");

    await filters.getByRole("button", { name: "Signed in" }).click();
    await page.getByRole("menuitemradio", { name: /^Signed in/ }).click();
    await expect(page).toHaveURL(/signed_in=yes/);
    await expect(table.getByText("Not signed in yet")).toHaveCount(0);

    await filters.getByRole("button", { name: "Title" }).click();
    await page.getByRole("menuitemradio", { name: /^Super Admin/ }).click();
    await expect(page).toHaveURL(/title=Super\+Admin/);
    await expect(filters.getByRole("button", { name: /Title: Super Admin/ })).toBeVisible();
    await expect(table.getByRole("row", { name: new RegExp(DEMO_ACCOUNTS.superAdmin.name) })).toBeVisible();
    const titles = await table.getByTestId("person-title").allTextContents();
    expect(titles.length).toBeGreaterThan(0);
    for (const title of titles) expect(title).toBe("Super Admin");
    await expect(table.getByRole("row", { name: new RegExp(DEMO_ACCOUNTS.superAdmin.name) })).toBeVisible();

    // The URL is the view: a reload lands on the same narrowed roster.
    await page.reload();
    await expect(filters.getByRole("button", { name: /Title: Super Admin/ })).toBeVisible();
    await expect(table.getByTestId("person-title")).toHaveText(titles);
  });
});

test.describe("/account — your own name", () => {
  const pat = DEMO_ACCOUNTS.promotable;

  test("anybody signed in renames themselves, and it sticks", async ({ page, context, baseURL }) => {
    await signIn(context, pat, baseURL);
    await page.goto("/account");
    await expect(page.getByRole("heading", { name: "Your account", level: 1 })).toBeVisible();
    await expect(page.getByText(pat.email, { exact: true })).toBeVisible();

    const name = page.getByTestId("own-name");
    const rename = async (to: string) => {
      await page.getByRole("button", { name: "Edit your name" }).click();
      const field = page.getByRole("textbox", { name: "Your name" });
      await field.fill(to);
      await field.press("Enter");
      await expect(name).toHaveText(to.trim(), { timeout: SAVE_TIMEOUT });
    };

    await rename("Pat P. Renamed ");
    await page.reload();
    await expect(name).toHaveText("Pat P. Renamed");

    // Blank is refused, in words, and nothing changes.
    await page.getByRole("button", { name: "Edit your name" }).click();
    await page.getByRole("textbox", { name: "Your name" }).fill("   ");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("A name needs 1 to 80 characters.")).toBeVisible({ timeout: SAVE_TIMEOUT });
    await page.getByRole("button", { name: "Cancel" }).click();

    // Put it back: the roster tests above find Pat by name.
    await rename(pat.name);
  });
});

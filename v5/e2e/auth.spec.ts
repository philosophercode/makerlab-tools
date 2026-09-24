import { test, expect } from "@playwright/test";

import { DEMO_ACCOUNTS } from "../src/lib/db/demo-seed";
import {
  BETTER_AUTH_SESSION_COOKIE,
  E2E_AUTH_SECRET,
  signCookieValue,
  signIn,
} from "./utils/session";

// Sign-in (data platform design spec §3.4, §10). Two properties are worth an
// E2E each: signing in never gates the front door, and the header reflects who
// the server says you are.
//
// **No real Google OAuth.** Driving it in CI is neither possible nor desirable,
// and the E2E server boots with GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET blank
// — so `/api/auth/sign-in/social` answers 503 and the header says sign-in is
// not set up here.
//
// It is nonetheless a *genuine* session that is asserted below, not a stub.
// Sessions are database rows since Phase 4, so the demo seed ships one account
// per role with a known session token (`DEMO_ACCOUNTS`), the Playwright server
// boots with a test-only `AUTH_SECRET`, and the cookie below is signed with it
// exactly the way Better Auth signs one. Nothing is intercepted: the real
// `/api/identity` reads the real session row and reports the real role.

const SIGNED_IN = DEMO_ACCOUNTS.user;
/** PrimaryNav shows the first name only (spec §6). */
const USER_FIRST_NAME = SIGNED_IN.name.split(" ")[0];

test.describe("Sign-in", () => {
  test("anonymous visitors browse the catalog and open a tool page", async ({
    page,
  }) => {
    // No cookie: this is the real /api/identity answering anonymous, which is
    // what an ISAM attendee who never creates an account will get.
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: "TOOLS // MACHINES" })
    ).toBeVisible();

    await page
      .getByRole("link")
      .filter({
        has: page.getByRole("heading", { name: "Form 4", level: 2 }),
      })
      .click();

    // The full detail page, not a sign-in wall: name, units and serial all render.
    await expect(page).toHaveURL(/\/tools\/form-4$/);
    await expect(
      page.getByRole("heading", { name: "Form 4", level: 1 })
    ).toBeVisible();
    await expect(page.getByText("ML-F4-001")).toBeVisible();

    // Nothing redirected to the rejected-domain page or any sign-in route.
    await expect(page).not.toHaveURL(/\/auth\//);
  });

  test("the sign-in control is visible when signed out", async ({ page }) => {
    await page.goto("/");

    const nav = page.getByRole("navigation", { name: "Primary navigation" });

    // nav.signInAria => "Sign in with your {institution} account". Matched loosely
    // so the assertion does not hardcode the institution (Article 6).
    await expect(nav.getByRole("button", { name: /sign in/i })).toBeVisible();
    await expect(nav.getByRole("button", { name: /sign out/i })).toHaveCount(0);
  });

  test("a real signed session cookie shows the user's name in the header", async ({
    page,
    context,
    baseURL,
  }) => {
    const nav = page.getByRole("navigation", { name: "Primary navigation" });

    // No cookie first: the header must offer sign-in. Asserting both halves is
    // what makes the session — rather than the page — the thing under test.
    await page.goto("/");
    await expect(nav.getByRole("button", { name: /sign in/i })).toBeVisible();

    await signIn(context, SIGNED_IN, baseURL);
    await page.reload();

    await expect(nav.getByText(USER_FIRST_NAME, { exact: true })).toBeVisible();
    await expect(nav.getByRole("button", { name: /sign out/i })).toBeVisible();
    await expect(nav.getByRole("button", { name: /sign in/i })).toHaveCount(0);
  });

  test("an ordinary signed-in user gets no admin controls", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, DEMO_ACCOUNTS.user, baseURL);
    await page.goto("/");

    const nav = page.getByRole("navigation", { name: "Primary navigation" });
    await expect(nav.getByRole("button", { name: /sign out/i })).toBeVisible();

    // `tools.add` and `tools.edit` are not granted to `user` (auth/permissions).
    await expect(
      nav.getByRole("button", { name: /Add new equipment/i })
    ).toHaveCount(0);
    await expect(nav.getByRole("button", { name: /Refresh the/i })).toHaveCount(0);
  });

  test("an admin's role comes from their row, and unlocks the admin controls", async ({
    page,
    context,
    baseURL,
  }) => {
    // The end-to-end proof that the role is read per request from the database
    // rather than carried in the cookie: the same kind of cookie, a different
    // row, a different set of controls.
    await signIn(context, DEMO_ACCOUNTS.admin, baseURL);
    await page.goto("/");

    const nav = page.getByRole("navigation", { name: "Primary navigation" });
    await expect(nav.getByRole("button", { name: /Add new equipment/i })).toBeVisible();
    await expect(nav.getByRole("button", { name: /Refresh the/i })).toBeVisible();
  });

  test("a cookie signed with the wrong secret is nobody", async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([
      {
        name: BETTER_AUTH_SESSION_COOKIE,
        // Same real session token, signed with anything but the server's key.
        value: await signCookieValue(
          SIGNED_IN.sessionToken,
          `${E2E_AUTH_SECRET}-but-wrong`
        ),
        url: baseURL ?? "http://localhost:3100",
      },
    ]);
    await page.goto("/");

    const nav = page.getByRole("navigation", { name: "Primary navigation" });
    await expect(nav.getByRole("button", { name: /sign in/i })).toBeVisible();
  });
});

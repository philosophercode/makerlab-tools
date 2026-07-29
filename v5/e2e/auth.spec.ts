import { test, expect } from "@playwright/test";

// Sign-in (auth design spec 2026-07-29 §5, §6, §10). Two properties are worth an
// E2E each: signing in never gates the front door, and the header reflects who
// the server says you are.
//
// **No real Google OAuth.** Driving it in CI is neither possible nor desirable
// (spec §10), and the E2E server boots with no credentials at all.
//
// Which means a *genuinely* signed cookie cannot be minted here either: the
// session cookie is an HMAC over `AUTH_SECRET`, and the E2E server has none, so
// anything the browser sends resolves to anonymous by design. The header's whole
// view of the session is `GET /api/identity` (see the spec's `/api/identity`
// amendment), so the stub below sits at that boundary and answers *from the
// cookie the browser actually sent*. The cookie is still what flips the header;
// the stub stands in only for the signature check the server cannot perform.

/** Mirrors SESSION_COOKIE_NAME in src/lib/auth/session-cookie.ts. */
const SESSION_COOKIE = "makerlab.identity";

/** Opaque: nothing verifies it. Shaped like a real token so it is not mistaken for one. */
const STUB_TOKEN = "e2e-stub-session.not-a-real-signature";

const USER_NAME = "Casey Rivera";
/** PrimaryNav shows the first name only (spec §6). */
const USER_FIRST_NAME = "Casey";

/**
 * Answer `/api/identity` as a server holding `AUTH_SECRET` would: signed in when
 * the request carries the session cookie, anonymous when it does not.
 */
async function stubIdentityFromCookie(page: import("@playwright/test").Page) {
  await page.route("**/api/identity", async (route) => {
    const headers = await route.request().allHeaders();
    const signedIn = (headers["cookie"] || "").includes(`${SESSION_COOKIE}=`);
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store, private",
      },
      body: JSON.stringify(
        signedIn
          ? { role: "student", name: USER_NAME }
          : { role: "anonymous", name: null }
      ),
    });
  });
}

test.describe("Sign-in", () => {
  test("anonymous visitors browse the catalog and open a tool page", async ({
    page,
  }) => {
    // No stub and no cookie: this is the real /api/identity answering anonymous,
    // which is what an ISAM attendee who never creates an account will get.
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

  test("with a stubbed session cookie the header shows the user's name", async ({
    page,
    context,
    baseURL,
  }) => {
    await stubIdentityFromCookie(page);

    const nav = page.getByRole("navigation", { name: "Primary navigation" });

    // Same stub, no cookie: the header must still offer sign-in. Asserting both
    // halves is what makes the cookie — rather than the stub — the thing under
    // test.
    await page.goto("/");
    await expect(nav.getByRole("button", { name: /sign in/i })).toBeVisible();

    await context.addCookies([
      {
        name: SESSION_COOKIE,
        value: STUB_TOKEN,
        url: baseURL ?? "http://localhost:3100",
      },
    ]);
    await page.reload();

    await expect(nav.getByText(USER_FIRST_NAME, { exact: true })).toBeVisible();
    await expect(nav.getByRole("button", { name: /sign out/i })).toBeVisible();
    await expect(nav.getByRole("button", { name: /sign in/i })).toHaveCount(0);
  });
});

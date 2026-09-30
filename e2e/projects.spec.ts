import { test, expect } from "@playwright/test";

import { DEMO_ACCOUNTS } from "../src/lib/db/demo-seed";
import { signIn } from "./utils/session";

// The app boots with no DATABASE_URL and NOTION_* unset (see
// playwright.config.ts webServer.env), so the gallery reads the PGlite demo
// seed — one published sample project, "Laser-cut plywood lamp"
// (src/lib/db/demo-seed.ts). As of Phase 3 `POST /api/projects` writes into
// that same database and needs no credential, so one test below submits for
// real, end to end.
//
// The other submit tests keep `page.route("**/api/projects")` standing in for
// the route handler — not because the route would refuse, but because the
// exact request body and the failure branch are cheaper to assert that way.
// Nothing in this file reaches a real service either way.
//
// Strings come from messages/en.json (`projects.*`, `projectForm.*`). Branding
// is deliberately NOT asserted literally — `siteConfig.institution` is
// configurable (Article 6). What IS asserted is that the `{institution}`
// placeholder was given a param at the call site: an unpassed placeholder
// renders as the literal text "{institution}", which has been a real bug here.

const PLACEHOLDER_LEAK = "{institution}";

/** Fills the two fields the form requires before it will POST. */
async function fillRequiredFields(page: import("@playwright/test").Page) {
  await page
    .getByRole("textbox", { name: "Project title" })
    .fill("Parametric stool");
  await page
    .getByRole("textbox", { name: /Write-up/ })
    .fill("Cut on the Trotec, assembled with wedged tenons.");
  // No name field since Phase 4: the byline is the session's (spec §5.5).
}

test.describe("Projects gallery", () => {
  test("renders the sample project and opens its page", async ({ page }) => {
    await page.goto("/projects");

    // projects.title => "Student projects", set in capitals by CSS (the name is case-insensitive here).
    await expect(
      page.getByRole("heading", { name: "STUDENT PROJECTS", level: 1 })
    ).toBeVisible();

    // The lede describes the gallery, and its {institution} placeholder resolved.
    await expect(
      page.getByText(/Builds, experiments, and course outcomes from/i)
    ).toBeVisible();

    // The demo seed's one published project is listed, with no failure language.
    const card = page.getByRole("link").filter({ hasText: "Laser-cut plywood lamp" }).first();
    await expect(card).toBeVisible();
    await expect(
      page.getByText(/error|failed|unavailable|something went wrong/i)
    ).toHaveCount(0);

    // Whole-page check: no locale placeholder rendered literally anywhere.
    await expect(page.locator("body")).not.toContainText(PLACEHOLDER_LEAK);

    // Its page shows the write-up, the outside link and the tools it was built with.
    await card.click();
    await expect(page).toHaveURL(/\/projects\/laser-cut-plywood-lamp$/);
    await expect(
      page.getByRole("heading", { name: "Laser-cut plywood lamp", level: 1 })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /wikipedia/i }).first()
    ).toHaveAttribute("href", /en\.wikipedia\.org\/wiki\/Laser_cutting/);
    await expect(page.getByRole("link", { name: "Trotec Speedy 400" })).toBeVisible();
  });

  test("the empty state's call to action reaches the submit form", async ({
    page,
  }) => {
    await page.goto("/projects");

    // Two "Submit a project" links render (header action + empty state); both
    // point at the same route, so the first is representative.
    await page.getByRole("link", { name: "Submit a project" }).first().click();

    await expect(page).toHaveURL(/\/projects\/new$/);
    await expect(
      page.getByRole("heading", { name: "Share your project", level: 1 })
    ).toBeVisible();
  });
});

test.describe("Project submission form", () => {
  // Submitting requires an account since Phase 4 (spec §5.5). Every test in
  // this block is a signed-in student; the anonymous path is its own block
  // below, and browsing the gallery above never needed a cookie.
  test.beforeEach(async ({ context, baseURL }) => {
    await signIn(context, DEMO_ACCOUNTS.user, baseURL);
  });

  test("/projects/new renders every field a submission needs", async ({
    page,
  }) => {
    await page.goto("/projects/new");

    await expect(
      page.getByRole("heading", { name: "Share your project", level: 1 })
    ).toBeVisible();

    // The lede states up front that submissions are reviewed (spec §5 — a
    // student who submits and sees nothing must not assume it was lost).
    await expect(
      page.getByText(/Submissions are reviewed before they appear in the gallery/i)
    ).toBeVisible();

    await expect(
      page.getByRole("textbox", { name: "Project title" })
    ).toBeVisible();
    // The byline is stated, not asked for: it is the session's display name
    // and the server writes it whatever the request says.
    await expect(
      page.getByText(`Your project will be credited to ${DEMO_ACCOUNTS.user.name}`)
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Your name" })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: /Write-up/ })).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Link (optional)" })
    ).toBeVisible();

    // Tools-used chips come from the demo catalogue via getCatalogTools().
    await expect(
      page.getByRole("button", { name: "Form 4", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Trotec Speedy 400", exact: true })
    ).toBeVisible();

    await expect(
      page.getByRole("button", { name: "Submit project" })
    ).toBeEnabled();

    await expect(page.locator("body")).not.toContainText(PLACEHOLDER_LEAK);
  });

  test("an empty submission is blocked in the browser and never posts", async ({
    page,
  }) => {
    let posts = 0;
    await page.route("**/api/projects", async (route) => {
      posts += 1;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ id: "should-not-happen" }),
      });
    });

    await page.goto("/projects/new");
    await page.getByRole("button", { name: "Submit project" }).click();

    // Title / name / write-up are `required`, so Chromium blocks the submit
    // before React's handler runs and focuses the first invalid control. The
    // native bubble is not in the DOM, so the moved focus is the observable
    // proof that validation ran *because of the click* — an assertion on
    // `validity.valueMissing` alone would have been true before it too.
    await expect(
      page.getByRole("textbox", { name: "Project title" })
    ).toBeFocused();

    // Still on the form; the confirmation never replaced it.
    await expect(
      page.getByRole("heading", { name: "Share your project", level: 1 })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /pending review/i })
    ).toHaveCount(0);

    // The load-bearing assertion: nothing was sent.
    expect(posts).toBe(0);
  });

  test("a title-only submission still does not post", async ({ page }) => {
    let posts = 0;
    await page.route("**/api/projects", async (route) => {
      posts += 1;
      await route.fulfill({ status: 201, body: "{}" });
    });

    await page.goto("/projects/new");
    await page
      .getByRole("textbox", { name: "Project title" })
      .fill("Half-filled submission");
    await page.getByRole("button", { name: "Submit project" }).click();

    // Validation moves to the next missing field — the write-up, now that the
    // byline is not a field — rather than letting a half-filled submission
    // through.
    await expect(page.getByRole("textbox", { name: /Write-up/ })).toBeFocused();
    expect(posts).toBe(0);
  });

  test("a valid submission confirms that it is awaiting review", async ({
    page,
  }) => {
    const bodies: unknown[] = [];
    await page.route("**/api/projects", async (route) => {
      bodies.push(route.request().postDataJSON());
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ id: "proj_e2e" }),
      });
    });

    await page.goto("/projects/new");
    await fillRequiredFields(page);
    await page.getByRole("button", { name: "Trotec Speedy 400", exact: true }).click();
    await page.getByRole("button", { name: "Submit project" }).click();

    // projectForm.thanksTitle / thanksBody. The confirmation has to say the
    // submission is pending and will appear once staff publish it (spec §5) —
    // that sentence is the feature, so it is asserted rather than the fact
    // that *some* confirmation appeared.
    await expect(
      page.getByRole("heading", { name: /pending review/i, level: 1 })
    ).toBeVisible();
    await expect(page.getByText(/review your submission/i)).toBeVisible();
    await expect(page.getByText(/publish it to the gallery/i)).toBeVisible();

    // The form is gone — no ambiguity about whether it was sent.
    await expect(
      page.getByRole("textbox", { name: "Project title" })
    ).toHaveCount(0);

    // And the way back is offered.
    await expect(
      page.getByRole("link", { name: "Back to gallery" })
    ).toHaveAttribute("href", "/projects");

    // One POST, carrying what was typed and the tool that was chosen. The
    // client sends no `published` field at all — Article 5 lives in the route,
    // which is asserted in its integration test; this is the client half.
    expect(bodies).toHaveLength(1);
    const payload = bodies[0] as Record<string, unknown>;
    expect(payload.title).toBe("Parametric stool");
    // No author in the body since Phase 4: the byline is the session's, and
    // the form sends nothing the server would ignore (spec §5.5).
    expect(payload).not.toHaveProperty("author");
    // The chosen tool travels as its database id (a uuid), not its slug.
    expect(payload.tools).toEqual([
      expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
    ]);
    expect(payload).not.toHaveProperty("published");
  });

  test("a failed submission keeps the write-up on screen", async ({ page }) => {
    await page.route("**/api/projects", async (route) => {
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ error: "Submission failed. Please try again." }),
      });
    });

    await page.goto("/projects/new");
    await fillRequiredFields(page);
    await page.getByRole("button", { name: "Submit project" }).click();

    // The error is announced, not swallowed. Scoped to the form: Next's
    // route announcer is also role="alert" and would make a bare lookup
    // ambiguous.
    await expect(page.locator("form").getByRole("alert")).toHaveText(
      "Submission failed. Please try again."
    );

    // …and the student's write-up survives it (spec §5 unhappy paths: losing a
    // write-up to a failed POST is one of the cases that would embarrass us).
    await expect(page.getByRole("textbox", { name: /Write-up/ })).toHaveValue(
      "Cut on the Trotec, assembled with wedged tenons."
    );
    await expect(
      page.getByRole("textbox", { name: "Project title" })
    ).toHaveValue("Parametric stool");
    await expect(
      page.getByRole("button", { name: "Submit project" })
    ).toBeEnabled();
  });
});

// A genuinely end-to-end submission, possible for the first time in Phase 3.
// What it proves is Article 5 made visible: a submitted project is a draft, so
// the gallery does not show it until staff publish it.
test.describe("Project submission — the real write path", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await signIn(context, DEMO_ACCOUNTS.user, baseURL);
  });

  test("a submission with no interception is accepted and does NOT appear in the gallery", async ({
    page,
  }) => {
    const statuses: number[] = [];
    page.on("response", (res) => {
      if (res.url().includes("/api/projects")) statuses.push(res.status());
    });

    await page.goto("/projects/new");
    await page
      .getByRole("textbox", { name: "Project title" })
      .fill("Unpublished by design");
    await page
      .getByRole("textbox", { name: /Write-up/ })
      .fill("Submitted end to end against the real route.");
    await page.getByRole("button", { name: "Submit project" }).click();

    await expect(
      page.getByRole("heading", { name: /pending review/i, level: 1 })
    ).toBeVisible();
    // A 503 here would mean the route still thinks it needs a credential.
    expect(statuses).toEqual([201]);

    // The whole point of `published: false`: it is stored, and invisible.
    await page.goto("/projects");
    await expect(page.getByText("Unpublished by design")).toHaveCount(0);
    // The published sample is still there, so the assertion above is about
    // publication rather than an empty gallery.
    await expect(
      page.getByRole("link").filter({ hasText: "Laser-cut plywood lamp" }).first()
    ).toBeVisible();
  });

  test("the photo control says uploads are unavailable with no blob store", async ({
    page,
  }) => {
    // The E2E server runs with BLOB_READ_WRITE_TOKEN unset, which is the whole
    // credential-free premise. The honest degradation is worth asserting: the
    // route refuses, the message is translated, and the form still submits.
    await page.goto("/projects/new");

    await page
      .locator('input[type="file"]')
      .setInputFiles({
        name: "lamp.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489",
          "hex"
        ),
      });

    // `[data-slot="form-error"]` rather than role=alert: Next's route announcer is
    // also a live region, and two matches is a strict-mode violation.
    await expect(page.locator("[data-slot=\"form-error\"]")).toContainText(
      "Photo uploads are unavailable"
    );
    await expect(
      page.getByRole("button", { name: "Submit project" })
    ).toBeEnabled();
  });
});

// Spec §10 scenario 1's last clause: an anonymous visitor browses, opens a
// tool, and *cannot submit a project*.
test.describe("Project submission — anonymous visitors", () => {
  test("/projects/new offers the sign-in prompt instead of the form", async ({
    page,
  }) => {
    // No cookie. The real /api/identity answers anonymous, which is what an
    // ISAM attendee who never creates an account gets.
    await page.goto("/projects/new");

    await expect(
      page.getByRole("heading", { name: "Sign in to share your project", level: 1 })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Submit project" })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Project title" })).toHaveCount(0);

    // Not a dead end and not a redirect: browsing stays open to them.
    await expect(page.getByRole("link", { name: "Browse projects" })).toBeVisible();
    await expect(page).toHaveURL(/\/projects\/new$/);
    await expect(page.locator("body")).not.toContainText(PLACEHOLDER_LEAK);
  });

  test("the route itself refuses an anonymous POST, not only the form", async ({
    request,
  }) => {
    // The form's prompt is presentation; this is the control (§8).
    const res = await request.post("/api/projects", {
      data: { title: "Sneaked in", body: "Posted without a session." },
    });

    expect(res.status()).toBe(401);
    expect(await res.json()).toMatchObject({ code: "sign_in_required" });
  });
});

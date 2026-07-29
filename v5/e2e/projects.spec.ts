import { test, expect } from "@playwright/test";

// The app boots with NOTION_* unset (see playwright.config.ts webServer.env),
// so `hasProjectsEnv()` is false: `getPublishedProjects()` returns [] without
// ever calling Notion, and `POST /api/projects` answers 503 "not configured".
// That is the correct production behaviour for a lab that has not created the
// Projects database yet — so the gallery here is asserted as an *intentional*
// empty state, not a broken one.
//
// The submit path is therefore exercised with `page.route("**/api/projects")`
// standing in for the route handler, exactly as chat.spec.ts stands in for
// /api/chat. Nothing in this file reaches a real service.
//
// Strings come from messages/en.json (`projects.*`, `projectForm.*`). Branding
// is deliberately NOT asserted literally — `siteConfig.institution` is
// configurable (Article 6). What IS asserted is that the `{institution}`
// placeholder was given a param at the call site: an unpassed placeholder
// renders as the literal text "{institution}", which has been a real bug here.

const PLACEHOLDER_LEAK = "{institution}";

/** Fills the three fields the form requires before it will POST. */
async function fillRequiredFields(page: import("@playwright/test").Page) {
  await page
    .getByRole("textbox", { name: "Project title" })
    .fill("Parametric stool");
  await page.getByRole("textbox", { name: "Your name" }).fill("Ada Lovelace");
  await page
    .getByRole("textbox", { name: /Write-up/ })
    .fill("Cut on the Trotec, assembled with wedged tenons.");
}

test.describe("Projects gallery", () => {
  test("renders an intentional empty state with no Projects database", async ({
    page,
  }) => {
    await page.goto("/projects");

    // projects.title => "STUDENT PROJECTS".
    await expect(
      page.getByRole("heading", { name: "STUDENT PROJECTS", level: 1 })
    ).toBeVisible();

    // The lede describes the gallery rather than apologising for it, and its
    // {institution} placeholder resolved.
    await expect(
      page.getByText(/Builds, experiments, and course outcomes from/i)
    ).toBeVisible();

    // projects.empty — reads as "nothing published yet", not as an error. No
    // failure language, and the invitation to submit is still offered.
    await expect(
      page.getByText("No projects published yet. Be the first to share your build.")
    ).toBeVisible();
    await expect(
      page.getByText(/error|failed|unavailable|something went wrong/i)
    ).toHaveCount(0);

    // Whole-page check: no locale placeholder rendered literally anywhere.
    await expect(page.locator("body")).not.toContainText(PLACEHOLDER_LEAK);
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
    // Anonymous in E2E (no auth env, /api/identity answers role "anonymous"),
    // so the byline is typed rather than pre-filled and read-only.
    const author = page.getByRole("textbox", { name: "Your name" });
    await expect(author).toBeVisible();
    await expect(author).toBeEditable();
    await expect(page.getByRole("textbox", { name: /Write-up/ })).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Link (optional)" })
    ).toBeVisible();

    // Tools-used chips come from the mock catalog via getCatalogTools().
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

    // Validation moves to the next missing field rather than letting a
    // half-filled submission through.
    await expect(
      page.getByRole("textbox", { name: "Your name" })
    ).toBeFocused();
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
    expect(payload.author).toBe("Ada Lovelace");
    expect(payload.tools).toEqual(["tool-trotec-speedy-400"]);
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

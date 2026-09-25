import { test, expect } from "@playwright/test";

import { DEMO_ACCOUNTS } from "../src/lib/db/demo-seed";
import { signIn } from "./utils/session";

/**
 * The tool editor, opened from both surfaces (data platform design spec
 * §5.3(3), §5.3(b), §6).
 *
 * What these check is the thing only a browser can: that the panel opens on
 * both surfaces, that its server actions survive the trip through a client
 * island as props, and that the control is invisible to everyone who may not
 * edit.
 *
 * **Exactly one describe here writes**, and it is the §10 scenario the whole
 * phase is for: a SuperMaker standing at a machine takes it out of service and
 * the public page says so. Every spec in this suite shares one PGlite database
 * and the workers run in parallel, so that block is `serial`, it touches the
 * **Trotec's** unit status — a field no other spec reads, on the tool
 * `qr-arrival.spec.ts` does *not* compare two renderings of — and it puts the
 * value back when it is done. It never clicks "Looks good": `admin-inventory`
 * asserts that nothing in the seed has ever been reviewed.
 */

test.describe("the editor on /admin/inventory", () => {
  test("opens from a row, and reads the tool for itself", async ({ page, context, baseURL }) => {
    await signIn(context, DEMO_ACCOUNTS.admin, baseURL);
    await page.goto("/admin/inventory");

    await page
      .getByRole("row", { name: /Form 4/ })
      .getByRole("button", { name: "Edit" })
      .click();

    // The panel mints its own revision on open rather than trusting the page —
    // so the fields appearing at all is the load action having answered.
    const panel = page.getByRole("complementary", { name: "Editing Form 4" });
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByLabel("Display name")).toHaveValue("Form 4");
    await expect(panel.getByRole("button", { name: "Looks good" })).toBeVisible();

    await panel.getByRole("button", { name: "Close" }).click();
    await expect(panel).toHaveCount(0);
    // Closing puts the reviewer back on the table they came from.
    await expect(page.getByRole("row", { name: /Form 4/ })).toBeVisible();
  });
});

test.describe("edit mode on a tool page", () => {
  // Phone-first, because that is where this control is used: somebody standing
  // next to the machine with one hand free (§5.3(b)). The viewport alone rather
  // than a device preset: a preset changes `defaultBrowserType`, which
  // Playwright refuses inside a describe because it forces a second worker.
  test.use({ viewport: { width: 390, height: 844 }, isMobile: false });

  test("a SuperMaker gets a full-screen sheet over the tool's own page", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, DEMO_ACCOUNTS.admin, baseURL);
    await page.goto("/tools/form-4");

    // The control asks `/api/identity` after mount, so it arrives a beat after
    // the page — which is what keeps the page cached for everyone else.
    await page.getByRole("button", { name: "Edit this tool" }).click({ timeout: 15_000 });

    const sheet = page.getByRole("complementary", { name: "Editing Form 4" });
    await expect(sheet).toBeVisible({ timeout: 15_000 });
    await expect(sheet.getByRole("heading", { name: "Units" })).toBeVisible();

    // Full width at a phone viewport: a panel beside something is not a thing a
    // phone has room for.
    const width = await sheet.evaluate((node) => node.getBoundingClientRect().width);
    const viewport = page.viewportSize();
    expect(width).toBeGreaterThanOrEqual((viewport?.width ?? 0) - 1);
  });

  test("a student sees no way in, and an anonymous visitor sees none either", async ({
    page,
    context,
    baseURL,
  }) => {
    await page.goto("/tools/form-4");
    await expect(page.getByRole("button", { name: "Edit this tool" })).toHaveCount(0);

    await signIn(context, DEMO_ACCOUNTS.user, baseURL);
    await page.goto("/tools/form-4");
    await expect(page.getByRole("heading", { name: "Form 4", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit this tool" })).toHaveCount(0);
  });
});

/**
 * Spec §10, scenario 4 — the flow this phase exists for.
 *
 * A laser is down. The person who found that out is standing next to it with a
 * phone, and three things have to hold for the lab to trust this app over a
 * whiteboard: the editor has to be reachable from the machine's own page, the
 * write has to land through a client island's prop-passed server action, and
 * **the public page has to stop saying the machine is available**. That last
 * one is the seam nothing else could test: the catalogue is cached for minutes
 * behind `cacheTag("catalog")`, the write busts it with `invalidateCatalog()`
 * from a different module, and a tag that did not match would fail silently —
 * no error, no failing unit test, just a student walking to a dead machine.
 */
test.describe("taking a machine out of service, from a phone", () => {
  // Two halves of one act, and the second is the cleanup the rest of the suite
  // depends on. Serial, so the restore cannot be the one that runs first.
  test.describe.configure({ mode: "serial" });

  // The viewport this is actually done at. Not a device preset: a preset sets
  // `defaultBrowserType`, which Playwright refuses inside a describe.
  test.use({ viewport: { width: 390, height: 844 }, isMobile: false });

  const TOOL = "/tools/trotec-speedy-400";
  const UNIT_ROW = /ML-LSR-400/;

  /**
   * The unit's row in the public page's Physical Machines table.
   *
   * Scoped to that table rather than to the page: the serial is printed twice
   * on a tool page — once here and once in the specifications table as the map
   * id a QR label carries — and only one of them has a status beside it.
   */
  function publicUnitRow(page: import("@playwright/test").Page) {
    return page
      .getByRole("table")
      .filter({ has: page.getByRole("columnheader", { name: "Condition" }) })
      .getByRole("row", { name: UNIT_ROW });
  }

  /** Open the sheet over the tool's own page and hand back its status select. */
  async function openUnitStatus(page: import("@playwright/test").Page) {
    await page.goto(TOOL);
    // The control asks `/api/identity` after mount — which is exactly what
    // keeps this page cached for the students who are not staff.
    await page.getByRole("button", { name: "Edit this tool" }).click({ timeout: 15_000 });

    const sheet = page.getByRole("complementary", { name: "Editing Trotec Speedy 400" });
    await expect(sheet).toBeVisible({ timeout: 15_000 });

    return {
      sheet,
      status: sheet
        .getByRole("listitem", { name: "Trotec Speedy 400" })
        .getByRole("combobox", { name: "Status" }),
    };
  }

  test("the public page stops saying the laser is available", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, DEMO_ACCOUNTS.admin, baseURL);

    // Where the catalogue starts: one unit, available, and a tool chip to match.
    await page.goto(TOOL);
    await expect(publicUnitRow(page)).toContainText("Available", { timeout: 15_000 });

    const { sheet, status } = await openUnitStatus(page);
    await expect(status).toHaveValue("available");

    // One gesture, no Save button: the reason this section's selects write on
    // change is the person holding the phone has one hand free.
    await status.selectOption("out_of_service");
    await expect(sheet.getByRole("status").filter({ hasText: "Saved" })).toBeVisible({
      timeout: 15_000,
    });
    // The panel re-read its children with the revision the write returned, so
    // the select it hands back is the database's answer, not the click's.
    await expect(status).toHaveValue("out_of_service", { timeout: 15_000 });

    // The point of the whole exercise. A fresh request for the public page: the
    // cache tag the write invalidated is the one the page reads under.
    await page.goto(TOOL);
    const row = publicUnitRow(page);
    await expect(row).toContainText("Offline", { timeout: 15_000 });
    await expect(row).not.toContainText("Available");
    // And the tool itself, because its only machine is down (`deriveStatus`).
    await expect(page.getByText("Offline").first()).toBeVisible();
  });

  test("and the laser is put back, so the seed reads the way the suite expects", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, DEMO_ACCOUNTS.admin, baseURL);

    const { sheet, status } = await openUnitStatus(page);
    await status.selectOption("available");
    await expect(sheet.getByRole("status").filter({ hasText: "Saved" })).toBeVisible({
      timeout: 15_000,
    });

    await page.goto(TOOL);
    await expect(publicUnitRow(page)).toContainText("Available", { timeout: 15_000 });
  });
});

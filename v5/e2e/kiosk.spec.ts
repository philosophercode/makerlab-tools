import { test, expect, type Page } from "@playwright/test";

// The lab status screen, `/kiosk` (kiosk spec 2026-09-27 §10, E2E layer), on
// the demo seed: public with no sign-in, none of the site's chrome, dark,
// legible on a 1080p TV and an iPad either way up with no horizontal scroll,
// polling `/api/kiosk` and keeping its data when it cannot, and a QR code that
// opens the assistant.
//
// The poll is driven with Playwright's clock and `page.route`, so the test
// changes what the next poll *answers* rather than the shared demo database —
// other specs (tool-editor.spec.ts) flip Trotec's unit status while this runs.
//
// Set KIOSK_SCREENSHOT_DIR to keep a screenshot of each viewport.

const VIEWPORTS = [
  { name: "tv-1920x1080", width: 1920, height: 1080 },
  // The spec's portrait design size (§6), and the same iPad turned sideways.
  { name: "ipad-landscape-1080x810", width: 1080, height: 810 },
  { name: "ipad-portrait-810x1080", width: 810, height: 1080 },
] as const;

/** Keep a picture of the screen when KIOSK_SCREENSHOT_DIR is set, once the featured item has faded in. */
async function screenshot(page: Page, name: string) {
  const dir = process.env.KIOSK_SCREENSHOT_DIR;
  if (!dir) return;
  // "disabled" fast-forwards the featured item's fade to its end.
  await page.screenshot({ path: `${dir}/kiosk-${name}.png`, animations: "disabled" });
}

async function openKiosk(page: Page) {
  await page.goto("/kiosk");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Lab status");
  await expect(page.getByRole("region", { name: "Open tickets" })).toBeVisible();
}

test.describe("Kiosk", () => {
  test("renders for anybody, without the site's header, banner or chat button", async ({ page }) => {
    await openKiosk(page);

    await expect(page.locator(".top-nav")).toHaveCount(0);
    await expect(page.locator(".status-strip")).toHaveCount(0);
    await expect(page.locator(".demo-banner")).toHaveCount(0);
    await expect(page.locator('[data-slot="chat-launcher"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open MakerLab assistant" })).toHaveCount(0);

    // The demo seed: one open ticket, the lab hours, the demo chip in place of the banner.
    await expect(page.locator("[data-kiosk-tickets]")).toHaveText("1");
    await expect(page.getByText("LAB OPEN 9AM-9PM")).toBeVisible();
    await expect(page.locator("[data-kiosk-demo]")).toHaveText("Demo data");
    await expect(page.getByRole("region", { name: "Machines" })).toBeVisible();
    await expect(page.getByRole("img", { name: /^QR code that opens .*\/\?src=kiosk&ask=1$/ })).toBeVisible();
  });

  test("is dark whatever the visitor chose for the catalogue", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.setItem("theme", "light"));
    await openKiosk(page);

    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(background).toBe("rgb(15, 15, 15)");
    // Nothing was stored: the catalogue keeps its own choice.
    expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe("light");
  });

  for (const viewport of VIEWPORTS) {
    test(`fits ${viewport.name} with no horizontal scroll and a QR code a third of the short side`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await openKiosk(page);

      const overflow = await page.evaluate(() => {
        const root = document.scrollingElement ?? document.documentElement;
        const screenEl = document.querySelector<HTMLElement>("[data-kiosk-shift]");
        return {
          page: root.scrollWidth - root.clientWidth,
          screen: screenEl ? screenEl.scrollWidth - screenEl.clientWidth : 0,
        };
      });
      expect(overflow.page).toBeLessThanOrEqual(0);
      expect(overflow.screen).toBeLessThanOrEqual(0);

      const qr = await page.locator("[data-kiosk-qr] > div").boundingBox();
      expect(qr).not.toBeNull();
      expect(qr!.width).toBeGreaterThanOrEqual(0.3 * Math.min(viewport.width, viewport.height) - 1);

      // Everything a person reads from across the room is on screen at once
      // in landscape; an upright iPad may scroll inside the screen.
      if (viewport.width > viewport.height) {
        for (const name of ["Machines", "Open tickets"]) {
          const box = await page.getByRole("region", { name }).boundingBox();
          expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
        }
        const qrBottom = qr!.y + qr!.height;
        expect(qrBottom).toBeLessThanOrEqual(viewport.height);
      }

      await screenshot(page, viewport.name);
    });
  }

  // Phone, upright iPad and TV, with three machines down and a long featured
  // description (the case that used to push an upright iPad into a scroll):
  // nothing runs off the side, and nothing sits under the header — the clock
  // and the title never overlap the panels, however the layout stacks.
  for (const viewport of [
    { name: "phone-390x844", width: 390, height: 844 },
    { name: "ipad-portrait-810x1080", width: 810, height: 1080 },
    { name: "tv-1920x1080", width: 1920, height: 1080 },
  ]) {
    test(`at ${viewport.name} nothing overflows sideways or overlaps the header`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.clock.install();
      await openKiosk(page);
      const real = await (await page.request.get("/api/kiosk")).json();
      await page.route("**/api/kiosk", (route) =>
        route.fulfill({
          json: {
            ...real,
            tickets: { open: 4, inProgress: 2 },
            down: [
              { toolSlug: "form-4", toolName: "Form 4", imageSrc: "/tool-images/Form%204.png", unitsDown: 1, unitsTotal: 2, state: "under_maintenance" },
              { toolSlug: "trotec-speedy-400", toolName: "Trotec Speedy 400", imageSrc: "", unitsDown: 1, unitsTotal: 1, state: "out_of_service" },
              { toolSlug: "bambu-x1c", toolName: "Bambu Lab X1 Carbon with AMS", imageSrc: "", unitsDown: 2, unitsTotal: 4, state: "mixed" },
            ],
            featured: [
              {
                kind: "tool",
                slug: "form-4",
                name: "Formlabs Form 4 resin 3D printer",
                shortDescription: "A high-precision desktop resin printer. ".repeat(12),
                imageSrc: "/tool-images/Form%204.png",
              },
            ],
          },
        })
      );
      await page.clock.runFor(71_000);
      await expect(page.locator("[data-kiosk-tickets]")).toHaveText("6");

      const layout = await page.evaluate(() => {
        const root = document.scrollingElement ?? document.documentElement;
        const screenEl = document.querySelector<HTMLElement>("[data-kiosk-shift]")!;
        const header = document.querySelector("[data-kiosk] header")!.getBoundingClientRect();
        const regions = [...document.querySelectorAll("[data-kiosk] main > section, [data-kiosk] footer")].map((el) => ({
          name: el.getAttribute("aria-labelledby") ?? el.tagName,
          top: el.getBoundingClientRect().top,
        }));
        // Everything inside the header stays inside it (the clock never spills out).
        const spill = [...document.querySelectorAll("[data-kiosk] header *")].filter((el) => {
          const box = el.getBoundingClientRect();
          return box.width > 0 && (box.left < header.left - 1 || box.right > header.right + 1 || box.bottom > header.bottom + 1);
        }).length;
        return {
          pageX: root.scrollWidth - root.clientWidth,
          screenX: screenEl.scrollWidth - screenEl.clientWidth,
          headerBottom: header.bottom,
          regions,
          spill,
        };
      });
      expect(layout.pageX).toBeLessThanOrEqual(0);
      expect(layout.screenX).toBeLessThanOrEqual(0);
      expect(layout.spill).toBe(0);
      for (const region of layout.regions) expect(region.top, region.name).toBeGreaterThanOrEqual(layout.headerBottom);

      if (viewport.width < 640) {
        // On a phone the assistant is a link as well as a (smaller) QR code.
        await expect(page.getByRole("link", { name: "Open the assistant" })).toHaveAttribute("href", /\/\?src=kiosk&ask=1$/);
      } else {
        await expect(page.getByRole("link", { name: "Open the assistant" })).toBeHidden();
      }
      await screenshot(page, `${viewport.name}-machines-down`);
    });
  }

  test("answers /api/kiosk with public data only", async ({ request }) => {
    const res = await request.get("/api/kiosk");
    expect(res.status()).toBe(200);
    expect(res.headers()["set-cookie"]).toBeUndefined();
    const text = await res.text();
    expect(text).not.toContain("@");
    const body = JSON.parse(text);
    expect(body.demo).toBe(true);
    expect(body.tickets).toEqual({ open: 1, inProgress: 0 });
    expect(body.askUrl).toMatch(/\/\?src=kiosk&ask=1$/);
  });

  test("shows the next poll's data, then keeps it and says so when the server goes away", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.clock.install();
    await openKiosk(page);
    const real = await (await page.request.get("/api/kiosk")).json();

    // The next poll says two machines are down and more tickets came in.
    await page.route("**/api/kiosk", (route) =>
      route.fulfill({
        json: {
          ...real,
          tickets: { open: 2, inProgress: 1 },
          down: [
            { toolSlug: "form-4", toolName: "Form 4", imageSrc: "/tool-images/Form%204.png", unitsDown: 1, unitsTotal: 2, state: "under_maintenance" },
            { toolSlug: "trotec-speedy-400", toolName: "Trotec Speedy 400", imageSrc: "", unitsDown: 1, unitsTotal: 1, state: "out_of_service" },
          ],
        },
      })
    );
    await page.clock.runFor(71_000); // one poll: 60 s plus at most 10 s of jitter
    await expect(page.locator("[data-kiosk-tickets]")).toHaveText("3");
    const machines = page.getByRole("region", { name: "Machines" });
    await expect(machines.getByText("Form 4")).toBeVisible();
    await expect(machines.getByText("1 of 2 down")).toBeVisible();
    await expect(machines.getByText("Out of service")).toBeVisible();
    await expect(page.locator("[data-kiosk-bar]")).toHaveCount(0);
    await screenshot(page, "tv-1920x1080-machines-down");

    // Then the server is unreachable: the data stays, and after three
    // minutes without a good answer the bar says what it is showing.
    await page.unroute("**/api/kiosk");
    await page.route("**/api/kiosk", (route) => route.abort("internetdisconnected"));
    await page.clock.runFor(3 * 60_000 + 11_000);
    await expect(page.locator("[data-kiosk-bar]")).toContainText("Can't reach the server — showing");
    await expect(page.locator("[data-kiosk-tickets]")).toHaveText("3");
    await expect(machines.getByText("Form 4")).toBeVisible();
    await screenshot(page, "tv-1920x1080-stale");
  });

  test("the QR code's address opens the catalogue with the assistant open", async ({ page }) => {
    await page.goto("/?src=kiosk&ask=1");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "MAKERLAB ASSISTANT" })).toBeVisible();
  });

  test("the catalogue without ?ask=1 leaves the assistant closed", async ({ page }) => {
    await page.goto("/?src=kiosk");
    await expect(page.getByRole("button", { name: "Open MakerLab assistant" })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

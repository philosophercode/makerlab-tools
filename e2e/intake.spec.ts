import { mkdirSync } from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";

import { DEMO_ACCOUNTS } from "../src/lib/db/demo-seed";
import { makeProductPng } from "../test/gateway/png";
import {
  AFTER_TABLE_REPLY,
  ASK_FOR_ITEMS_REPLY,
  IDENTIFY_PROMPT,
  INTAKE_ITEMS,
  MULTI_ITEMS,
  MULTI_PHOTOS,
  MULTI_PROMPT,
} from "./stubs/intake-fixture";
import { signIn } from "./utils/session";

/**
 * Adding equipment, end to end (data platform design spec §5.4; gateway spec
 * §3.5, §10 E2E scenario 5 for the image stage): identify in the chat,
 * research in the background — which now includes finding a product image —
 * approve on the preliminary page, choosing the image there.
 *
 * **The model is stubbed at the Gateway's own wire format, not in the
 * browser.** Every other chat spec fulfils `/api/chat` with a canned stream,
 * which cannot do what this one needs: `identify_tools` writing real pending
 * rows, and the research workflow running server-side after the click. So the
 * server talks to `e2e/stubs/gateway-stub.ts` on localhost (through
 * `AI_GATEWAY_BASE_URL`, `playwright.config.ts`), and everything in between is
 * the real app — the chat route and the capability, `PATCH` and the research
 * route, `researchBatch` on the Workflow SDK's local world, link
 * verification, the image stage, the approval transaction and the cache
 * invalidation behind it.
 *
 * **This runs in its own Playwright project, against its own server**
 * (`INTAKE_APP_ORIGIN`, `playwright.config.ts`): the same production build,
 * started a second time with a local Blob folder (`BLOB_LOCAL_DIR`), so the
 * image stage can store its cleaned copy and approval can publish it — while
 * the main server keeps the "uploads unavailable" branch `projects.spec.ts`
 * asserts. Its demo database is its own, so the tool approved here never
 * reaches `gallery.spec.ts`'s count.
 *
 * **It is one test, and it is not retried.** Each step is the next step's
 * precondition, and a second attempt would find the first attempt's rows —
 * already researched, already approved — under the same names, flagged as
 * duplicates of themselves. A retry could only fail for a reason unrelated to
 * the one that failed the first time.
 *
 * **The image (gateway spec §10, scenario 5).** The stub's search results and
 * product page carry one image, on the stub's own origin — a product on a
 * plain white backdrop; research probes it, classifies it `plain`, has nothing
 * to rank it against, and cuts the backdrop out deterministically (no model).
 * The review page preselects that cleaned copy (served by the cleaned-image
 * route) and shows it loading.
 *
 * **The photo from the chat (amendment "An uploaded photo is a choice, not the
 * product image").** The admin attaches a photo of the Domino with the
 * identify message — a product on a plain backdrop, like the stub's. It
 * identifies the item and nothing more: research still finds and cleans its
 * own image (preselected), and the photo is one more choice, "Your photo". The
 * test picks it with **Remove the background** on, approves, and the gallery
 * card shows the photo's deterministic cutout — not research's copy, and not
 * the photo as taken.
 */

test.describe.configure({ retries: 0 });

const { domino, sawstop, shapeoko } = INTAKE_ITEMS;

test("an admin identifies three tools in the chat, researches two, and approves one into the gallery", async ({
  page,
  context,
  baseURL,
}) => {
  // Research runs in the background and the queue polls every five seconds.
  test.setTimeout(180_000);
  await signIn(context, DEMO_ACCOUNTS.admin, baseURL);
  await page.goto("/");

  // ── Step 1: identify, in the chat ─────────────────────────────────────────
  // The profile menu's Add equipment entry opens the chat with the intake seed
  // (§5.4 step 1). The profile control asks `/api/identity` after mount, so it
  // arrives a beat after the page.
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  await nav.getByRole("button", { name: /signed in as/i }).click({ timeout: 15_000 });
  await nav.getByRole("menuitem", { name: /add equipment/i }).click();
  const chat = page.getByRole("dialog");
  await expect(chat.getByText("I'd like to add new equipment to the inventory.")).toBeVisible();
  await expect(chat.getByText(ASK_FOR_ITEMS_REPLY)).toBeVisible({ timeout: 15_000 });

  // A photo of the Domino, sent with the message; the stub gives it to the first item.
  await chat.locator('input[type="file"]').setInputFiles({
    name: "domino-bench.png",
    mimeType: "image/png",
    buffer: Buffer.from(makeProductPng({ width: 800, height: 600 })),
  });
  await expect(chat.getByRole("button", { name: "Remove domino-bench.png" })).toBeVisible({ timeout: 15_000 });

  await chat.getByRole("textbox", { name: "Ask the MakerLAB Assistant" }).fill(IDENTIFY_PROMPT);
  await chat.getByRole("button", { name: "Send" }).click();

  const card = chat.getByRole("region", { name: "Identified equipment" });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(chat.getByText(AFTER_TABLE_REPLY)).toBeVisible();

  // Every row starts selected (§5.4 step 5).
  for (const item of [domino, sawstop, shapeoko]) {
    await expect(card.getByRole("checkbox", { name: `Select ${item.identifiedAs}` })).toBeChecked();
  }
  await expect(card.getByRole("button", { name: "Add to research (3)" })).toBeEnabled();

  // Deselect one: it stays `identified` and waits on the Intake page.
  await card.getByRole("checkbox", { name: `Select ${shapeoko.identifiedAs}` }).uncheck();
  await expect(card.getByRole("button", { name: "Add to research (2)" })).toBeEnabled();

  // Edit one — a typo, fixed through PATCH rather than through the model.
  await card.getByRole("button", { name: `Edit ${domino.identifiedAs}` }).click();
  // Research waits while a row is being edited.
  await expect(card.getByRole("button", { name: "Add to research (2)" })).toBeDisabled();
  await card.getByRole("textbox", { name: "Name" }).fill(domino.name);
  await card.getByRole("button", { name: "Save" }).click();
  // The row now shows what the database answered with, still selected.
  await expect(card.getByRole("checkbox", { name: `Select ${domino.name}` })).toBeChecked({
    timeout: 15_000,
  });

  // ── Step 2: research, in the background ───────────────────────────────────
  // Asked first: how much of today's allowance it uses, and about what it costs.
  await card.getByRole("button", { name: "Add to research (2)" }).click();
  await expect(card.getByRole("group", { name: "Confirm research" })).toContainText(
    /Research 2 items\? That uses 2 of the \d+ research credits you have left today — about \$0\.06–\$0\.07\./
  );
  await card.getByRole("button", { name: "Start research (2)" }).click();
  await expect(
    card.getByText("Researching 2 tools — you can close this. Results will be on the Intake page.")
  ).toBeVisible({ timeout: 15_000 });
  await expect(card.getByText("1 unselected item waits on the Intake page.")).toBeVisible();
  await expect(card.getByRole("link", { name: "Open the Intake page" })).toHaveAttribute(
    "href",
    "/admin/intake"
  );

  // ── Step 3: review and approve ────────────────────────────────────────────
  await page.goto("/admin/intake");
  // A researched item's name becomes the link to its preliminary page; the
  // list refreshes itself while anything is queued or researching (§5.4 step
  // 10), so this waits on the polling rather than on reloads.
  const reviewLink = page.getByRole("link", { name: domino.name, exact: true });
  await expect(reviewLink).toBeVisible({ timeout: 90_000 });
  await reviewLink.click();

  // The preliminary page is rendered per request (it reads the row, the
  // taxonomy and the viewer), so it gets the same headroom as the other
  // first-visit admin pages.
  await expect(page).toHaveURL(/\/admin\/intake\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  // The proposal is research's, in the tool editor's fields, and the manual
  // the stub served was opened and kept.
  await expect(page.getByLabel("Display name", { exact: true })).toHaveValue(domino.name, {
    timeout: 15_000,
  });
  await expect(page.getByText(`${domino.name} user manual`)).toBeVisible();

  // The image stage (gateway spec §3.5): one candidate, and its cleaned copy
  // beside it — preselected, because a cleaned copy exists (§6). The tile's
  // picture comes from the cleaned-image route, behind tools.approve, and it
  // really loaded (a broken one would disable the choice).
  const imageGroup = page.getByRole("radiogroup", { name: "Product image" });
  await expect(imageGroup).toBeVisible({ timeout: 15_000 });
  await expect(imageGroup.getByRole("radio", { name: "Background removed" })).toBeChecked();
  await expect(imageGroup.getByRole("radio", { name: "Option 1" })).not.toBeChecked();
  await expect(imageGroup.getByRole("radio", { name: "No image" })).not.toBeChecked();
  await expect(imageGroup.getByText("From localhost").first()).toBeVisible();
  const cleaned = imageGroup.getByRole("img", { name: `${domino.name}, background removed` });
  await expect(cleaned).toHaveAttribute("src", /^\/api\/pending-tools\/[0-9a-f-]{36}\/cleaned-image(\?v=[0-9a-f-]{36})?$/);
  await expect
    .poll(() => cleaned.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);

  // The photo from the chat did not stop research looking (above), and is one
  // more choice — labelled as the admin's own, not preselected.
  const mine = imageGroup.getByRole("radio", { name: "Your photo" });
  await expect(mine).not.toBeChecked();
  const photo = imageGroup.getByRole("img", { name: `${domino.name}, your photo 1` });
  await expect
    .poll(() => photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
  await mine.check();
  await expect(imageGroup.getByRole("checkbox", { name: "Remove the background" })).toBeChecked();

  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Approved and published. It is in the catalog now.")).toBeVisible({
    timeout: 15_000,
  });
  // The photo's cutout was attached, so there is no image warning.
  await expect(
    page.getByText(
      "The tool was created, but its image could not be attached. Add a photo in the editor."
    )
  ).toHaveCount(0);

  // The tool is in the gallery — approval invalidated the cached catalogue —
  // and its card shows the photo's background-removed copy, public in this
  // server's local Blob store: not research's copy, not the photo as taken,
  // not the placeholder.
  await page.goto("/");
  const heading = page.getByRole("heading", { name: domino.name, level: 2 });
  await expect(heading).toBeVisible({ timeout: 15_000 });
  const cover = page.locator('a[data-slot="tool-card"]').filter({ has: heading }).locator("img");
  // The PNG itself until approval's thumbnails land (written after it
  // answers), then their WebP fallback beside it under thumbs/.
  await expect(cover).toHaveAttribute("src", /\/api\/dev-blob\/.*domino-bench-background-removed.*\.(png|webp)$/);
  await expect
    .poll(() => cover.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);

  // The deselected one was never researched: it waits, with its Research button.
  await page.goto("/admin/intake");
  await expect(page.getByRole("button", { name: `Research ${shapeoko.identifiedAs}` })).toBeVisible({
    timeout: 15_000,
  });
  // And the one approved is no longer asking for anything.
  await expect(page.getByRole("button", { name: `Research ${domino.name}` })).toHaveCount(0);
});

/**
 * Many items at once (data platform spec amendment "Many items at once"): two
 * photos in one message, four objects across them. One card lists them all —
 * the object in both photos once, with both photos (the second a copy the
 * server made); the pair as one row of two; the one the model could not name
 * unticked. Nothing is researched here: the card asks before spending, is
 * cancelled, one row is discarded and the rest are just added to intake, where
 * the queue offers **Research selected** with the same confirmation.
 *
 * Runs on the intake server (local Blob), after the scenario above; its names
 * are its own, so neither sees the other's rows as duplicates.
 */
test("one message with two photos becomes one card of every suspected item, selected and kept for later", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(120_000);
  await signIn(context, DEMO_ACCOUNTS.admin, baseURL);
  await page.goto("/");

  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  await nav.getByRole("button", { name: /signed in as/i }).click({ timeout: 15_000 });
  await nav.getByRole("menuitem", { name: /add equipment/i }).click();
  const chat = page.getByRole("dialog");
  await expect(chat.getByText(ASK_FOR_ITEMS_REPLY)).toBeVisible({ timeout: 15_000 });

  await chat
    .locator('input[type="file"]')
    .setInputFiles(MULTI_PHOTOS.map((name) => path.join(__dirname, "../evals/fixtures/photos", name)));
  await expect(chat.getByRole("button", { name: `Remove ${MULTI_PHOTOS[1]}` })).toBeVisible({ timeout: 15_000 });
  await chat.getByRole("textbox", { name: "Ask the MakerLAB Assistant" }).fill(MULTI_PROMPT);
  await chat.getByRole("button", { name: "Send" }).click();

  const card = chat.getByRole("region", { name: "Identified equipment" });
  await expect(card).toBeVisible({ timeout: 30_000 });

  // Every suspected item, ticked — except the one the model was unsure of.
  for (const name of [MULTI_ITEMS.drillPress, MULTI_ITEMS.cutter, MULTI_ITEMS.battery]) {
    await expect(card.getByRole("checkbox", { name: `Select ${name}` })).toBeChecked();
  }
  await expect(card.getByRole("checkbox", { name: `Select ${MULTI_ITEMS.unsure}` })).not.toBeChecked();
  await expect(card.getByText("Not sure — check it")).toBeVisible();
  await expect(card.getByLabel("2 units")).toHaveText("×2");
  await expect(card.getByText("Seen: photo 1, centre; photo 2, left")).toBeVisible();

  // Each item shows its photo: the drill press holds the bench photo, the
  // Cricut the shelf photo and a copy of the bench's, the battery another copy
  // of the bench's (server-side copies, amendment "Many items at once").
  for (const name of Object.values(MULTI_ITEMS)) {
    const photo = card.getByRole("img", { name: `Photo of ${name}` });
    await expect(photo).toBeVisible();
    await expect
      .poll(() => photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth), { timeout: 15_000 })
      .toBeGreaterThan(0);
  }
  await expect(card.getByText("+1")).toBeVisible();

  // Add to research asks first — and Cancel spends nothing.
  await card.getByRole("button", { name: "Add to research (3)" }).click();
  const confirm = card.getByRole("group", { name: "Confirm research" });
  await expect(confirm).toContainText(/Research 3 items\? That uses 3 of the \d+ research credits you have left today — about \$0\.09–\$0\.11\./);
  if (process.env.INTAKE_SHOTS_DIR) {
    mkdirSync(process.env.INTAKE_SHOTS_DIR, { recursive: true });
    await chat.screenshot({ path: path.join(process.env.INTAKE_SHOTS_DIR, "selection-card-confirm.png") });
  }
  await confirm.getByRole("button", { name: "Cancel" }).click();
  if (process.env.INTAKE_SHOTS_DIR) {
    await card.scrollIntoViewIfNeeded();
    await chat.screenshot({ path: path.join(process.env.INTAKE_SHOTS_DIR, "selection-card.png") });
  }

  // Discard the unnamed one: tick only it, Discard (1), confirm.
  for (const name of [MULTI_ITEMS.drillPress, MULTI_ITEMS.cutter, MULTI_ITEMS.battery]) {
    await card.getByRole("checkbox", { name: `Select ${name}` }).uncheck();
  }
  await card.getByRole("checkbox", { name: `Select ${MULTI_ITEMS.unsure}` }).check();
  await card.getByRole("button", { name: "Discard (1)" }).click();
  await card.getByRole("button", { name: "Discard 1 item" }).click();
  await expect(card.getByText(MULTI_ITEMS.unsure, { exact: true })).toHaveCount(0, { timeout: 15_000 });

  // The rest wait on the Intake page.
  await card.getByRole("button", { name: "Just add to intake" }).click();
  await expect(card.getByText(/Saved to intake — 3 items wait on the Intake page/)).toBeVisible();

  // ── The queue: the same selection, the same confirmation ────────────────
  await page.goto("/admin/intake");
  await expect(page.getByRole("button", { name: `Research ${MULTI_ITEMS.battery}` })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel("2 units")).toHaveText("×2");
  await page.getByRole("checkbox", { name: `Select “${MULTI_ITEMS.drillPress}”` }).check();
  await page.getByRole("checkbox", { name: `Select “${MULTI_ITEMS.battery}”` }).check();
  await page.getByRole("button", { name: "Research selected (2)" }).click();
  await expect(page.getByRole("group", { name: "Confirm research" })).toContainText("Research 2 items?");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("group", { name: "Confirm research" })).toHaveCount(0);
});

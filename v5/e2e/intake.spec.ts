import { test, expect } from "@playwright/test";

import { DEMO_ACCOUNTS } from "../src/lib/db/demo-seed";
import {
  AFTER_TABLE_REPLY,
  ASK_FOR_ITEMS_REPLY,
  IDENTIFY_PROMPT,
  INTAKE_ITEMS,
} from "./stubs/intake-fixture";
import { signIn } from "./utils/session";

/**
 * Adding equipment, end to end (data platform design spec §5.4, §10 E2E
 * scenario 5): identify in the chat, research in the background, approve on
 * the preliminary page.
 *
 * **The model is stubbed at the provider boundary, not in the browser.** Every
 * other chat spec fulfils `/api/chat` with a canned stream, which cannot do
 * what this one needs: `identify_tools` writing real pending rows, and the
 * research workflow running server-side after the click. So the server talks to
 * `e2e/stubs/anthropic-stub.ts` on localhost, and everything in between is the
 * real app — the chat route and the capability, `PATCH` and the research
 * route, `researchBatch` on the Workflow SDK's local world, link
 * verification, the approval transaction and the cache invalidation behind it.
 *
 * **This runs in its own Playwright project, after every other spec**
 * (`playwright.config.ts`). Approving publishes a third tool into the demo
 * database all specs share, and `gallery.spec.ts` counts two.
 *
 * **It is one test, and it is not retried.** Each step is the next step's
 * precondition, and a second attempt would find the first attempt's rows —
 * already researched, already approved — under the same names, flagged as
 * duplicates of themselves. A retry could only fail for a reason unrelated to
 * the one that failed the first time.
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
  // The header's Add button opens the chat with the intake seed (§5.4 step 1).
  // It asks `/api/identity` after mount, so it arrives a beat after the page.
  await page
    .getByRole("button", { name: "Add new equipment to the inventory" })
    .click({ timeout: 15_000 });
  const chat = page.getByRole("dialog");
  await expect(chat.getByText("I'd like to add new equipment to the inventory.")).toBeVisible();
  await expect(chat.getByText(ASK_FOR_ITEMS_REPLY)).toBeVisible({ timeout: 15_000 });

  await chat.getByRole("textbox", { name: "Ask the lab console" }).fill(IDENTIFY_PROMPT);
  await chat.getByRole("button", { name: "Send" }).click();

  const card = chat.getByRole("region", { name: "Identified equipment" });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(chat.getByText(AFTER_TABLE_REPLY)).toBeVisible();

  // Every row starts selected (§5.4 step 5).
  for (const item of [domino, sawstop, shapeoko]) {
    await expect(card.getByRole("checkbox", { name: `Select ${item.identifiedAs}` })).toBeChecked();
  }
  await expect(card.getByRole("button", { name: "Research selected (3)" })).toBeEnabled();

  // Deselect one: it stays `identified` and waits on the Intake page.
  await card.getByRole("checkbox", { name: `Select ${shapeoko.identifiedAs}` }).uncheck();
  await expect(card.getByRole("button", { name: "Research selected (2)" })).toBeEnabled();

  // Edit one — a typo, fixed through PATCH rather than through the model.
  await card.getByRole("button", { name: `Edit ${domino.identifiedAs}` }).click();
  // Research waits while a row is being edited.
  await expect(card.getByRole("button", { name: "Research selected (2)" })).toBeDisabled();
  await card.getByRole("textbox", { name: "Name" }).fill(domino.name);
  await card.getByRole("button", { name: "Save" }).click();
  // The row now shows what the database answered with, still selected.
  await expect(card.getByRole("checkbox", { name: `Select ${domino.name}` })).toBeChecked({
    timeout: 15_000,
  });

  // ── Step 2: research, in the background ───────────────────────────────────
  await card.getByRole("button", { name: "Research selected (2)" }).click();
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
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(domino.name, {
    timeout: 15_000,
  });
  await expect(page.getByText(`${domino.name} user manual`)).toBeVisible();

  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Approved and published. It is in the catalog now.")).toBeVisible({
    timeout: 15_000,
  });

  // The tool is in the gallery — approval invalidated the cached catalogue.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: domino.name, level: 2 })).toBeVisible({
    timeout: 15_000,
  });

  // The deselected one was never researched: it waits, with its Research button.
  await page.goto("/admin/intake");
  await expect(page.getByRole("button", { name: `Research ${shapeoko.identifiedAs}` })).toBeVisible({
    timeout: 15_000,
  });
  // And the one approved is no longer asking for anything.
  await expect(page.getByRole("button", { name: `Research ${domino.name}` })).toHaveCount(0);
});

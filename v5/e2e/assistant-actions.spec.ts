import { test, expect } from "@playwright/test";

import { DEMO_ACCOUNTS } from "../src/lib/db/demo-seed";
import { signIn } from "./utils/session";

/**
 * The assistant's actions in the browser (assistant–GUI parity spec §10
 * "E2E", phases 2 and 3).
 *
 * The model is never called: `/api/chat` is intercepted, as in `chat.spec.ts`.
 * What only a browser can check is the wiring — a card drawn from a
 * `data-action-proposal` part that confirms by id alone, a queue's ticked rows
 * reaching the chat request as ids, and **Log completed maintenance**'s
 * server action landing a row. The server half of propose → confirm (the
 * gate at the click, the audit surface) is covered against PGlite by
 * `lib/actions/proposals.test.ts` and `api/chat/staff-tools.route.test.ts`.
 */

function stream(chunks: object[]): string {
  const all = [{ type: "start" }, ...chunks, { type: "finish" }];
  return `${all.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
}

const STREAM_HEADERS = { "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" };

function text(id: string, words: string): object[] {
  return [
    { type: "text-start", id },
    { type: "text-delta", id, delta: words },
    { type: "text-end", id },
  ];
}

test("a proposal card shows the stored change and confirms by id alone", async ({ page, context, baseURL }) => {
  await signIn(context, DEMO_ACCOUNTS.superAdmin, baseURL);
  const card = {
    kind: "action-proposal",
    groupId: "11111111-1111-4111-8111-111111111111",
    actionId: "people.set_title",
    risk: "people",
    items: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        subjectId: DEMO_ACCOUNTS.admin.id,
        preview: {
          summary: { key: "people_set_title", values: { name: "Niti Parikh" } },
          rows: [{ field: "title", before: null, after: "Tech Lead" }],
          subjectName: "Niti Parikh",
          link: "/admin/users",
        },
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
    ],
    refused: [],
  };
  await page.route("**/api/chat", (route) =>
    route.fulfill({
      status: 200,
      headers: STREAM_HEADERS,
      body: stream([...text("0", "Here is the change — confirm it on the card."), { type: "data-action-proposal", id: card.groupId, data: card }]),
    })
  );
  const decided: unknown[] = [];
  await page.route("**/api/action-proposals", async (route) => {
    decided.push(route.request().postDataJSON());
    await route.fulfill({ json: { results: [{ id: card.items[0].id, status: "confirmed", link: "/admin/users" }] } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Open MakerLab assistant" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Ask the lab console" }).fill("Set Niti's title to Tech Lead");
  await dialog.getByRole("button", { name: "Send" }).click();

  const proposal = dialog.getByRole("article", { name: "Set Niti Parikh's title" });
  await expect(proposal).toContainText("Tech Lead");
  await expect(proposal).toContainText("Waiting for you");
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await expect(proposal).toContainText("Done");
  expect(decided).toEqual([{ ids: [card.items[0].id], decision: "confirm" }]);
});

test("ticked tickets reach the chat as ids, with the page they were ticked on", async ({ page, context, baseURL }) => {
  await signIn(context, DEMO_ACCOUNTS.admin, baseURL);
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/api/chat", async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, headers: STREAM_HEADERS, body: stream(text("0", "Which change?")) });
  });

  await page.goto("/admin/maintenance");
  await page.getByRole("checkbox", { name: "Select “Laser bed out of focus”" }).click({ timeout: 15_000 });
  await expect(page.getByText("1 selected")).toBeVisible();
  await page.getByRole("button", { name: "Ask the assistant about these" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Ask the lab console" }).fill("Resolve these: refocused the lens");
  await dialog.getByRole("button", { name: "Send" }).click();
  await expect(dialog.getByText("Which change?")).toBeVisible();

  const pageContext = bodies[0].page as { path: string; selection: { kind: string; ids: string[] } };
  expect(pageContext.path).toBe("/admin/maintenance");
  expect(pageContext.selection.kind).toBe("maintenance_log");
  expect(pageContext.selection.ids).toHaveLength(1);
  expect(pageContext.selection.ids[0]).toMatch(/^[0-9a-f-]{36}$/);
});

test("Log completed maintenance records a resolved ticket from the queue page", async ({ page, context, baseURL }) => {
  await signIn(context, DEMO_ACCOUNTS.admin, baseURL);
  await page.goto("/admin/maintenance");
  const title = `Cleaned the lens ${Date.now()}`;

  await page.getByRole("button", { name: "Log completed maintenance" }).click({ timeout: 15_000 });
  await page.getByLabel("Tool", { exact: true }).selectOption({ label: "Trotec Speedy 400" });
  await page.getByLabel("Kind of work").selectOption("preventive_maintenance");
  await page.getByLabel("What was done, in a line").fill(title);
  await page.getByLabel("Details").fill("Cleaned the focus lens and mirrors.");
  await page.getByRole("button", { name: "Log it" }).click();
  await expect(page.getByText("Logged. It is in the resolved list below.")).toBeVisible({ timeout: 15_000 });

  await page.reload();
  await page.locator('[data-slot="queue-settled"] summary').click({ timeout: 15_000 });
  await expect(page.getByRole("article", { name: title })).toContainText("Resolved");
});

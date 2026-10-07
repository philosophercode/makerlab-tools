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
  await page.getByRole("button", { name: "Open MakerLAB AI" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Ask MakerLAB AI" }).fill("Set Niti's title to Tech Lead");
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
  await dialog.getByRole("textbox", { name: "Ask MakerLAB AI" }).fill("Resolve these: refocused the lens");
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

test("ticked intake items reach the chat as pending ids (approve these, phase 5)", async ({ page, context, baseURL }) => {
  await signIn(context, DEMO_ACCOUNTS.admin, baseURL);
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/api/chat", async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, headers: STREAM_HEADERS, body: stream(text("0", "Approve them as drafts?")) });
  });

  await page.goto("/admin/intake");
  await page.getByRole("checkbox", { name: "Select “Prusa MK4S”" }).click({ timeout: 15_000 });
  await expect(page.getByText("1 selected")).toBeVisible();
  await page.getByRole("button", { name: "Ask the assistant about these" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Ask MakerLAB AI" }).fill("Approve these as drafts");
  await dialog.getByRole("button", { name: "Send" }).click();
  await expect(dialog.getByText("Approve them as drafts?")).toBeVisible();

  const pageContext = bodies[0].page as { path: string; selection: { kind: string; ids: string[] } };
  expect(pageContext.path).toBe("/admin/intake");
  expect(pageContext.selection).toEqual({ kind: "pending_tool", ids: [expect.stringMatching(/^[0-9a-f-]{36}$/)] });
});

test("a destructive card confirms only once the name is typed, and sends it (phase 6)", async ({ page, context, baseURL }) => {
  await signIn(context, DEMO_ACCOUNTS.admin, baseURL);
  const card = {
    kind: "action-proposal",
    groupId: "33333333-3333-4333-8333-333333333333",
    actionId: "tools.archive",
    risk: "destructive",
    items: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        subjectId: "55555555-5555-4555-8555-555555555555",
        preview: {
          summary: { key: "tools_archive", values: { name: "Trotec Speedy 400" } },
          rows: [{ field: "archived", before: "active", after: "archived", format: "archived" }],
          subjectName: "Trotec Speedy 400",
          link: "/tools/trotec-speedy-400",
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
      body: stream([...text("0", "Type the name on the card to confirm."), { type: "data-action-proposal", id: card.groupId, data: card }]),
    })
  );
  await page.route("**/api/action-proposals?ids=*", (route) => route.fulfill({ json: { proposals: [] } }));
  const decided: unknown[] = [];
  await page.route("**/api/action-proposals", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    decided.push(route.request().postDataJSON());
    await route.fulfill({ json: { results: [{ id: card.items[0].id, status: "confirmed", link: "/tools/trotec-speedy-400" }] } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Open MakerLAB AI" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Ask MakerLAB AI" }).fill("Archive the Trotec");
  await dialog.getByRole("button", { name: "Send" }).click();

  const proposal = dialog.getByRole("article", { name: "Archive Trotec Speedy 400" });
  await expect(proposal).toContainText("Cannot be undone");
  const confirm = dialog.getByRole("button", { name: "Confirm" });
  await expect(confirm).toBeDisabled();
  await dialog.getByRole("textbox", { name: "The name, exactly" }).fill("trotec speedy 400");
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(proposal).toContainText("Done");
  expect(decided).toEqual([{ ids: [card.items[0].id], decision: "confirm", typed: "trotec speedy 400" }]);
});

test("an MCP proposal waits in its owner's Assistant proposals inbox (phase 7)", async ({ page, context, baseURL }) => {
  // The director: nothing else in the suite reads their proposals or tokens.
  await signIn(context, DEMO_ACCOUNTS.superAdmin, baseURL);
  await page.goto("/account/tokens");
  await page.getByLabel("Name").fill("E2E inbox");
  await page.getByRole("button", { name: "Create token" }).click();
  const reveal = page.locator('[data-slot="token-reveal"]');
  const token = (await reveal.getByLabel("Personal access token", { exact: true }).textContent())?.trim() ?? "";
  expect(token).toMatch(/^mlt_/);

  // The MCP client, as the token: find the tool, then propose a change to it.
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await page.request.post("/api/mcp", {
      headers: { authorization: `Bearer ${token}`, accept: "application/json, text/event-stream", "content-type": "application/json" },
      data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
    });
    const json = (await res.json()) as { result: { content: { text: string }[] } };
    return JSON.parse(json.result.content[0].text);
  };
  const found = await call("search_tools", { query: "Form 4" });
  const proposed = await call("mark_tool_reviewed", { tool_ids: [found.tools[0].id] });
  expect(proposed).toMatchObject({ proposed: true, inbox: "/admin/proposals" });

  await page.goto("/admin");
  // The inbox is Settings › MCP since the admin sections spec (2026-10-07).
  const bar = page.getByRole("navigation", { name: "Admin sections" });
  await bar.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/settings$/);
  await page.getByRole("navigation", { name: "Settings pages" }).getByRole("link", { name: "MCP", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/proposals$/);

  // The card is drawn from the stored proposal. Dismissing it changes nothing
  // (the confirm path is covered against PGlite by api/mcp/proposals.route.test.ts).
  const card = page.getByRole("article", { name: /Mark Form 4 as reviewed/ });
  await expect(card).toContainText("Waiting for you", { timeout: 15_000 });
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(card).toContainText("Dismissed");

  await page.reload();
  await expect(page.getByRole("article", { name: /Mark Form 4 as reviewed/ })).toHaveCount(0);
  await expect(page.locator('[data-slot="decided-proposals"]')).toContainText("Mark Form 4 as reviewed");
});

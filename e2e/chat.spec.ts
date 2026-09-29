import { test, expect } from "@playwright/test";
import { DEMO_ACCOUNTS } from "../src/lib/db/demo-seed";
import { signIn } from "./utils/session";

// ChatFab uses @ai-sdk/react's useChat with a DefaultChatTransport posting to
// /api/chat. We intercept that request with page.route() so no real model
// call is made at all — through the Gateway or otherwise — and return a valid
// AI SDK v6 UI message stream. (This spec never reaches src/lib/ai/models.ts;
// only e2e/intake.spec.ts needs the Gateway stubbed, since it is the one
// scenario the browser-side intercept cannot reach — see gateway-stub.ts.)
//
// --- Mock stream shape (AI SDK v6 "x-vercel-ai-ui-message-stream: v1") ---
// The transport reads an SSE body: each event is a `data: <json>\n\n` line and
// the stream terminates with `data: [DONE]\n\n`. The minimal chunk sequence
// useChat needs to render an assistant text bubble is:
//   { type: "start" }
//   { type: "text-start", id: "0" }
//   { type: "text-delta", id: "0", delta: "..." }   (one or more)
//   { type: "text-end",   id: "0" }
//   { type: "finish" }
// Response headers MUST include content-type: text/event-stream and
// x-vercel-ai-ui-message-stream: v1 (matches the real route's
// createUIMessageStreamResponse output).

const ASSISTANT_REPLY = "The Form 4 is a resin SLA printer in the MakerLab.";

function uiMessageStreamBody(text: string): string {
  const chunks = [
    { type: "start" },
    { type: "text-start", id: "0" },
    { type: "text-delta", id: "0", delta: text },
    { type: "text-end", id: "0" },
    { type: "finish" },
  ];
  const lines = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("");
  return `${lines}data: [DONE]\n\n`;
}

test.describe("Chat assistant", () => {
  test("opens, sends a message, and renders a streamed assistant reply", async ({
    page,
  }) => {
    // Intercept BEFORE triggering the send so the route is never hit.
    await page.route("**/api/chat", async (route) => {
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "x-vercel-ai-ui-message-stream": "v1",
        },
        body: uiMessageStreamBody(ASSISTANT_REPLY),
      });
    });

    await page.goto("/");

    // Open the chat sheet via the FAB (aria-label "Open MakerLAB AI").
    await page.getByRole("button", { name: "Open MakerLAB AI" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: "MakerLAB AI" })
    ).toBeVisible();

    // Type into the composer (aria-label "Ask MakerLAB AI") and submit.
    const input = dialog.getByRole("textbox", { name: "Ask MakerLAB AI" });
    await input.fill("What is the Form 4?");
    await dialog.getByRole("button", { name: "Send" }).click();

    // The user's message renders.
    await expect(dialog.getByText("What is the Form 4?")).toBeVisible();

    // The mocked assistant reply renders (markdown -> visible text).
    await expect(dialog.getByText(ASSISTANT_REPLY)).toBeVisible();
  });

  test("the chat FAB toggles the panel closed", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Open MakerLAB AI" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Close button (aria-label "Close MakerLAB AI").
    await dialog.getByRole("button", { name: "Close MakerLAB AI" }).click();
    await expect(dialog).toHaveCount(0);
  });

  // UI system phase 5b: a docked sheet — Escape closes it and focus goes back.
  test("Escape closes the sheet and returns focus to the button", async ({ page }) => {
    await page.goto("/");
    const fab = page.getByRole("button", { name: "Open MakerLAB AI" });
    await fab.click();
    const dialog = page.getByRole("dialog", { name: "MakerLAB AI" });
    await expect(dialog).toBeVisible();
    // A keyboard's focus starts in the composer.
    await expect(dialog.getByRole("textbox", { name: "Ask MakerLAB AI" })).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(fab).toBeFocused();
  });

  test("a cited manual page is an inline citation and a source", async ({ page }) => {
    const pdf = "http://localhost/manuals/form-4.pdf";
    const body = [
      { type: "start" },
      { type: "start-step" },
      { type: "tool-input-available", toolCallId: "c1", toolName: "search_manual", input: { query: "resin tank" } },
      {
        type: "tool-output-available",
        toolCallId: "c1",
        output: {
          status: "ok",
          scope: "Form 4 manuals",
          passages: [{ citation: "Form 4 Manual, p. 42", url: `${pdf}#page=42`, tool: "Form 4", section: "Maintenance", text: "Lift the tank." }],
        },
      },
      { type: "finish-step" },
      { type: "start-step" },
      { type: "text-start", id: "0" },
      { type: "text-delta", id: "0", delta: `Lift the tank out ([Replacing the tank (Form 4 Manual, p. 42)](${pdf}#page=42)).` },
      { type: "text-end", id: "0" },
      { type: "finish-step" },
      { type: "finish" },
    ]
      .map((c) => `data: ${JSON.stringify(c)}\n\n`)
      .join("");
    await page.route("**/api/chat", (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" },
        body: `${body}data: [DONE]\n\n`,
      })
    );

    await page.goto("/tools/form-4");
    await page.getByRole("button", { name: "Open MakerLAB AI" }).click();
    const dialog = page.getByRole("dialog", { name: "MakerLAB AI" });
    await dialog.getByRole("textbox", { name: "Ask MakerLAB AI" }).fill("How do I replace the tank?");
    await page.keyboard.press("Enter");

    const mark = dialog.getByRole("link", { name: "Open Form 4 Manual, p. 42" });
    await expect(mark).toHaveAttribute("href", `${pdf}#page=42`);
    await dialog.getByRole("button", { name: "1 manual page" }).click();
    await expect(dialog.getByRole("link", { name: "Form 4 Manual, p. 42", exact: true })).toBeVisible();
  });

  // The header's Report opens the chat with the report prompt in the composer,
  // focused with the caret at the end, and sends nothing — a button must not
  // spend a visitor's message — until the person presses Send.
  test("Report pre-fills the composer and sends only on Send", async ({ page }) => {
    const sent: string[] = [];
    await page.route("**/api/chat", async (route) => {
      const request = route.request().postDataJSON() as { messages: Array<{ parts: Array<{ type: string; text?: string }> }> };
      sent.push(request.messages.at(-1)?.parts.find((p) => p.type === "text")?.text ?? "");
      await route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" },
        body: uiMessageStreamBody(ASSISTANT_REPLY),
      });
    });

    await page.goto("/");
    await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("button", { name: "Report a problem" }).click();
    const dialog = page.getByRole("dialog", { name: "MakerLAB AI" });
    const composer = dialog.getByRole("textbox", { name: "Ask MakerLAB AI" });
    await expect(composer).toHaveValue("I'd like to report a problem.");
    await expect(composer).toBeFocused();
    // Typing goes after the prompt: the caret is at the end.
    await page.keyboard.type(" The laser won't fire.");
    await expect(composer).toHaveValue("I'd like to report a problem. The laser won't fire.");
    expect(sent).toEqual([]);

    await dialog.getByRole("button", { name: "Send" }).click();
    await expect(dialog.getByText(ASSISTANT_REPLY)).toBeVisible();
    expect(sent).toEqual(["I'd like to report a problem. The laser won't fire."]);
  });
});

test.describe("Chat assistant on admin pages (UI system phase 5b)", () => {
  test("there is no floating button; the section bar and ⌘K open the assistant", async ({ page, context, baseURL }) => {
    const sent: string[] = [];
    await page.route("**/api/chat", async (route) => {
      const request = route.request().postDataJSON() as { messages: Array<{ parts: Array<{ type: string; text?: string }> }> };
      const last = request.messages.at(-1);
      sent.push(last?.parts.find((p) => p.type === "text")?.text ?? "");
      await route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" },
        body: uiMessageStreamBody(ASSISTANT_REPLY),
      });
    });
    await signIn(context, DEMO_ACCOUNTS.admin, baseURL);
    await page.goto("/admin/inventory");
    const bar = page.getByRole("navigation", { name: "Admin sections" });
    await expect(bar).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Open MakerLAB AI" })).toHaveCount(0);

    await bar.getByRole("button", { name: "Ask MakerLAB AI" }).click();
    const sheet = page.getByRole("dialog", { name: "MakerLAB AI" });
    await expect(sheet).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);

    // ⌘K: what was typed becomes the first message, sent at once (the person typed it).
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await expect(async () => {
      await page.keyboard.press("ControlOrMeta+k");
      await expect(palette).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await palette.getByRole("combobox").fill("which printer takes resin");
    await palette.getByRole("option", { name: "Ask MakerLAB AI: “which printer takes resin”" }).click();
    await expect(sheet.getByText(ASSISTANT_REPLY)).toBeVisible({ timeout: 15_000 });
    expect(sent).toEqual(["which printer takes resin"]);
  });
});

// The first-visit callout (identity spec 2026-09-28 §3): shown once per
// browser, gone when dismissed, and never on the kiosk.
test.describe("Meet MakerLAB AI", () => {
  const callout = (page: import("@playwright/test").Page) =>
    page.getByRole("complementary", { name: "About MakerLAB AI" });

  test("shows on a first visit, dismisses, and stays dismissed after a reload", async ({ page }) => {
    await page.goto("/");
    await expect(callout(page)).toBeVisible();
    await expect(callout(page)).toContainText("Meet MakerLAB AI");

    await callout(page).getByRole("button", { name: "Dismiss" }).click();
    await expect(callout(page)).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("button", { name: "Open MakerLAB AI" })).toBeVisible();
    await expect(callout(page)).toHaveCount(0);
  });

  test("shows once: ignored, it is gone after a reload", async ({ page }) => {
    await page.goto("/");
    await expect(callout(page)).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Open MakerLAB AI" })).toBeVisible();
    await expect(callout(page)).toHaveCount(0);
  });

  test("opens the chat, whose starters are operate, debug and create", async ({ page }) => {
    await page.goto("/");
    await callout(page).getByRole("button", { name: "Ask a question" }).click();

    const dialog = page.getByRole("dialog", { name: "MakerLAB AI" });
    await expect(dialog).toBeVisible();
    for (const kicker of ["Operate", "Debug", "Create"]) {
      await expect(dialog.getByRole("button", { name: new RegExp(`^${kicker} `) })).toBeVisible();
    }
    await expect(callout(page)).toHaveCount(0);
  });

  test("is not on the kiosk", async ({ page }) => {
    await page.goto("/kiosk");
    // The screen itself, not the loading state (both carry data-kiosk).
    await expect(page.locator("[data-kiosk-main]")).toBeVisible();
    await expect(callout(page)).toHaveCount(0);
  });
});

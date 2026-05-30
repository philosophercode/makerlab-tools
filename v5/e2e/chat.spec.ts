import { test, expect } from "@playwright/test";

// ChatFab uses @ai-sdk/react's useChat with a DefaultChatTransport posting to
// /api/chat. We intercept that request with page.route() so no real Anthropic
// call is made, and return a valid AI SDK v6 UI message stream.
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

    // Open the chat sheet via the FAB (aria-label "Open MakerLab assistant").
    await page.getByRole("button", { name: "Open MakerLab assistant" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: "MAKERLAB ASSISTANT" })
    ).toBeVisible();

    // Type into the composer (aria-label "Ask the lab console") and submit.
    const input = dialog.getByRole("textbox", { name: "Ask the lab console" });
    await input.fill("What is the Form 4?");
    await dialog.getByRole("button", { name: "Send" }).click();

    // The user's message renders.
    await expect(dialog.getByText("What is the Form 4?")).toBeVisible();

    // The mocked assistant reply renders (markdown -> visible text).
    await expect(dialog.getByText(ASSISTANT_REPLY)).toBeVisible();
  });

  test("the chat FAB toggles the panel closed", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Open MakerLab assistant" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Close button (aria-label "Close assistant").
    await dialog.getByRole("button", { name: "Close assistant" }).click();
    await expect(dialog).toHaveCount(0);
  });
});

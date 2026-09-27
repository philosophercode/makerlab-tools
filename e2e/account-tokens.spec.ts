import { test, expect } from "@playwright/test";
import { DEMO_ACCOUNTS } from "../src/lib/db/demo-seed";
import { signIn } from "./utils/session";

/**
 * `/account/tokens` and `/mcp` after the 2026-09-25 owner requests (UI system
 * phase 5a; MCP access spec amendment "One lifetime, a louder reveal, a setup
 * prompt"): no expiry choice, one column, the save-it-now warning above the
 * token and beside Done, and a copyable setup prompt that never holds a token.
 */

test.describe("personal access tokens", () => {
  test("a student creates a token: 90 days as text, the warning twice, a prompt without the token", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, DEMO_ACCOUNTS.user, baseURL);
    await page.goto("/account/tokens");

    await expect(page.getByRole("heading", { name: "New token" })).toBeVisible();
    // No expiry choice — the date is said as text.
    await expect(page.getByRole("main").getByRole("combobox")).toHaveCount(0);
    await expect(page.getByText(/90 days, one semester/)).toBeVisible();

    await page.getByLabel("Name").fill("E2E laptop");
    await page.getByRole("button", { name: "Create token" }).click();

    const reveal = page.locator('[data-slot="token-reveal"]');
    await expect(reveal.getByRole("heading", { name: /Your new token: E2E laptop/ })).toBeVisible();
    const warning = "Save this token now. You won't be able to see or copy it again after you leave this page.";
    await expect(reveal.getByText(warning)).toHaveCount(2);

    const token = (await reveal.getByLabel("Personal access token", { exact: true }).textContent())?.trim() ?? "";
    expect(token).toMatch(/^mlt_/);
    const prompt = (await reveal.getByLabel("setup prompt", { exact: true }).textContent()) ?? "";
    expect(prompt).toContain("MAKERLAB_MCP_TOKEN");
    expect(prompt).not.toContain(token);

    // The form and the reveal share one column: neither is wider than the other.
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Create token" }) });
    const formBox = await form.boundingBox();
    const revealBox = await reveal.boundingBox();
    expect(formBox && revealBox).toBeTruthy();
    expect(Math.abs(formBox!.x - revealBox!.x)).toBeLessThanOrEqual(1);
    expect(revealBox!.x + revealBox!.width).toBeLessThanOrEqual(formBox!.x + formBox!.width + 1);

    await reveal.getByRole("button", { name: "I've copied it" }).click();
    await expect(page.locator("body")).not.toContainText(token);
    await expect(page.getByRole("table", { name: "Your tokens" }).getByRole("row", { name: /E2E laptop/ })).toBeVisible();
  });
});

test("/mcp offers the setup prompt, sign-in address first", async ({ page }) => {
  await page.goto("/mcp");
  await expect(page.getByRole("heading", { name: "Copy setup prompt for your AI" })).toBeVisible();
  const prompt = (await page.getByLabel("setup prompt", { exact: true }).textContent()) ?? "";
  expect(prompt.indexOf("/api/mcp/signed-in")).toBeGreaterThan(-1);
  expect(prompt.indexOf("/api/mcp/signed-in")).toBeLessThan(prompt.indexOf("MAKERLAB_MCP_TOKEN"));
  await expect(page.getByRole("button", { name: "Copy setup prompt" })).toBeVisible();
});

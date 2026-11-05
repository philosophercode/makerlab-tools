import type { Browser, BrowserContext, Locator, Page } from "playwright";

/**
 * Browser contexts for the footage. Every one runs against a LOCAL dev server
 * (never production: anonymous questions there count in the lab's usage
 * insight). See README.md for how to start it.
 */
export const BASE = process.env.CAPTURE_BASE_URL ?? "http://localhost:3923";

/** The production origin, shown on read-only pages that print their own address. */
export const PUBLIC_HOST = "makerlab-ai.vercel.app";

/**
 * Hides development-only chrome the deployed site never shows: Next's dev
 * indicator / compile toast, and the dev "Sign in as" link. Nothing else on
 * the page is touched. Also marks the assistant intro callout as seen, as it
 * is for anyone who has visited before.
 */
const PRODUCTION_LOOK = `
  nextjs-portal { display: none !important; }
  .primary-nav-dev-sign-in { display: none !important; }
  html { scroll-behavior: auto !important; }
`;

async function prepare(ctx: BrowserContext): Promise<void> {
  await ctx.addInitScript((css) => {
    try {
      localStorage.setItem("makerlab.assistant-intro.seen", "dismissed");
    } catch {}
    const add = () => {
      const s = document.createElement("style");
      s.dataset.capture = "1";
      s.textContent = css;
      document.head.appendChild(s);
    };
    if (document.head) add();
    else document.addEventListener("DOMContentLoaded", add);
  }, PRODUCTION_LOOK);
}

export type Kind = "desktop" | "phone" | "tv";

export async function newContext(
  browser: Browser,
  kind: Kind,
  opts: { staff?: boolean; publicHost?: boolean } = {}
): Promise<BrowserContext> {
  const ctx =
    kind === "phone"
      ? await browser.newContext({
          viewport: { width: 393, height: 852 },
          deviceScaleFactor: 2,
          isMobile: true,
          hasTouch: true,
          userAgent:
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
        })
      : kind === "tv"
        ? await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 })
        : await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await prepare(ctx);
  if (opts.staff) {
    // Development-only sign-in as DEV_AUTO_SIGN_IN_EMAIL (a lab super admin).
    const p = await ctx.newPage();
    const res = await p.goto(`${BASE}/api/dev/sign-in?next=/`, { timeout: 180_000 });
    if (!res || res.status() >= 400) throw new Error("dev sign-in refused: is DEV_AUTO_SIGN_IN=1 set?");
    await p.close();
  }
  if (opts.publicHost) {
    // Read-only pages build their own links from the request host; show the
    // deployed address rather than localhost. Never used where a form posts.
    await ctx.setExtraHTTPHeaders({ "x-forwarded-host": PUBLIC_HOST, "x-forwarded-proto": "https" });
  }
  return ctx;
}

/** Loads a route once so the recording never waits on a dev compile. */
export async function warm(page: Page, path: string): Promise<void> {
  await page.goto(BASE + path, { timeout: 300_000, waitUntil: "networkidle" }).catch(() => {});
}

export async function open(page: Page, path: string): Promise<void> {
  await page.goto(BASE + path, { timeout: 300_000 });
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(800);
}

/** Resolves when the chat's answer to `question` has finished streaming. */
export function chatAnswer(page: Page, question: string): Promise<void> {
  const key = question.slice(0, 24);
  return page
    .waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/chat" && (r.request().postData() ?? "").includes(key),
      { timeout: 300_000 }
    )
    .then(async (r) => {
      if (r.status() !== 200) throw new Error(`chat answered ${r.status()}`);
      await r.finished();
      const text = await r.text().catch(() => "");
      if (/message limit|rate.?limit/i.test(text)) throw new Error("chat refused: anonymous message limit (set RATE_LIMIT_ANON_CHAT)");
    })
    .then(() => page.waitForTimeout(900));
}

export function composer(scope: Page | Locator): Locator {
  return scope.getByRole("textbox", { name: "Ask the MakerLAB Assistant" });
}

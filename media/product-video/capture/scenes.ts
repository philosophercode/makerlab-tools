import type { Browser, Page } from "playwright";
import { Recorder } from "./recorder.ts";
import { chatAnswer, composer, newContext, open, warm } from "./session.ts";

/**
 * One function per clip. Each drives the real app and records it; the edit
 * (src/) decides what to keep. Marks name the moments the edit zooms onto.
 */
export type Take = (browser: Browser, record: (page: Page, clip: string, touch?: boolean) => Recorder, done: (r: Recorder) => Promise<void>) => Promise<void>;

const X1 = "/tools/bambu-lab-x1-carbon-combo-3d-printer";
export const QUESTIONS = {
  operate: "How do I load filament on the X1 Carbon?",
  report: "My print is stuck to the bed on X1C #1. I let it cool and flexed the plate, still stuck. Please report it, anonymous is fine.",
  plan: "I want to CNC a chair with laser-cut inlays. Can you help me plan?",
  intake: process.env.INTAKE_ITEM ?? "Add a Bambu Lab H2D 3D printer to the inventory.",
};

/** 1 — the QR label studio: preview the X1-Carbon's label. */
const hookQr: Take = async (browser, record, done) => {
  const ctx = await newContext(browser, "desktop", { staff: true });
  const page = await ctx.newPage();
  await warm(page, "/admin/inventory/qr");
  await open(page, "/admin/inventory/qr");
  const rec = record(page, "hook-qr");
  await rec.begin();
  await rec.moveTo(700, 450, 10);
  await rec.hold(700);
  const row = page.getByRole("row", { name: /Bambu Lab X1-Carbon/ });
  await rec.click(row.getByRole("button", { name: /preview/i }));
  await rec.hold(900);
  await rec.mark("label", page.locator("[data-qr-preview]").first());
  await rec.hold(3500);
  await done(rec);
  await ctx.close();
};

/** 2 + 3 — phone: arrive from the QR, ask, see the cited page; then report a problem. */
const phone: Take = async (browser, record, done) => {
  const ctx = await newContext(browser, "phone");
  const page = await ctx.newPage();
  await warm(page, `${X1}?src=qr`);
  await open(page, `${X1}?src=qr`);
  let rec = record(page, "phone-ask", true);
  await rec.begin();
  await rec.mark("arrival", page.getByRole("region", { name: "Scanned from this machine" }));
  await rec.hold(1800);
  await rec.click(page.getByRole("button", { name: "Open the MakerLAB Assistant" }));
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await rec.hold(500);
  await rec.click(composer(dialog), { ms: 300 });
  await rec.type(composer(dialog), QUESTIONS.operate);
  const answered = chatAnswer(page, QUESTIONS.operate);
  await rec.click(dialog.getByRole("button", { name: "Send" }), { ms: 350 });
  rec.note("sent");
  await answered;
  rec.note("answered");
  const chip = dialog.locator("[data-slot='inline-citation-mark']").first();
  await chip.scrollIntoViewIfNeeded().catch(() => {});
  await rec.hold(300);
  await rec.mark("citation", chip);
  await rec.hold(2200);
  // The answer's sources: which manual, which page.
  const sources = dialog.getByRole("button", { name: /manual page/i }).last();
  if (await sources.count()) {
    await rec.click(sources, { ms: 500 });
    await rec.hold(600);
    await rec.mark("sources", sources);
  }
  await rec.hold(2200);
  await done(rec);

  rec = record(page, "phone-report", true);
  await rec.begin();
  await rec.hold(400);
  await rec.click(composer(dialog), { ms: 300 });
  await rec.type(composer(dialog), QUESTIONS.report, 30);
  const reported = chatAnswer(page, QUESTIONS.report);
  await rec.click(dialog.getByRole("button", { name: "Send" }), { ms: 350 });
  rec.note("sent");
  await reported;
  rec.note("answered");
  await rec.mark("ticket", dialog.getByText(/filed|ticket|report/i).last());
  await rec.hold(2500);
  await done(rec);
  await ctx.close();
};

/** 3b — staff: the maintenance queue, filtered to the new report. */
const staffQueue: Take = async (browser, record, done) => {
  const ctx = await newContext(browser, "desktop", { staff: true });
  const page = await ctx.newPage();
  await warm(page, "/admin/maintenance");
  await open(page, "/admin/maintenance");
  const rec = record(page, "staff-queue");
  await rec.begin();
  await rec.moveTo(900, 300, 10);
  await rec.hold(900);
  const search = page.getByPlaceholder(/Title, machine or words/);
  await rec.click(search);
  await rec.type(search, "stuck to the bed", 45);
  await rec.hold(1200);
  await rec.mark("ticket", page.locator("article, li, [role='row']").filter({ hasText: /stuck/i }).first());
  await rec.hold(2500);
  await done(rec);
  await ctx.close();
};

/** 4 — plan a project from the catalog. */
const plan: Take = async (browser, record, done) => {
  const ctx = await newContext(browser, "desktop");
  const page = await ctx.newPage();
  await warm(page, "/");
  await open(page, "/");
  const rec = record(page, "plan");
  await rec.begin();
  await rec.moveTo(720, 500, 10);
  await rec.hold(900);
  await rec.click(page.getByRole("button", { name: "Open the MakerLAB Assistant" }));
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await rec.hold(400);
  await rec.click(composer(dialog), { ms: 400 });
  await rec.type(composer(dialog), QUESTIONS.plan, 34);
  const answered = chatAnswer(page, QUESTIONS.plan);
  await rec.click(dialog.getByRole("button", { name: "Send" }), { ms: 350 });
  rec.note("sent");
  await answered;
  rec.note("answered");
  await rec.mark("panel", dialog);
  await rec.mark("training", dialog.getByText(/training|checkout|orientation/i).first());
  await rec.hold(2500);
  await done(rec);
  await ctx.close();
};

/** 5a — staff intake: identify in the chat, send to research. */
const intakeAdd: Take = async (browser, record, done) => {
  const ctx = await newContext(browser, "desktop", { staff: true });
  const page = await ctx.newPage();
  await warm(page, "/admin/intake");
  await open(page, "/admin/intake");
  const rec = record(page, "intake-add");
  await rec.begin();
  await rec.moveTo(800, 400, 10);
  await rec.hold(900);
  await rec.click(page.getByRole("button", { name: /Ask the assistant/i }).first());
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await rec.hold(400);
  await rec.click(composer(dialog), { ms: 400 });
  await rec.type(composer(dialog), QUESTIONS.intake, 36);
  const answered = chatAnswer(page, QUESTIONS.intake);
  await rec.click(dialog.getByRole("button", { name: "Send" }), { ms: 350 });
  rec.note("sent");
  await answered;
  rec.note("answered");
  const add = dialog.getByRole("button", { name: /Add to research/ }).first();
  await add.waitFor({ timeout: 30_000 });
  await rec.mark("card", add);
  await rec.hold(1200);
  await rec.click(add);
  await rec.hold(800);
  const confirm = page.getByRole("button", { name: /^(Start research|Research|Confirm|Yes|Add to research)/ }).last();
  await rec.mark("confirm", confirm);
  await rec.click(confirm);
  await rec.hold(2500);
  await done(rec);
  await ctx.close();
};

/** 5b — staff intake: the researched record, approved. */
const intakeApprove: Take = async (browser, record, done) => {
  const ctx = await newContext(browser, "desktop", { staff: true });
  const page = await ctx.newPage();
  const name = process.env.INTAKE_NAME ?? "H2D";
  await warm(page, "/admin/intake");
  await open(page, "/admin/intake");
  const link = page.getByRole("link", { name: new RegExp(name, "i") }).first();
  const rec = record(page, "intake-approve");
  await rec.begin();
  await rec.moveTo(700, 400, 10);
  await rec.mark("row", link);
  await rec.hold(1200);
  await rec.click(link);
  await page.waitForLoadState("networkidle").catch(() => {});
  await rec.hold(1500);
  await rec.mark("record", page.locator("main"));
  await rec.scroll(440, 1500);
  await rec.hold(1200);
  await rec.scroll(520, 1500);
  await rec.hold(1200);
  const approve = page.getByRole("button", { name: process.env.INTAKE_APPROVE === "publish" ? /^Approve$/ : /Approve as draft/ }).first();
  await approve.scrollIntoViewIfNeeded();
  await rec.hold(600);
  await rec.mark("approve", approve);
  await rec.click(approve);
  await rec.hold(3000);
  await rec.mark("approved", page.getByText(/Approved/).first());
  await done(rec);
  await ctx.close();
};

/** 6a — the lab status screen. */
const kiosk: Take = async (browser, record, done) => {
  const ctx = await newContext(browser, "tv", { publicHost: true });
  // Film it during opening hours: the screen's clock is the browser's.
  if (process.env.KIOSK_TIME !== "now") await ctx.clock.setFixedTime(new Date(process.env.KIOSK_TIME ?? "2026-10-02T14:40:00"));
  const page = await ctx.newPage();
  await warm(page, "/kiosk");
  await open(page, "/kiosk");
  const rec = record(page, "kiosk");
  await rec.begin();
  await rec.hold(6000);
  await done(rec);
  await ctx.close();
};

/** 6b — connect an AI over MCP. */
const mcp: Take = async (browser, record, done) => {
  const ctx = await newContext(browser, "desktop", { publicHost: true });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://localhost:3923" });
  const page = await ctx.newPage();
  await warm(page, "/mcp");
  await open(page, "/mcp");
  const rec = record(page, "mcp");
  await rec.begin();
  await rec.moveTo(720, 600, 10);
  await rec.hold(1200);
  await rec.mark("addresses", page.getByText(/Server addresses/i).first());
  await rec.click(page.getByRole("button", { name: /copy/i }).first());
  await rec.hold(2500);
  await done(rec);
  await ctx.close();
};

export const TAKES: Record<string, Take> = {
  "hook-qr": hookQr,
  phone,
  "staff-queue": staffQueue,
  plan,
  "intake-add": intakeAdd,
  "intake-approve": intakeApprove,
  kiosk,
  mcp,
};

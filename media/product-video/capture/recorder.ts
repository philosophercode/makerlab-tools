import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CDPSession, Locator, Page } from "playwright";

/**
 * Records one clip of a real page as a lossless-ish JPEG frame sequence through
 * Chrome's screencast (at the context's device scale, so 2x footage stays crisp
 * when the edit zooms in), plus a timeline of what the script did: pointer
 * moves, clicks/taps, typing, scrolls and named "marks" (an element's box at a
 * moment). The edit reads the timeline to draw the cursor and aim the zooms.
 *
 * Headless Chrome draws no cursor, so the pointer is never in the footage; the
 * composition draws it from `pointer` events.
 */

export type Box = { x: number; y: number; width: number; height: number };
export type TimelineEvent =
  | { t: number; type: "pointer"; x: number; y: number }
  | { t: number; type: "click"; x: number; y: number }
  | { t: number; type: "type"; text: string }
  | { t: number; type: "mark"; name: string; box: Box | null }
  | { t: number; type: "note"; text: string };

export type Timeline = {
  clip: string;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  url: string;
  duration: number;
  events: TimelineEvent[];
};

type Frame = { t: number; file: string };

export class Recorder {
  private cdp: CDPSession | null = null;
  private frames: Frame[] = [];
  private pending: Promise<unknown>[] = [];
  private start = 0;
  private stopped = false;
  readonly events: TimelineEvent[] = [];
  private pointer = { x: 0, y: 0 };

  readonly page: Page;
  readonly clip: string;
  readonly dir: string;
  readonly opts: { touch?: boolean };

  constructor(page: Page, clip: string, dir: string, opts: { touch?: boolean } = {}) {
    this.page = page;
    this.clip = clip;
    this.dir = dir;
    this.opts = opts;
  }

  /** Seconds since the clip started (screencast clock: wall time). */
  now(): number {
    return Date.now() / 1000 - this.start;
  }

  async begin(): Promise<void> {
    await mkdir(join(this.dir, "frames"), { recursive: true });
    const vp = this.page.viewportSize()!;
    const dpr = await this.page.evaluate(() => window.devicePixelRatio);
    this.cdp = await this.page.context().newCDPSession(this.page);
    this.start = Date.now() / 1000;
    let n = 0;
    this.cdp.on("Page.screencastFrame", (f) => {
      if (this.stopped) return;
      const file = join(this.dir, "frames", `f${String(n++).padStart(6, "0")}.jpg`);
      const t = (f.metadata.timestamp ?? Date.now() / 1000) - this.start;
      this.frames.push({ t, file });
      this.pending.push(writeFile(file, Buffer.from(f.data, "base64")));
      void this.cdp!.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    });
    await this.cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 88,
      maxWidth: Math.round(vp.width * dpr),
      maxHeight: Math.round(vp.height * dpr),
      everyNthFrame: 1,
    });
    // A screencast only sends frames when something changes; nudge one out.
    await this.page.evaluate(() => {
      const d = document.createElement("div");
      d.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.01;pointer-events:none";
      document.body.appendChild(d);
      requestAnimationFrame(() => d.remove());
    });
  }

  async end(): Promise<Timeline & { frames: Frame[] }> {
    // Hold the last frame a moment so the edit has a tail to cut on.
    await this.page.waitForTimeout(600);
    const duration = this.now();
    this.stopped = true;
    await this.cdp?.send("Page.stopScreencast").catch(() => {});
    await Promise.all(this.pending);
    const vp = this.page.viewportSize()!;
    const dpr = await this.page.evaluate(() => window.devicePixelRatio);
    return {
      clip: this.clip,
      viewport: vp,
      deviceScaleFactor: dpr,
      url: this.page.url(),
      duration,
      events: this.events,
      frames: this.frames,
    };
  }

  note(text: string): void {
    this.events.push({ t: this.now(), type: "note", text });
  }

  async box(target: Locator): Promise<Box | null> {
    return target.boundingBox().catch(() => null);
  }

  /** Records where an element is now, for the edit to zoom onto. */
  async mark(name: string, target: Locator | Box | null): Promise<void> {
    const box = target && "boundingBox" in target ? await this.box(target) : (target as Box | null);
    this.events.push({ t: this.now(), type: "mark", name, box });
  }

  /** Eased pointer glide (drawn by the edit; the page sees real mouse moves). */
  async moveTo(x: number, y: number, ms = 650): Promise<void> {
    const from = { ...this.pointer };
    const steps = Math.max(8, Math.round(ms / 16));
    for (let i = 1; i <= steps; i++) {
      const p = i / steps;
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      const nx = from.x + (x - from.x) * e;
      const ny = from.y + (y - from.y) * e;
      if (!this.opts.touch) await this.page.mouse.move(nx, ny);
      this.pointer = { x: nx, y: ny };
      this.events.push({ t: this.now(), type: "pointer", x: nx, y: ny });
      await this.page.waitForTimeout(ms / steps);
    }
  }

  async center(target: Locator): Promise<{ x: number; y: number }> {
    await target.scrollIntoViewIfNeeded();
    const b = await target.boundingBox();
    if (!b) throw new Error(`${this.clip}: no box for ${target}`);
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }

  /** Glide to an element and click (or tap) it, logging the click for a ripple. */
  async click(target: Locator, opts: { ms?: number; settle?: number } = {}): Promise<void> {
    const c = await this.center(target);
    await this.moveTo(c.x, c.y, opts.ms ?? 650);
    await this.page.waitForTimeout(120);
    this.events.push({ t: this.now(), type: "click", x: c.x, y: c.y });
    if (this.opts.touch) await target.tap();
    else await this.page.mouse.click(c.x, c.y);
    await this.page.waitForTimeout(opts.settle ?? 300);
  }

  /** Types like a person: one key at a time. */
  async type(target: Locator, text: string, delay = 38): Promise<void> {
    await target.focus();
    this.events.push({ t: this.now(), type: "type", text });
    await target.pressSequentially(text, { delay });
  }

  /** Smooth scroll of the window or of a scrollable element. */
  async scroll(by: number, ms = 900, within?: Locator): Promise<void> {
    if (within) {
      await within.evaluate(
        (el, a) => new Promise<void>((done) => {
          const start = el.scrollTop;
          const t0 = performance.now();
          const step = (now: number) => {
            const p = Math.min(1, (now - t0) / a.ms);
            const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
            el.scrollTop = start + a.by * e;
            if (p < 1) requestAnimationFrame(step);
            else done();
          };
          requestAnimationFrame(step);
        }),
        { by, ms }
      );
    } else {
      await this.page.evaluate(
        (a) => new Promise<void>((done) => {
          const start = window.scrollY;
          const t0 = performance.now();
          const step = (now: number) => {
            const p = Math.min(1, (now - t0) / a.ms);
            const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
            window.scrollTo(0, start + a.by * e);
            if (p < 1) requestAnimationFrame(step);
            else done();
          };
          requestAnimationFrame(step);
        }),
        { by, ms }
      );
    }
    this.note(`scroll ${by}`);
  }

  async hold(ms: number): Promise<void> {
    await this.page.waitForTimeout(ms);
  }
}

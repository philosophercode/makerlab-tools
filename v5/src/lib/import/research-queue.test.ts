import type { PendingApiError, ResearchStartedResponse } from "../intake/types";
import { queueResearchInChunks, type ResearchPost, type ResearchPostResult } from "./research-queue";

/**
 * **Research selected (N)** in chunks (bulk intake spec §5 step 4, §10 "A
 * 300-row sheet silently researches only 100"): the route is stubbed as a
 * function holding a ledger, so the allowance behaves as the real one does.
 */

const ids = (n: number) => Array.from({ length: n }, (_, i) => `item-${i + 1}`);

function started(queued: string[]): ResearchPostResult {
  const body: ResearchStartedResponse = { requestId: "r", runId: "run", queued, readyAsUnit: [] };
  return { ok: true, body };
}

function refused(status: number, body: PendingApiError, retryAfterSeconds?: number): ResearchPostResult {
  return { ok: false, status, body, ...(retryAfterSeconds ? { retryAfterSeconds } : {}) };
}

/** A route with `allowance` items left today. */
function routeWithAllowance(allowance: number) {
  let used = 0;
  const calls: string[][] = [];
  const post: ResearchPost = async (chunk) => {
    calls.push(chunk);
    if (chunk.length > 25) return refused(400, { code: "too_many_items", error: "" });
    if (used + chunk.length > allowance) return refused(429, { code: "daily_limit", error: "", remaining: allowance - used });
    used += chunk.length;
    return started(chunk);
  };
  return { post, calls };
}

describe("queueResearchInChunks", () => {
  it("sends 25 at a time, in order", async () => {
    const route = routeWithAllowance(1000);
    const outcome = await queueResearchInChunks(ids(60), route.post);
    expect(route.calls.map((call) => call.length)).toEqual([25, 25, 10]);
    expect(outcome.queued).toEqual(ids(60));
    expect(outcome.waiting).toEqual([]);
  });

  it("fills the allowance exactly, and says what waits (37 queued; 63 wait)", async () => {
    const route = routeWithAllowance(37);
    const progress: number[] = [];
    const outcome = await queueResearchInChunks(ids(100), route.post, { onProgress: (p) => progress.push(p.queued) });
    expect(outcome.queued).toHaveLength(37);
    expect(outcome.waiting).toHaveLength(63);
    expect([...outcome.queued, ...outcome.waiting]).toEqual(ids(100));
    // 25, then 25 refused → 12 sent; nothing after the allowance ran out.
    expect(route.calls.map((call) => call.length)).toEqual([25, 25, 12]);
    expect(progress.at(-1)).toBe(37);
  });

  it("a 300-row selection with the daily 100 queues 100 and keeps 200 waiting — never silently", async () => {
    const route = routeWithAllowance(100);
    const outcome = await queueResearchInChunks(ids(300), route.post);
    expect(outcome.queued).toHaveLength(100);
    expect(outcome.waiting).toHaveLength(200);
  });

  it("with a setup allowance, the same selection goes through", async () => {
    const route = routeWithAllowance(500);
    const outcome = await queueResearchInChunks(ids(300), route.post);
    expect(outcome.queued).toHaveLength(300);
  });

  it("waits out the press limit and sends the same chunk again", async () => {
    let pressed = 0;
    const post: ResearchPost = async (chunk) => {
      pressed += 1;
      if (pressed === 2) return refused(429, { code: "rate_limited", error: "" }, 7);
      return started(chunk);
    };
    const sleep = vi.fn(async () => {});
    const outcome = await queueResearchInChunks(ids(50), post, { sleep });
    expect(sleep).toHaveBeenCalledWith(7000);
    expect(outcome.queued).toHaveLength(50);
    expect(pressed).toBe(3);
  });

  it("reports a chunk refused for another reason and carries on", async () => {
    let n = 0;
    const post: ResearchPost = async (chunk) => {
      n += 1;
      return n === 1 ? refused(409, { code: "unresolved_duplicate", error: "", ids: [chunk[0]] }) : started(chunk);
    };
    const outcome = await queueResearchInChunks(ids(30), post);
    expect(outcome.refused).toEqual([{ ids: ids(25), code: "unresolved_duplicate" }]);
    expect(outcome.queued).toEqual(ids(30).slice(25));
  });
});

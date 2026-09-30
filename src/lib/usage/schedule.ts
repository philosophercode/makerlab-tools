import "server-only";

import { after } from "next/server";
import type { UsageEvent, UsageGapInput } from "./events";
import { recordUsage, usageEnabled } from "./record";

/**
 * Record usage **after** the response has gone (`after()`), so the insert
 * never delays a student's answer or page (usage insight spec §5.1). Outside a
 * request scope (a test, a script) `after()` is unavailable and the write runs
 * detached instead. `recordUsage` never throws, and neither does this.
 */
export function scheduleUsage(events: readonly UsageEvent[], gaps: readonly UsageGapInput[] = []): void {
  if (!usageEnabled() || (events.length === 0 && gaps.length === 0)) return;
  const task = async () => {
    await recordUsage(events, gaps);
  };
  try {
    after(task);
  } catch {
    void task().catch(() => {});
  }
}

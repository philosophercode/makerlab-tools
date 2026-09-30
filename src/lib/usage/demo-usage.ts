import { usageEvents, usageGaps } from "../db/schema/usage.ts";
import type { Db } from "../db/types.ts";
import type { QuestionKind, UsageAudience } from "../db/schema/vocabulary.ts";
import { gapKey } from "./gap-key.ts";

/**
 * The demo seed's synthetic week of usage (usage insight spec §9 phase 2:
 * "an admin sees the demo seed's synthetic week"): chat turns, tool views, QR
 * scans, MCP calls, a kiosk, a little staff testing and three unanswered
 * questions, spread over the seven days before `now` in a lab-shaped rhythm —
 * afternoons and evenings, quieter at the weekend. Deterministic (no
 * randomness), so a screenshot and a test see the same week. Invented text
 * only; nobody asked these.
 */
export async function seedDemoUsage(db: Db, toolIds: { form4: string; trotec: string }, now: Date = new Date()): Promise<void> {
  const rows: (typeof usageEvents.$inferInsert)[] = [];
  const hourStart = new Date(now);
  hourStart.setUTCMinutes(0, 0, 0);
  const at = (daysAgo: number, utcHour: number, minute = 10) => {
    const d = new Date(hourStart.getTime() - daysAgo * 86_400_000);
    d.setUTCHours(utcHour, minute, 0, 0);
    return d.getTime() >= now.getTime() ? new Date(d.getTime() - 86_400_000) : d;
  };
  const kinds: QuestionKind[] = ["operate", "operate", "debug", "create", "operate", "other", "debug", "create"];

  for (let day = 0; day < 7; day += 1) {
    // Lab hours in New York (UTC-4): ~13:00–23:00 local is 17:00–03:00 UTC.
    const busy = day % 7 === 5 || day % 7 === 6 ? 2 : 5;
    for (let i = 0; i < busy; i += 1) {
      const hour = [18, 19, 20, 21, 22, 23, 0][((day + i) * 3) % 7];
      const when = at(day, hour, 5 + i * 7);
      const tool = i % 3 === 0 ? toolIds.trotec : toolIds.form4;
      const audience: UsageAudience = i % 4 === 3 ? "member" : "anonymous";
      rows.push({ occurredAt: when, kind: "chat_turn", surface: "chat", audience, questionKind: kinds[(day + i) % kinds.length], locale: "en" });
      rows.push({ occurredAt: when, kind: "tool_asked", surface: "chat", audience, toolId: tool });
      rows.push({ occurredAt: when, kind: "tool_view", surface: "web", audience, toolId: tool, source: i % 2 === 0 ? "qr" : "direct" });
      if (i % 2 === 1) rows.push({ occurredAt: when, kind: "tool_view", surface: "web", audience, toolId: toolIds.form4, source: "direct" });
    }
    rows.push({ occurredAt: at(day, 16, 40), kind: "mcp_call", surface: "mcp", audience: "member", source: "search_tools" });
    rows.push({ occurredAt: at(day, 16, 41), kind: "mcp_call", surface: "mcp", audience: "member", source: "get_tool_details" });
    rows.push({ occurredAt: at(day, 16, 41), kind: "tool_asked", surface: "mcp", audience: "member", toolId: toolIds.trotec });
    rows.push({ occurredAt: at(day, 13, 0), kind: "kiosk_view", surface: "web", audience: "anonymous", source: "screen" });
    if (day % 2 === 0) rows.push({ occurredAt: at(day, 20, 30), kind: "kiosk_view", surface: "web", audience: "anonymous", source: "qr" });
    // A SuperMaker testing the assistant: left out of the page by default.
    rows.push({ occurredAt: at(day, 15, 0), kind: "chat_turn", surface: "chat", audience: "staff", questionKind: "operate" });
    rows.push({ occurredAt: at(day, 15, 0), kind: "tool_asked", surface: "chat", audience: "staff", toolId: toolIds.form4 });
  }

  const gaps = [
    { kind: "not_in_catalog", question: "Do you have a waterjet cutter?", toolId: null, occurrences: 4, daysAgo: 1 },
    { kind: "no_manual_passage", question: "Can the Trotec cut glass or mirrored acrylic?", toolId: toolIds.trotec, occurrences: 2, daysAgo: 2 },
    { kind: "honest_absence", question: "What resin works for flexible parts on the Form 4?", toolId: toolIds.form4, occurrences: 1, daysAgo: 3 },
  ] as const;
  for (const gap of gaps) {
    const [row] = await db
      .insert(usageGaps)
      .values({
        key: gapKey(gap.question, gap.toolId),
        kind: gap.kind,
        toolId: gap.toolId,
        question: gap.question,
        occurrences: gap.occurrences,
        firstSeen: at(gap.daysAgo + 2, 19),
        lastSeen: at(gap.daysAgo, 21),
      })
      .returning({ id: usageGaps.id });
    for (let i = 0; i < gap.occurrences; i += 1) {
      const when = at(gap.daysAgo + i, 21, 15);
      rows.push({ occurredAt: when, kind: "chat_turn", surface: "chat", audience: "anonymous", questionKind: "other" });
      rows.push({ occurredAt: when, kind: "gap", surface: "chat", audience: "anonymous", toolId: gap.toolId, source: gap.kind, gapId: row.id });
    }
  }

  await db.insert(usageEvents).values(rows);
}

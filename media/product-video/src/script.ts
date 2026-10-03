/**
 * The voiceover script, timed to the edit. It is the single source for the
 * burned-in captions and for VOICEOVER.md (`npm run voiceover:md`).
 *
 * Times are seconds on the final 60-second timeline. A recorded voiceover
 * should land each line inside its window; captions are drawn from `text`.
 */
export type ScriptLine = { id: string; start: number; end: number; text: string; note?: string };

export const SCRIPT: ScriptLine[] = [
  {
    id: "hook",
    start: 0.3,
    end: 4.7,
    text: "Every makerspace runs on knowledge that's scattered: manuals, rules, who fixed what.",
  },
  {
    id: "operate",
    start: 5.2,
    end: 14.6,
    text: "MakerLAB AI knows every machine in the lab. Scan one, ask, and it answers from the manual, down to the page.",
  },
  {
    id: "debug",
    start: 15.4,
    end: 22.6,
    text: "When something breaks, it files the ticket for you, and staff see it in their queue.",
    note: "Changed from \"staff get the alert\": email alerts are not built yet; the footage shows the queue.",
  },
  {
    id: "create",
    start: 23.4,
    end: 32.6,
    text: "Planning a project? It maps your build across the lab's own machines and flags the training you need.",
  },
  {
    id: "staff",
    start: 33.4,
    end: 44.6,
    text: "For staff, a name or a photo becomes a complete record, manuals included, and nothing goes live until you approve it.",
    note: "Changed from \"a photo becomes a complete record with manuals in about a minute\": the take adds a tool by name, and research took about four minutes locally (shown as a time skip).",
  },
  {
    id: "screen",
    start: 45.4,
    end: 52.6,
    text: "The lab screen shows what's up, and you can even use it from your own AI.",
  },
  {
    id: "end",
    start: 54.0,
    end: 58.6,
    text: "MakerLAB AI. Operate, fix and build.",
  },
];

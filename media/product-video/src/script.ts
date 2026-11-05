/**
 * The narration script: one line per scene, keyed by scene id. The single
 * source for the TTS narration (scripts/tts.ts), the captions (burned in on
 * the 9:16 cut, closed captions on the 16:9) and VOICEOVER.md. Timing comes
 * from src/narration.ts (scene start + the clip's real length).
 */
export type ScriptLine = { id: string; text: string; note?: string };

export const SCRIPT: ScriptLine[] = [
  {
    id: "hook",
    text: "Every makerspace runs on knowledge that's scattered: manuals, rules, who fixed what.",
  },
  {
    id: "operate",
    text: "MakerLAB AI knows every machine in the lab. Scan one, ask, and it answers from the manual, down to the page.",
  },
  {
    id: "debug",
    text: "When something breaks, it files the ticket for you, and staff see it in their queue.",
    note: "Changed from \"staff get the alert\": email alerts are not built yet; the footage shows the queue.",
  },
  {
    id: "create",
    text: "Planning a project? It maps your build across the lab's own machines and flags the training you need.",
  },
  {
    id: "staff",
    text: "For staff, a name or a photo becomes a complete record, manuals included, and nothing goes live until you approve it.",
    note: "Changed from \"a photo becomes a complete record with manuals in about a minute\": the take adds a tool by name, and research took about four minutes locally (shown as a time skip).",
  },
  {
    id: "screen",
    text: "The lab screen shows what's up, and you can even use it from your own AI.",
  },
  {
    id: "end",
    text: "MakerLAB AI. Operate, fix and build.",
  },
];

import { listPublishedStarterTools } from "../data/starter-answers.ts";
import type { Db } from "../db/types.ts";
import { chipStates, type ChipStatus } from "./cache.ts";
import { generalChipQuestions } from "./general.ts";

/**
 * The admin view's rows (`/admin/research`, starter answers): the general
 * chips, then every published tool's chips by tool name, each with its
 * status and grade. Three reads plus the hash inputs.
 */
export interface StarterChipAdminRow {
  id: string;
  toolName: string | null;
  toolSlug: string | null;
  question: string;
  status: ChipStatus;
  score: number | null;
  reasons: string[];
}

export async function loadStarterChipRows(db: Db): Promise<StarterChipAdminRow[]> {
  const tools = await listPublishedStarterTools(db);
  const general = generalChipQuestions();
  const states = await chipStates(db, [
    { toolId: null, questions: general },
    ...tools.map((tool) => ({ toolId: tool.id, questions: tool.starterQuestions })),
  ]);
  const rows: StarterChipAdminRow[] = [];
  for (const [index, chip] of (states.get(null) ?? []).entries()) {
    rows.push({ id: `general-${index}`, toolName: null, toolSlug: null, question: chip.question, status: chip.status, score: chip.score, reasons: chip.reasons });
  }
  for (const tool of tools) {
    for (const [index, chip] of (states.get(tool.id) ?? []).entries()) {
      rows.push({
        id: `${tool.id}-${index}`,
        toolName: tool.name,
        toolSlug: tool.slug,
        question: chip.question,
        status: chip.status,
        score: chip.score,
        reasons: chip.reasons,
      });
    }
  }
  return rows;
}

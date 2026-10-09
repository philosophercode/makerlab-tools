import { and, eq, gte, lte } from "drizzle-orm";
import { loadDocumentForQuestions, replaceDocumentQuestions } from "@/lib/data/manual-eval-questions";
import { getDb } from "@/lib/db/client";
import { manualChunks, manualDocuments } from "@/lib/db/schema/index";
import { documentTextHash } from "@/lib/manuals/eval-questions-pick";
import { EVAL_MANUAL_TITLE, EVAL_SCAN_TITLE } from "./manual-fixture";

/**
 * Eval questions for the eval's own fixture manuals (manual text spec
 * amendment 2026-10-07): what job `evalQuestions` would write for the Form 4
 * Manual and the scanned Form Wash Guide (`manual-fixture.ts`), written by
 * hand so a run on the demo seed (`EVAL_MQ_FIXTURES=1`) and the offline test
 * need no model. Phrased as a student would ask, with no page numbers; each
 * names the page its answer is on.
 */
export const FIXTURE_QUESTIONS: { document: string; question: string; page: number; answer: string }[] = [
  { document: EVAL_MANUAL_TITLE, question: "Where should I set the printer up?", page: 12, answer: "On a level, stable surface out of direct sunlight, with room behind it for the cables." },
  { document: EVAL_MANUAL_TITLE, question: "How do I put in a new resin cartridge?", page: 30, answer: "Close the valve cap, lift the old cartridge out, shake the new one and insert it until it clicks." },
  { document: EVAL_MANUAL_TITLE, question: "What should I wipe the build platform with after printing?", page: 38, answer: "A lint-free towel soaked in isopropyl alcohol, then let it dry." },
  { document: EVAL_MANUAL_TITLE, question: "How do I swap out the resin tank?", page: 42, answer: "Wear gloves, remove the build platform, lift the tank straight up and slide the new one in until both tabs seat." },
  { document: EVAL_MANUAL_TITLE, question: "My print didn't stick to the build platform. What should I check?", page: 48, answer: "A clean, dry platform, an unclouded tank film, supports; then run platform calibration." },
  { document: EVAL_SCAN_TITLE, question: "How long can I leave parts soaking in IPA?", page: 3, answer: "Wash for 10 minutes and never more than 20." },
  { document: EVAL_SCAN_TITLE, question: "How long do washed parts need to dry before curing?", page: 5, answer: "At least 30 minutes." },
];

/**
 * Store {@link FIXTURE_QUESTIONS} on the seeded fixture manuals (call after
 * `seedEvalManual()`), replacing whatever they had. Returns how many.
 */
export async function seedEvalManualQuestions(): Promise<number> {
  const db = await getDb();
  let stored = 0;
  for (const title of [EVAL_MANUAL_TITLE, EVAL_SCAN_TITLE]) {
    const [doc] = await db.select({ id: manualDocuments.id }).from(manualDocuments).where(eq(manualDocuments.title, title));
    if (!doc) throw new Error(`the fixture manual "${title}" is not seeded; call seedEvalManual() first`);
    const loaded = await loadDocumentForQuestions(db, doc.id);
    if (!loaded) throw new Error(`the fixture manual "${title}" has no passages`);
    const questions = [];
    for (const q of FIXTURE_QUESTIONS.filter((q) => q.document === title)) {
      const [chunk] = await db
        .select({ ordinal: manualChunks.ordinal, sectionPath: manualChunks.sectionPath })
        .from(manualChunks)
        .where(and(eq(manualChunks.documentId, doc.id), lte(manualChunks.pageStart, q.page), gte(manualChunks.pageEnd, q.page)))
        .orderBy(manualChunks.ordinal)
        .limit(1);
      if (!chunk) throw new Error(`no passage of "${title}" covers page ${q.page}`);
      questions.push({
        question: q.question,
        expectedPages: [q.page],
        chunkOrdinal: chunk.ordinal,
        sectionPath: chunk.sectionPath,
        expectedAnswer: q.answer,
      });
    }
    await replaceDocumentQuestions(db, doc.id, {
      toolId: loaded.toolId,
      sourceHash: documentTextHash(loaded.pages),
      model: "fixture",
      questions,
    });
    stored += questions.length;
  }
  return stored;
}

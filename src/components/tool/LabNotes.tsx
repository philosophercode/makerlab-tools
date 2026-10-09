import { useTranslations } from "next-intl";
import { labNoteLines } from "../../lib/lab-notes/lines";

/**
 * A tool's **Lab notes** on its page (identity spec amendment "Lab notes";
 * DESIGN.md §8.17): the lab staff's own rules and tips for it — "Always put a
 * cutting mat underneath so you don't scratch the table." In the hero, under
 * the status line and **above the description**, so the lab's word comes
 * before the generic manufacturer text.
 *
 * Not tinted (only Safety is) and not in the accent (that is for action): an
 * ink rule down the start edge, a mono label saying whose words they are, and
 * the notes, one per line — a list when there are several. Empty is absent.
 */
export function LabNotes({ notes }: { notes: string | null | undefined }) {
  const t = useTranslations("detail");
  const lines = labNoteLines(notes);
  if (lines.length === 0) return null;

  return (
    <section aria-labelledby="tool-lab-notes" data-slot="tool-lab-notes" className="max-w-[72ch] border-s-2 border-s-foreground py-0.5 ps-3">
      <h2 id="tool-lab-notes" className="mb-1 flex flex-wrap items-baseline gap-x-2 font-mono text-label tracking-[0.08em] uppercase">
        <span className="font-medium text-foreground">{t("labNotes")}</span>
        <span aria-hidden="true" className="text-muted-foreground">
          ·
        </span>
        <span className="text-muted-foreground">{t("labNotesFrom")}</span>
      </h2>
      {lines.length === 1 ? (
        <p className="m-0 text-[15px]">{lines[0]}</p>
      ) : (
        <ul className="m-0 flex list-disc flex-col gap-0.5 ps-5 text-[15px]">
          {lines.map((line, n) => (
            <li key={n}>{line}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

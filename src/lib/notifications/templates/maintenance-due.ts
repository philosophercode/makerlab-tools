import type { DueSubject, DueTaskLine } from "../subjects.ts";
import { copy } from "./copy.ts";
import { buttonHtml, escapeHtml, layout, oneLine, subjectLine, type RenderedEmail } from "./html.ts";

/**
 * The daily recurring-maintenance reminder (email notifications spec,
 * amendment 2026-10-07). Pure. Lists what is overdue, then what is due today,
 * and links to the Shift checklist on `/admin/maintenance`. Never rendered for
 * an empty list: an empty reminder is not sent.
 */

/** Lines shown per section; the rest are counted. */
export const DUE_LINES_MAX = 25;

export interface MaintenanceDueInput {
  due: DueSubject;
  origin: string;
  checklistUrl: string;
  unsubscribeUrl: string | null;
  /** "Wednesday, October 7", in the lab's timezone. */
  dateLabel: string;
}

function lineText(line: DueTaskLine): string {
  const c = copy.maintenanceDue;
  const tool = oneLine(line.toolName, 80);
  const unit = oneLine(line.unitLabel, 80);
  // A unit labelled with its tool's own name is said once.
  const where = [tool || c.labWide, unit.toLowerCase() === tool.toLowerCase() ? "" : unit].filter(Boolean).join(" · ");
  const late = line.overdueDays > 0 ? ` · ${c.daysOverdue(line.overdueDays)}` : "";
  return `${oneLine(line.title, 120)} · ${where}${late}`;
}

function section(heading: string, lines: DueTaskLine[]): { text: string[]; html: string } {
  if (lines.length === 0) return { text: [], html: "" };
  const shown = lines.slice(0, DUE_LINES_MAX);
  const rest = lines.length - shown.length;
  const more = rest > 0 ? copy.maintenanceDue.more(rest) : "";
  const text = ["", heading, ...shown.map((line) => `- ${lineText(line)}`), ...(more ? [`- ${more}`] : [])];
  const items = shown.map((line) => `<li style="margin:0 0 4px;">${escapeHtml(lineText(line))}</li>`).join("");
  const html = `<h2 style="margin:16px 0 8px;font-size:16px;font-weight:600;">${escapeHtml(heading)}</h2><ul style="margin:0;padding-left:20px;">${items}${
    more ? `<li style="margin:0 0 4px;color:#555555;">${escapeHtml(more)}</li>` : ""
  }</ul>`;
  return { text, html };
}

export function renderMaintenanceDue(input: MaintenanceDueInput): RenderedEmail {
  const c = copy.maintenanceDue;
  const { overdue, dueToday } = input.due;
  const intro = c.intro(input.dateLabel);
  const late = section(c.overdue(overdue.length), overdue);
  const today = section(c.dueToday(dueToday.length), dueToday);

  const text = [
    intro,
    ...late.text,
    ...today.text,
    "",
    `${c.open}: ${input.checklistUrl}`,
    "",
    "--",
    c.why,
    ...(input.unsubscribeUrl ? [`${c.unsubscribe}: ${input.unsubscribeUrl}`] : []),
    "",
  ].join("\n");

  const bodyHtml = [`<p style="margin:0 0 4px;">${escapeHtml(intro)}</p>`, late.html, today.html, buttonHtml(input.checklistUrl, c.open)].join("\n");

  return {
    subject: subjectLine(c.subject(overdue.length, dueToday.length)),
    text,
    html: layout({
      origin: input.origin,
      heading: c.heading,
      bodyHtml,
      why: c.why,
      unsubscribeUrl: input.unsubscribeUrl,
      unsubscribeLabel: c.unsubscribe,
    }),
  };
}

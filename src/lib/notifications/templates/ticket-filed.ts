import { siteConfig } from "../../site-config.ts";
import type { NotificationSurface } from "../../db/schema/vocabulary.ts";
import type { TicketSubject } from "../subjects.ts";
import { copy, PRIORITY_LABEL } from "./copy.ts";
import { buttonHtml, escapeHtml, excerpt, factsHtml, layout, oneLine, subjectLine, TITLE_MAX, type RenderedEmail } from "./html.ts";

/**
 * The `ticket.filed` email (email notifications spec §5.1). Pure: everything
 * it shows is handed in, and nothing it is handed carries an address.
 */

export interface TicketFiledInput {
  ticket: TicketSubject;
  surface: NotificationSurface | null;
  origin: string;
  /** The ticket on `/admin/maintenance`. */
  ticketUrl: string;
  unsubscribeUrl: string | null;
  /** "4:12 PM", in the lab's timezone. */
  filedAt: string;
}

function reporterLine(ticket: TicketSubject, surface: NotificationSurface | null): string {
  const name = oneLine(ticket.reporterName, 80);
  const c = copy.ticketFiled;
  if (!name) return c.anonymous;
  if (ticket.reporterSignedIn) return surface === "mcp" ? c.viaApp(name) : c.signedIn(name);
  return c.named(name);
}

export function renderTicketFiled(input: TicketFiledInput): RenderedEmail {
  const c = copy.ticketFiled;
  const { ticket } = input;
  const title = oneLine(ticket.title, TITLE_MAX);
  const tool = oneLine(ticket.toolName, 80);
  // A one-unit tool's unit is often labelled with the tool's own name: say it once.
  const unitLabel = oneLine(ticket.unitLabel, 80);
  const unit = unitLabel.toLowerCase() === tool.toLowerCase() ? "" : unitLabel;
  const priority = ticket.priority ? (PRIORITY_LABEL[ticket.priority] ?? "") : "";
  const reporter = reporterLine(ticket, input.surface);
  const description = excerpt(ticket.description);
  const intro = c.intro(siteConfig.name, input.filedAt);

  const facts: Array<readonly [string, string]> = [
    [c.machine, tool || c.noMachine],
    [c.unit, unit],
    [c.priority, priority],
    [c.reportedBy, reporter],
  ];

  const text = [
    intro,
    "",
    `${title}`,
    "",
    ...facts.filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`),
    ...(description ? ["", `"${description}"`] : []),
    "",
    `${c.open}: ${input.ticketUrl}`,
    "",
    "--",
    c.why,
    ...(input.unsubscribeUrl ? [`${c.unsubscribe}: ${input.unsubscribeUrl}`] : []),
    "",
  ].join("\n");

  const bodyHtml = [
    `<p style="margin:0 0 12px;">${escapeHtml(intro)}</p>`,
    `<p style="margin:0 0 12px;font-size:17px;font-weight:600;">${escapeHtml(title)}</p>`,
    factsHtml(facts),
    description
      ? `<blockquote style="margin:0 0 16px;padding:8px 12px;border-left:3px solid #dddddd;color:#333333;">${escapeHtml(description)}</blockquote>`
      : "",
    buttonHtml(input.ticketUrl, c.open),
  ].join("\n");

  return {
    subject: subjectLine(c.subject(tool, title, priority)),
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

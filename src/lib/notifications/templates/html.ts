import { siteConfig } from "../../site-config.ts";

/**
 * The pieces every email shares (email notifications spec §6, §8 "Untrusted
 * input"). Pure.
 *
 * Ticket titles and descriptions come from a student through a model, so:
 * every piece of user text is escaped before it reaches HTML, capped, and
 * never placed in a URL or a header; the subject line loses its newlines and
 * is capped at 120 characters (header injection).
 *
 * The HTML part is the text part in plain semantic markup: one heading, a
 * short list, one link per action, system fonts, no tracking. The one image
 * is the lab's official logo (`siteConfig.logoPng`, amendment 2026-10-07) on
 * a white band, so the black mark stays readable in a dark-mode client.
 */

export const SUBJECT_MAX = 120;
export const TITLE_MAX = 120;
export const EXCERPT_MAX = 280;

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/** `&`, `<`, `>`, `"` and `'` as entities. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** One line, at most `max` characters, with an ellipsis when cut. */
export function oneLine(value: string, max: number): string {
  // \s covers CR, LF, tab and the Unicode line and paragraph separators.
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** A subject line: no newline can reach the header, and it is capped. */
export function subjectLine(value: string): string {
  return oneLine(value, SUBJECT_MAX);
}

/** The start of a description, line breaks kept as spaces, at most {@link EXCERPT_MAX} characters. */
export function excerpt(value: string, max = EXCERPT_MAX): string {
  return oneLine(value, max);
}

export interface LayoutInput {
  /** The site's origin, for the logo and every link. */
  origin: string;
  /** Plain text: escaped here. */
  heading: string;
  /** Already-escaped HTML for the body, built by the template. */
  bodyHtml: string;
  /** Plain text: the line that says why this person got the email. */
  why: string;
  /** The page that turns this email off, or null when it cannot be signed. */
  unsubscribeUrl: string | null;
  unsubscribeLabel: string;
}

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** The HTML document: logo band, heading, body, footer. */
export function layout(input: LayoutInput): string {
  const logo = `${input.origin}${siteConfig.logoPng}`;
  const alt = `${siteConfig.institution} ${siteConfig.name}`;
  const unsubscribe = input.unsubscribeUrl
    ? ` <a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#555555;">${escapeHtml(input.unsubscribeLabel)}</a>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(input.heading)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f4;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border:1px solid #dddddd;">
<tr><td bgcolor="#ffffff" style="background:#ffffff;padding:20px 24px;border-bottom:3px solid #111111;">
<img src="${escapeHtml(logo)}" width="200" height="55" alt="${escapeHtml(alt)}" style="display:block;border:0;width:200px;height:auto;max-width:100%;">
</td></tr>
<tr><td style="padding:24px;font-family:${FONT};font-size:15px;line-height:1.5;color:#111111;">
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;font-weight:600;">${escapeHtml(input.heading)}</h1>
${input.bodyHtml}
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #dddddd;font-family:${FONT};font-size:12px;line-height:1.5;color:#555555;">
${escapeHtml(input.why)}${unsubscribe}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** A definition list as a two-column table: label, then escaped value. */
export function factsHtml(rows: ReadonlyArray<readonly [label: string, value: string]>): string {
  const cells = rows
    .filter(([, value]) => value)
    .map(
      ([label, value]) =>
        `<tr><th scope="row" align="left" style="padding:2px 16px 2px 0;font-weight:600;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</th><td style="padding:2px 0;">${escapeHtml(value)}</td></tr>`
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;font-size:15px;">${cells}</table>`;
}

/** One action link, styled as a plain button that survives Outlook. */
export function buttonHtml(href: string, label: string): string {
  return `<p style="margin:16px 0 0;"><a href="${escapeHtml(href)}" style="display:inline-block;padding:10px 16px;background:#111111;color:#ffffff;text-decoration:none;font-weight:600;">${escapeHtml(label)}</a></p>`;
}

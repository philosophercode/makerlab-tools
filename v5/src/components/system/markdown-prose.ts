/**
 * How Markdown is drawn (UI system phase 5a; DESIGN.md §8.16): the page's
 * tokens applied to whatever elements a renderer produces — headings in the
 * display face, mono h3/h4, accent-ink links, hairline tables, a quiet code
 * plate. Shared by `system/Markdown` (react-markdown, on pages) and the chat's
 * `MessageResponse` (streamdown), so a list or a table looks the same in both.
 * Its own module so the chat does not pull react-markdown into its bundle.
 */
export const MARKDOWN_PROSE = [
  "flex min-w-0 flex-col gap-3 leading-normal break-words",
  "[&_h1]:font-heading [&_h1]:text-xl [&_h1]:font-medium [&_h1]:uppercase",
  "[&_h2]:font-heading [&_h2]:text-lg [&_h2]:font-medium [&_h2]:uppercase",
  "[&_h3]:font-mono [&_h3]:text-label [&_h3]:tracking-[0.08em] [&_h3]:uppercase",
  "[&_h4]:font-mono [&_h4]:text-label [&_h4]:tracking-[0.08em] [&_h4]:uppercase",
  "[&_ul]:list-disc [&_ul]:ps-5 [&_ol]:list-decimal [&_ol]:ps-5 [&_li]:my-0.5",
  "[&_strong]:font-semibold [&_em]:italic",
  "[&_a]:text-primary-ink [&_a]:underline [&_a]:underline-offset-4",
  "[&_code]:border [&_code]:border-border [&_code]:bg-card [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.9em]",
  "[&_pre]:overflow-x-auto [&_pre]:border [&_pre]:border-border [&_pre]:bg-card [&_pre]:p-3 [&_pre_code]:border-0 [&_pre_code]:p-0",
  "[&_blockquote]:border-s-2 [&_blockquote]:border-s-border [&_blockquote]:ps-3 [&_blockquote]:text-muted-foreground",
  "[&_hr]:border-t [&_hr]:border-border",
  "[&_table]:w-full [&_table]:border-collapse [&_table]:text-table",
  "[&_th]:border-b [&_th]:border-rule [&_th]:py-1.5 [&_th]:text-start [&_th]:font-mono [&_th]:text-micro [&_th]:uppercase",
  "[&_td]:border-b [&_td]:border-rule [&_td]:py-1.5",
].join(" ");

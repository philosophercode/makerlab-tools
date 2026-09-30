import type { Components } from "streamdown";

/**
 * The elements `MessageResponse` hands to streamdown (UI system phase 5b).
 *
 * streamdown draws each Markdown element with its own Tailwind classes —
 * rounded tables in a toolbar frame, a three-box code block, `**bold**` as a
 * `<span>` — written for a Tailwind build that scans its package. Ours scans
 * `src/` only, so a few of those classes happened to exist here and most did
 * not, and the result was neither streamdown's look nor ours. These plain
 * elements keep streamdown's parsing (streaming-safe, GFM, sanitised) and let
 * the page's Markdown rules (`MARKDOWN_PROSE`, DESIGN.md §8.16) draw them, so
 * an answer's list, table or code looks like a tool page's. Links are the
 * caller's (`ChatResponse`).
 */
export const MESSAGE_MARKDOWN: Components = {
  h1: ({ children }) => <h1>{children}</h1>,
  h2: ({ children }) => <h2>{children}</h2>,
  h3: ({ children }) => <h3>{children}</h3>,
  h4: ({ children }) => <h4>{children}</h4>,
  h5: ({ children }) => <h5>{children}</h5>,
  h6: ({ children }) => <h6>{children}</h6>,
  strong: ({ children }) => <strong>{children}</strong>,
  ul: ({ children }) => <ul>{children}</ul>,
  ol: ({ children, start }) => <ol start={start}>{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  blockquote: ({ children }) => <blockquote>{children}</blockquote>,
  hr: () => <hr />,
  // A wide table scrolls inside the answer, never the sheet.
  table: ({ children }) => (
    <div className="max-w-full overflow-x-auto">
      <table>{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead>{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr>{children}</tr>,
  th: ({ children }) => <th>{children}</th>,
  td: ({ children }) => <td>{children}</td>,
  pre: ({ children }) => <pre>{children}</pre>,
  code: ({ children, className }) => <code className={className}>{children}</code>,
};

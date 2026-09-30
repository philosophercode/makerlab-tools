"use client";

/**
 * AI Elements `Conversation`, copied from registry.ai-sdk.dev/conversation.json
 * (UI system spec §9; phase 5b). `use-stick-to-bottom` keeps the newest turn
 * in view while a reply streams and lets the reader scroll back without being
 * pulled down; `role="log"` makes the list a polite live region, so a screen
 * reader hears each reply as it lands.
 *
 * Local edits: the scroll button is square and quiet (DESIGN.md §5), takes a
 * translated `label` (it was icon-only with no name), and sits at the
 * inline end so it never covers a centred card's action; the empty state has
 * no English defaults (Article 6).
 */

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowDownIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { useCallback } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";

export type ConversationProps = ComponentProps<typeof StickToBottom>;

export const Conversation = ({ className, ...props }: ConversationProps) => (
  <StickToBottom
    className={cn("relative min-h-0 flex-1 overflow-y-hidden", className)}
    initial="smooth"
    resize="smooth"
    role="log"
    {...props}
  />
);

export type ConversationContentProps = ComponentProps<typeof StickToBottom.Content>;

export const ConversationContent = ({ className, ...props }: ConversationContentProps) => (
  <StickToBottom.Content className={cn("flex flex-col gap-6 p-4", className)} {...props} />
);

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
};

export const ConversationEmptyState = ({
  className,
  title,
  description,
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => (
  <div className={cn("flex flex-col gap-3", className)} {...props}>
    {children ?? (
      <>
        {icon ? <div className="text-muted-foreground">{icon}</div> : null}
        {title ? <p className="text-sm font-medium">{title}</p> : null}
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </>
    )}
  </div>
);

export type ConversationScrollButtonProps = ComponentProps<typeof Button> & {
  /** The button's accessible name, translated. */
  label: string;
};

export const ConversationScrollButton = ({ className, label, ...props }: ConversationScrollButtonProps) => {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  const handleScrollToBottom = useCallback(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  return (
    !isAtBottom && (
      <Button
        aria-label={label}
        title={label}
        className={cn("absolute end-4 bottom-4 bg-card", className)}
        onClick={handleScrollToBottom}
        size="icon"
        type="button"
        variant="quiet"
        {...props}
      >
        <ArrowDownIcon aria-hidden="true" className="size-4" />
      </Button>
    )
  );
};

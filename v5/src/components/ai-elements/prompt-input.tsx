"use client";

/**
 * AI Elements `PromptInput`, copied from registry.ai-sdk.dev/prompt-input.json
 * (UI system spec §9.1; phase 5b) and cut to the composer's frame: the form,
 * a header row (the attachments), the growing textarea, and a footer of tool
 * buttons and the submit.
 *
 * Left out, with what they would have added: upstream's own attachment store
 * and drop zone (`nanoid`; the chat uploads each file to `/api/uploads` the
 * moment it is picked, so the attachments live with the chat, not the
 * form), the action menu, model select, tabs, command and hover-card
 * previews (`dropdown-menu`, `select`, `command`, `hover-card`), and the
 * speech button (it hard-codes `en-US` and keeps final results only; the
 * chat's dictation follows the page's locale and shows interim words).
 * `input-group` is not added either: the frame is drawn here.
 *
 * Local edits: square, a control-boundary (`--outline-strong`) frame whose
 * focus ring is the frame's (`focus-within`), the textarea borderless inside
 * it; the submit is the surface's one filled button and shows a spinner while
 * a turn runs; every label is the caller's (translated).
 */

import type { ChatStatus } from "ai";
import type { ComponentProps, HTMLAttributes, KeyboardEventHandler } from "react";
import { useState } from "react";
import { ArrowUpIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Loader } from "./loader";

export type PromptInputProps = ComponentProps<"form">;

export const PromptInput = ({ className, children, ...props }: PromptInputProps) => (
  <form
    data-slot="prompt-input"
    className={cn(
      "flex w-full flex-col border border-input bg-card transition-colors duration-150",
      "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring focus-within:outline-solid",
      "has-[textarea:disabled]:opacity-80",
      className
    )}
    {...props}
  >
    {children}
  </form>
);

export type PromptInputHeaderProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputHeader = ({ className, ...props }: PromptInputHeaderProps) => (
  <div data-slot="prompt-input-header" className={cn("flex flex-wrap items-center gap-2 px-2 pt-2", className)} {...props} />
);

export type PromptInputBodyProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputBody = ({ className, ...props }: PromptInputBodyProps) => (
  <div data-slot="prompt-input-body" className={cn("contents", className)} {...props} />
);

export type PromptInputTextareaProps = ComponentProps<"textarea">;

/**
 * Enter sends and Shift+Enter starts a new line; an Enter that ends an IME
 * composition (Japanese, Chinese, Korean input) never sends. It will not send
 * while the form's submit button is disabled.
 */
export const PromptInputTextarea = ({ className, onKeyDown, ...props }: PromptInputTextareaProps) => {
  const [isComposing, setIsComposing] = useState(false);

  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (event) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.key !== "Enter") return;
    if (isComposing || event.nativeEvent.isComposing || event.shiftKey) return;
    event.preventDefault();
    const form = event.currentTarget.form;
    const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit?.disabled) return;
    form?.requestSubmit();
  };

  return (
    <textarea
      data-slot="prompt-input-textarea"
      name="message"
      rows={1}
      className={cn(
        "field-sizing-content max-h-40 min-h-10 w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-sm leading-normal text-foreground outline-hidden",
        "placeholder:text-muted-foreground disabled:cursor-not-allowed",
        // The frame draws the focus ring; the field inside it does not repeat it.
        "focus-visible:outline-hidden",
        className
      )}
      onCompositionEnd={() => setIsComposing(false)}
      onCompositionStart={() => setIsComposing(true)}
      onKeyDown={handleKeyDown}
      {...props}
    />
  );
};

export type PromptInputFooterProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputFooter = ({ className, ...props }: PromptInputFooterProps) => (
  <div data-slot="prompt-input-footer" className={cn("flex items-center justify-between gap-1 p-1.5", className)} {...props} />
);

export type PromptInputToolsProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputTools = ({ className, ...props }: PromptInputToolsProps) => (
  <div className={cn("flex items-center gap-1", className)} {...props} />
);

export type PromptInputButtonProps = ComponentProps<typeof Button>;

/** A tool in the footer (attach, dictate): a square ghost icon button; it needs an `aria-label`. */
export const PromptInputButton = ({ variant = "ghost", size = "icon", className, ...props }: PromptInputButtonProps) => (
  <Button className={cn("[&_svg:not([class*='size-'])]:size-4", className)} size={size} type="button" variant={variant} {...props} />
);

export type PromptInputSubmitProps = ComponentProps<typeof Button> & {
  status?: ChatStatus;
};

/** Send: the composer's one filled button. A spinner replaces the arrow while a turn is on its way. */
export const PromptInputSubmit = ({ className, variant = "default", size = "icon", status, children, ...props }: PromptInputSubmitProps) => {
  const busy = status === "submitted" || status === "streaming";
  return (
    <Button className={cn(className)} size={size} type="submit" variant={variant} {...props}>
      {children ?? (busy ? <Loader size={14} /> : <ArrowUpIcon aria-hidden="true" className="size-4" />)}
    </Button>
  );
};

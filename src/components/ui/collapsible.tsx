"use client";

import * as React from "react";
import { Collapsible as CollapsiblePrimitive } from "radix-ui";

/**
 * shadcn/ui Collapsible (Radix): a trigger that shows and hides one region,
 * with `aria-expanded` / `aria-controls` wired. Unstyled — the caller draws
 * the trigger. First users: the chat's `Sources` list and `Tool` line (UI
 * system phase 5b).
 */

function Collapsible(props: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

function CollapsibleTrigger(props: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger>) {
  return <CollapsiblePrimitive.CollapsibleTrigger data-slot="collapsible-trigger" {...props} />;
}

function CollapsibleContent(props: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent>) {
  return <CollapsiblePrimitive.CollapsibleContent data-slot="collapsible-content" {...props} />;
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent };

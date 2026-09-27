"use client";

import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A tool's product image, contained on its plate — or, when the file is
 * missing (a tool with no photo yet and no bundled one), the empty plate with
 * the tool's initials in mono instead of the browser's broken-image icon
 * (UI system phase 5a: an empty state is shown honestly, never as breakage).
 * Decorative: the tool's name is always beside it.
 */
export function ToolImage({ src, name, sizes, className }: { src: string; name: string; sizes: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span aria-hidden="true" className={cn("relative block overflow-hidden bg-muted", className)}>
      {failed || !src ? (
        <span data-slot="tool-image-empty" className="flex h-full w-full items-center justify-center font-mono text-label text-muted-foreground uppercase">
          {initials(name)}
        </span>
      ) : (
        <Image src={src} alt="" fill sizes={sizes} style={{ objectFit: "contain" }} unoptimized onError={() => setFailed(true)} />
      )}
    </span>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("");
}

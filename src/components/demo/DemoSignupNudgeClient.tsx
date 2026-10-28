"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MailIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isSignedIn } from "../../lib/auth/sign-in-client";
import { useSharedIdentity } from "../../lib/auth/identity-store";
import { isKioskPath } from "../kiosk-path";
import { FROSTED } from "../system/frosted";
import { settleSignupNudge, useSignupNudge } from "./signup-nudge-store";

/** Pages that never draw the notice: the sign-up itself, and the staff and screen surfaces. */
function hiddenOn(pathname: string): boolean {
  if (isKioskPath(pathname)) return true;
  return ["/interest", "/admin", "/account", "/oauth"].some((root) => pathname === root || pathname.startsWith(`${root}/`));
}

/**
 * The sign-up notice (demo pass spec, amendment 2026-10-11): after a minute on
 * the site, a small plate in the bottom corner opposite the chat button asks
 * "Interested in bringing MakerLAB AI to your makerspace?" with **Sign up**
 * and a dismiss button. Dismissing it, following it or signing up hides it for
 * good in this browser (`signup-nudge-store`).
 *
 * Like the assistant's own first-visit callout, it is not a dialog: it takes
 * no focus and traps nothing. It is announced politely through a live region
 * that is always in the page, and it steps aside while a dialog is open or
 * while that callout is showing (both sit low on a phone). Never shown to a
 * signed-in member, on `/interest`, the admin, account and OAuth pages, or the kiosk.
 */
export function DemoSignupNudgeClient({ label, text, cta, dismiss }: { label: string; text: string; cta: string; dismiss: string }) {
  const pathname = usePathname() || "/";
  const identity = useSharedIdentity();
  const { visible, dismiss: onDismiss } = useSignupNudge(!hiddenOn(pathname) && !isSignedIn(identity));

  return (
    <div aria-live="polite" data-slot="signup-nudge-region">
      {visible ? (
        <aside
          aria-label={label}
          data-slot="signup-nudge"
          className={cn(
            FROSTED,
            // Bottom start corner; on a phone it stops short of the chat button.
            "ui fixed start-4 bottom-4 z-40 flex w-[min(20rem,calc(100vw-5.5rem))] flex-col gap-3 p-3 sm:start-6 sm:bottom-6",
            "[body:has([role=dialog][data-state=open])_&]:hidden [body:has([data-slot=assistant-intro])_&]:hidden print:hidden",
            "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-300"
          )}
        >
          <div className="flex items-start gap-2">
            <MailIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary-ink" />
            <p className="m-0 flex-1 font-heading text-sm font-medium">{text}</p>
            <Button variant="ghost" size="icon-sm" className="-me-1.5 -mt-1.5" aria-label={dismiss} title={dismiss} onClick={onDismiss}>
              <XIcon aria-hidden="true" className="size-4" />
            </Button>
          </div>
          <div>
            <Button asChild size="sm" variant="default">
              <Link href="/interest" onClick={() => settleSignupNudge("dismissed")}>
                {cta}
              </Link>
            </Button>
          </div>
        </aside>
      ) : null}
    </div>
  );
}

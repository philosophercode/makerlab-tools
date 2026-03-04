"use client";

import { useState } from "react";

interface MobileToolLayoutProps {
  infoContent: React.ReactNode;
  chatContent: React.ReactNode;
}

export default function MobileToolLayout({
  infoContent,
  chatContent,
}: MobileToolLayoutProps) {
  const [tab, setTab] = useState<"info" | "chat">("info");

  return (
    <>
      {/* Desktop: original two-column grid | Mobile: flex column filling viewport */}
      <div className="flex min-h-0 flex-1 flex-col lg:grid lg:flex-none lg:gap-8 lg:grid-cols-2">
        {/* Info panel */}
        <div
          className={`${
            tab === "info" ? "flex min-h-0 flex-1 flex-col" : "hidden"
          } lg:!block lg:!flex-none`}
        >
          <div className="flex-1 space-y-6 overflow-y-auto pb-14 thin-scrollbar lg:overflow-visible lg:pb-0">
            {infoContent}
          </div>
        </div>

        {/* Chat panel — on mobile, fill remaining height so input pins to bottom */}
        <div
          className={`${
            tab === "chat" ? "flex min-h-0 flex-1 flex-col" : "hidden"
          } lg:!block lg:!flex-none lg:sticky lg:top-24 lg:self-start`}
        >
          <div className="flex min-h-0 flex-1 flex-col pb-14 lg:h-[600px] lg:flex-none lg:rounded-xl lg:border lg:border-card-border lg:bg-card-bg lg:overflow-hidden lg:pb-0">
            {chatContent}
          </div>
        </div>
      </div>

      {/* Mobile tab bar — hidden on desktop */}
      <div className="fixed bottom-0 left-0 right-0 z-50 flex border-t border-card-border bg-card-bg safe-bottom lg:hidden">
        <button
          type="button"
          onClick={() => setTab("info")}
          className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-xs font-medium transition-colors ${
            tab === "info" ? "text-primary" : "text-muted"
          }`}
          aria-label="View tool information"
          aria-pressed={tab === "info"}
        >
          <svg
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          Info
        </button>
        <button
          type="button"
          onClick={() => setTab("chat")}
          className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-xs font-medium transition-colors ${
            tab === "chat" ? "text-primary" : "text-muted"
          }`}
          aria-label="Open chat"
          aria-pressed={tab === "chat"}
        >
          <svg
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
          Chat
        </button>
      </div>
    </>
  );
}

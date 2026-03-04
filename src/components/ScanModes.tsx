"use client";

import { useState } from "react";
import Chat from "@/components/Chat";
import QrScanner from "@/components/QrScanner";

type ScanMode = "qr" | "photo";

export default function ScanModes() {
  const [mode, setMode] = useState<ScanMode>("qr");

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 rounded-lg border border-card-border bg-card-bg p-1">
        <button
          type="button"
          onClick={() => setMode("qr")}
          className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            mode === "qr"
              ? "bg-primary text-white"
              : "text-muted hover:bg-muted-bg hover:text-foreground"
          }`}
          aria-pressed={mode === "qr"}
        >
          QR Code
        </button>
        <button
          type="button"
          onClick={() => setMode("photo")}
          className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            mode === "photo"
              ? "bg-primary text-white"
              : "text-muted hover:bg-muted-bg hover:text-foreground"
          }`}
          aria-pressed={mode === "photo"}
        >
          Photo Identify
        </button>
      </div>

      {mode === "qr" ? (
        <QrScanner />
      ) : (
        <div className="rounded-xl border border-card-border bg-card-bg overflow-hidden">
          <div className="border-b border-card-border px-4 py-3">
            <h2 className="text-sm font-semibold">Identify from Photo (Studio 101)</h2>
            <p className="mt-1 text-xs text-muted">
              Tap the camera icon, upload a photo, and ask what tool it is.
            </p>
          </div>
          <div className="h-[560px]">
            <Chat
              header="Photo ID Assistant"
              suggestions={[
                "What tool is this in Studio 101?",
                "Can you identify this machine?",
                "Is this tool damaged?",
              ]}
            />
          </div>
        </div>
      )}
    </div>
  );
}

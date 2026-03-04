"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function QrScanner() {
  const router = useRouter();
  const scannerRef = useRef<HTMLDivElement>(null);
  const html5QrCodeRef = useRef<import("html5-qrcode").Html5Qrcode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function startScanner() {
      const { Html5Qrcode } = await import("html5-qrcode");

      if (!mounted || !scannerRef.current) return;

      const scanner = new Html5Qrcode("qr-reader");
      html5QrCodeRef.current = scanner;

      try {
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decodedText) => {
            // Check if it's a valid unit QR URL
            try {
              const url = new URL(decodedText);
              const match = url.pathname.match(/\/units\/qr\/([a-f0-9]+)/);
              if (match) {
                scanner.stop().catch(() => {});
                router.push(`/units/qr/${match[1]}`);
                return;
              }
              // Also handle direct unit URLs
              const directMatch = url.pathname.match(/\/units\/(rec[A-Za-z0-9]+)/);
              if (directMatch) {
                scanner.stop().catch(() => {});
                router.push(`/units/${directMatch[1]}`);
                return;
              }
            } catch {
              // Not a URL — ignore
            }
            setError("QR code is not a valid MakerLab unit code.");
          },
          () => {
            // Scan error (no QR found) — ignore, keep scanning
          }
        );
        if (mounted) setScanning(true);
      } catch (err) {
        if (mounted) {
          setError(
            err instanceof Error
              ? err.message
              : "Could not access camera. Please allow camera permissions."
          );
        }
      }
    }

    startScanner();

    return () => {
      mounted = false;
      html5QrCodeRef.current?.stop().catch(() => {});
    };
  }, [router]);

  return (
    <div className="space-y-4">
      <div
        id="qr-reader"
        ref={scannerRef}
        className="mx-auto max-w-sm overflow-hidden rounded-xl border border-card-border"
      />

      {!scanning && !error && (
        <p className="text-center text-sm text-muted">Starting camera...</p>
      )}

      {scanning && (
        <p className="text-center text-sm text-muted">
          Point your camera at a QR code on any machine
        </p>
      )}

      {error && (
        <div className="rounded-lg border border-danger/20 bg-danger/5 p-3 text-sm text-danger text-center">
          {error}
        </div>
      )}
    </div>
  );
}

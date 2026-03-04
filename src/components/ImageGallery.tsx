"use client";

import Image from "next/image";
import { useState } from "react";
import type { Attachment } from "@/lib/types";

interface ImageGalleryProps {
  images: Attachment[];
  toolName: string;
  localImageUrl?: string;
  generatedImageUrl?: string;
}

export default function ImageGallery({
  images,
  toolName,
  localImageUrl,
  generatedImageUrl,
}: ImageGalleryProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showGenerated, setShowGenerated] = useState(true);

  const safeName = toolName.replace(/\//g, "_");
  const preferredUrl =
    localImageUrl || `/tool-images/${encodeURIComponent(`${safeName}.png`)}`;
  const hasLocalImage = preferredUrl.startsWith("/tool-images/");
  const hasGenerated = !!generatedImageUrl;

  if (images.length === 0 && !preferredUrl) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-xl bg-muted-bg text-muted">
        No image available
      </div>
    );
  }

  const originalUrl = hasLocalImage
    ? preferredUrl
    : (images[selectedIndex]?.thumbnails?.large?.url ??
      images[selectedIndex]?.url ??
      preferredUrl);

  const imageUrl =
    hasGenerated && showGenerated ? generatedImageUrl : originalUrl;

  return (
    <div className="space-y-3">
      {/* Main image */}
      <div className="relative aspect-square overflow-hidden rounded-xl bg-muted-bg">
        <Image
          src={imageUrl}
          alt={`${toolName}${hasGenerated && showGenerated ? " (illustration)" : ""}`}
          fill
          className="object-contain p-4"
          sizes="(max-width: 1024px) 100vw, 50vw"
          priority
        />

        {/* Toggle button — only shown when both image types exist */}
        {hasGenerated && (
          <button
            type="button"
            onClick={() => setShowGenerated((v) => !v)}
            className="absolute top-2 left-2 flex items-center gap-1.5 rounded-lg bg-card-bg/90 border border-card-border px-2.5 py-1.5 text-xs font-medium text-muted hover:text-foreground hover:border-foreground/30 transition-colors backdrop-blur-sm"
            title={showGenerated ? "Show original photo" : "Show illustration"}
          >
            {showGenerated ? (
              <>
                <CameraIcon />
                <span>Photo</span>
              </>
            ) : (
              <>
                <SparklesIcon />
                <span>Illustration</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Thumbnails — only for multi-image originals, hidden when showing generated */}
      {!hasLocalImage && !showGenerated && images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto">
          {images.map((img, i) => {
            const thumbUrl =
              img.thumbnails?.small?.url || img.url || preferredUrl;
            return (
              <button
                key={img.id}
                onClick={() => setSelectedIndex(i)}
                aria-label={`View image ${i + 1} of ${images.length}`}
                aria-current={i === selectedIndex ? "true" : undefined}
                className={`relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg border-2 transition-colors ${
                  i === selectedIndex
                    ? "border-primary"
                    : "border-card-border hover:border-muted"
                }`}
              >
                <Image
                  src={thumbUrl}
                  alt={`${toolName} thumbnail ${i + 1}`}
                  fill
                  className="object-contain p-1"
                  sizes="64px"
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SparklesIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z"
      />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z"
      />
    </svg>
  );
}

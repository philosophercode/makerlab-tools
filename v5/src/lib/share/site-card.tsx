import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { siteConfig } from "../site-config";
import { siteUrl } from "./site-url";

/**
 * The site's link-preview card (`app/opengraph-image.tsx`,
 * `app/twitter-image.tsx`) and its home-screen icon (`app/apple-icon.tsx`).
 *
 * Built once, at `next build`: nothing here reads the request or the
 * database, so Next prerenders the routes and serves the PNGs as static
 * files. Files are read from the project folder, which exists at build time;
 * each read is allowed to fail (a missing wordmark becomes the name set in
 * type, a missing font the renderer's own), so a card is always drawn.
 *
 * Thumbnail-first: a chat app shows this at ~300 px wide, so it is three
 * things at sizes that survive that — the wordmark, the site's name, the
 * tagline — on the site's paper colour with the brand orange as a rule.
 */

export const SITE_CARD_SIZE = { width: 1200, height: 630 } as const;
export const SITE_CARD_ALT = `${siteConfig.name} — ${siteConfig.tagline}`;

const PAPER = "#f7f4ee";
const INK = "#0f0f0f";
const MUTED = "#4a4640";

async function readProjectFile(path: string): Promise<Buffer | null> {
  try {
    return await readFile(join(process.cwd(), path));
  } catch {
    return null;
  }
}

async function cardFonts() {
  const [display, body] = await Promise.all([
    readProjectFile("src/lib/share/fonts/SpaceGrotesk-Bold.ttf"),
    readProjectFile("src/lib/share/fonts/Inter-Regular.ttf"),
  ]);
  const fonts: { name: string; data: Buffer; weight: 400 | 700; style: "normal" }[] = [];
  if (display) fonts.push({ name: "Display", data: display, weight: 700, style: "normal" });
  if (body) fonts.push({ name: "Body", data: body, weight: 400, style: "normal" });
  return fonts;
}

/** The wordmark as a data URL, or null when the file is not there. */
async function wordmarkDataUrl(): Promise<string | null> {
  const path = siteConfig.wordmark.replace(/^\/+/, "");
  if (!path.endsWith(".png")) return null;
  const file = await readProjectFile(join("public", path));
  return file ? `data:image/png;base64,${file.toString("base64")}` : null;
}

export async function renderSiteCard(): Promise<ImageResponse> {
  const [fonts, wordmark] = await Promise.all([cardFonts(), wordmarkDataUrl()]);
  const host = siteUrl().host;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: PAPER,
          color: INK,
          fontFamily: "Body",
        }}
      >
        <div style={{ width: 28, height: "100%", background: siteConfig.colors.primary, display: "flex" }} />
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "84px 96px 72px 88px",
          }}
        >
          {wordmark ? (
            // eslint-disable-next-line @next/next/no-img-element -- drawn by next/og, not a page
            <img src={wordmark} width={475} height={79} alt="" style={{ width: 475, height: 79 }} />
          ) : (
            <div style={{ display: "flex", fontFamily: "Display", fontSize: 72, fontWeight: 700 }}>MakerLAB</div>
          )}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                fontFamily: "Display",
                fontWeight: 700,
                fontSize: 104,
                lineHeight: 1,
                letterSpacing: -2,
              }}
            >
              {siteConfig.name}
            </div>
            <div style={{ display: "flex", marginTop: 28, fontSize: 42, lineHeight: 1.25, color: MUTED }}>
              {siteConfig.tagline}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", fontSize: 28, color: MUTED }}>
            <div style={{ width: 14, height: 14, background: siteConfig.colors.primary, marginRight: 16, display: "flex" }} />
            {host}
          </div>
        </div>
      </div>
    ),
    { ...SITE_CARD_SIZE, fonts: fonts.length ? fonts : undefined }
  );
}

export const APPLE_ICON_SIZE = { width: 180, height: 180 } as const;

/**
 * The home-screen icon: `icon.svg`'s "M" on the brand orange, full-bleed
 * (iOS rounds the corners itself and shows transparency as black).
 */
export function renderAppleIcon(): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: siteConfig.colors.primary,
        }}
      >
        <svg width="132" height="132" viewBox="0 0 32 32">
          <path d="M6 24V8h4l6 8 6-8h4v16h-4V14l-6 8-6-8v10z" fill={INK} />
        </svg>
      </div>
    ),
    APPLE_ICON_SIZE
  );
}

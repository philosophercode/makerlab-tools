/**
 * The product page's facts that are not prose (identity spec amendment
 * 2026-09-28 "Product page and quick start"): the screenshots, the links,
 * the running example and the video. Words live in `messages/*.json` under
 * `product`; this file holds what is not translated.
 *
 * Screenshots were captured on 2026-09-28 at 2× from the live site
 * (makerlab-ai.vercel.app, public pages and real assistant answers) and from
 * a local production build on the demo seed (staff screens, the manual
 * citation, the ticket and the action card — `demo: true`, captioned so).
 * Each is two widths in AVIF and WebP under `public/product/`.
 */

/** The running example: the Bambu Lab X1-Carbon's tool page, with the assistant opened on arrival. */
export const EXAMPLE_TOOL_PATH = "/tools/bambu-lab-x1-carbon-combo-3d-printer";
export const TRY_IT_HREF = `${EXAMPLE_TOOL_PATH}?ask=1`;
export const QUICK_START_HREF = "/product/quick-start";
export const PRODUCT_HREF = "/product";

export interface Shot {
  /** The file stem under `public/product/`: `<name>-<width>.{avif,webp}`. */
  name: string;
  /** Intrinsic size of the larger file. */
  width: number;
  height: number;
  /** From the demo seed (a local build) rather than the live site. */
  demo?: boolean;
}

const desktop = (name: string, demo = false): Shot => ({ name, width: 2560, height: 1600, demo });
const cropped = (name: string, demo = false): Shot => ({ name, width: 2560, height: 1228, demo });
const panel = (name: string): Shot => ({ name, width: 876, height: 1600 });

export const SHOTS = {
  toolPage: desktop("tool-page"),
  toolDetails: desktop("tool-details"),
  toolPageJa: desktop("tool-page-ja"),
  gallery: desktop("gallery"),
  kiosk: desktop("kiosk"),
  projects: desktop("projects"),
  mcp: desktop("mcp"),
  chatOperate: panel("chat-operate"),
  chatDebug: panel("chat-debug"),
  chatCreate: panel("chat-create"),
  chatCitation: desktop("chat-citation", true),
  chatReport: desktop("chat-report", true),
  actionCard: desktop("action-card", true),
  intakeReview: desktop("intake-review", true),
  people: desktop("people", true),
  valueReport: cropped("value-report", true),
  map: cropped("map", true),
} as const satisfies Record<string, Shot>;

export type ShotKey = keyof typeof SHOTS;

/** Both widths of a shot, for `srcset`. */
export function shotSources(shot: Shot, format: "avif" | "webp"): string {
  const half = Math.round(shot.width / 2);
  return `/product/${shot.name}-${half}.${format} ${half}w, /product/${shot.name}-${shot.width}.${format} ${shot.width}w`;
}

/** The fallback `src`: the smaller WebP. */
export function shotSrc(shot: Shot): string {
  return `/product/${shot.name}-${Math.round(shot.width / 2)}.webp`;
}

/** The walkthrough: tool page → ask → cited answer → kiosk, recorded on the live site. */
export const WALKTHROUGH = {
  mp4: "/product/walkthrough.mp4",
  webm: "/product/walkthrough.webm",
  poster: "/product/walkthrough-poster.webp",
  captions: "/product/walkthrough.en.vtt",
  width: 1280,
  height: 800,
} as const;

/** The Open Graph image (1200×630), the tool page's first screen. */
export const OG_IMAGE = { url: "/product/og.png", width: 1200, height: 630 } as const;

/**
 * The page's three example questions, one per pillar, each answered for real
 * on the live X1-Carbon page for its screenshot (2026-09-28).
 */
export const PILLARS = [
  { key: "operate", shot: "chatOperate" },
  { key: "debug", shot: "chatDebug" },
  { key: "create", shot: "chatCreate" },
] as const satisfies readonly { key: string; shot: ShotKey }[];

/** The feature sections, in page order: `product.features.<key>.*` in the messages. */
export const FEATURES = [
  { key: "toolPages", shot: "toolDetails" },
  { key: "citations", shot: "chatCitation" },
  { key: "intake", shot: "intakeReview" },
  { key: "tickets", shot: "chatReport" },
  { key: "kiosk", shot: "kiosk" },
  { key: "projects", shot: "projects" },
  { key: "insights", shot: "valueReport" },
  { key: "actions", shot: "actionCard" },
  { key: "mcp", shot: "mcp" },
  { key: "languages", shot: "toolPageJa" },
  { key: "map", shot: "map" },
] as const satisfies readonly { key: string; shot: ShotKey }[];

/**
 * What it costs to run (pricing memo 2026-09-28, §1 and §3): measured model
 * costs per unit of work and a dated monthly estimate. Costs to run only —
 * never a subscription price. `product.costs.rows.<key>` holds the words.
 */
export const COST_ROWS = [
  { key: "chat", value: "≈ $0.0003" },
  { key: "chatRerank", value: "≈ $0.002" },
  { key: "research", value: "$0.02–0.05" },
  { key: "manualIndex", value: "< $0.001" },
  { key: "ocr", value: "≤ $1" },
] as const;

export const COST_MONTHLY = [
  { key: "ai", value: "≈ $10–15" },
  { key: "hosting", value: "≈ $20–40" },
] as const;

/** The quick start, in order: `product.quickStart.steps.<key>.*`; `staff` steps need a Cornell sign-in and a staff role. */
export const QUICK_START_STEPS = [
  { key: "open", shot: "gallery", staff: false },
  { key: "ask", shot: "chatOperate", staff: false },
  { key: "cite", shot: "chatCitation", staff: false },
  { key: "report", shot: "chatReport", staff: false },
  { key: "intake", shot: "intakeReview", staff: true },
  { key: "people", shot: "people", staff: true },
  { key: "kiosk", shot: "kiosk", staff: true },
  { key: "mcp", shot: "mcp", staff: false },
] as const satisfies readonly { key: string; shot: ShotKey; staff: boolean }[];

/** "Things to try": `product.quickStart.try.<key>`, each a link. */
export const THINGS_TO_TRY = [
  { key: "firstPrint", href: TRY_IT_HREF },
  { key: "cutAcrylic", href: "/?ask=1" },
  { key: "language", href: EXAMPLE_TOOL_PATH },
  { key: "kiosk", href: "/kiosk" },
  { key: "projects", href: "/projects" },
  { key: "mcp", href: "/mcp" },
  { key: "palette", href: "/" },
] as const;

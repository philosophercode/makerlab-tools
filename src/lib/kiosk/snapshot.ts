import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import { KIOSK_CACHE } from "../cache";
import { BUNDLED_TOOL_IMAGES } from "../data/bundled-tool-images";
import { listCatalogTools } from "../data/catalog";
import { listUnitStatusCounts } from "../data/kiosk";
import { countOpenTickets } from "../data/maintenance";
import { listPublishedProjects } from "../data/projects";
import { dataSubstrate, getDb } from "../db/client";
import type { Db } from "../db/types";
import { labToday } from "../lab-time";
import { CATALOG_TAG, MAINTENANCE_TAG, PROJECTS_TAG } from "../revalidate";
import { siteConfig } from "../site-config";
import type { MakerLabProject, MakerLabTool } from "../../components/catalog-types";
import { downMachines, featuredOrder, shortAuthorName } from "./derive";
import { kioskAskUrl } from "./params";
import type { KioskFeatured, KioskSnapshot, KioskTicketCounts } from "./types";

/**
 * The kiosk's one loader (kiosk spec §3.1, §4.1).
 *
 * `assembleKioskSnapshot` reads — the published catalogue, a grouped count of
 * unit statuses, the open-ticket counts `/admin` shows, and the published
 * projects — and builds the public payload. `loadKioskSnapshot` is the same
 * thing cached under the three tags whose writes change it, so a screen
 * polling every minute costs a cache read, not a query.
 *
 * **Failure is not zero** (Article 4). The ticket count fails on its own to
 * `null` ("Not available" on screen); anything else throws, and the caller —
 * the page or `/api/kiosk` — says the status is unavailable. Nothing here ever
 * returns a zero it did not read.
 *
 * **Privacy.** Every field is chosen, never spread from a row: no email, no
 * ticket text, no draft, no full name. A project's author becomes "Maya R."
 * here, on the server (owner answer Q3).
 */

/**
 * The snapshot as cached: everything but the QR target, which depends on the
 * request's origin, and who is on shift, which depends on the clock.
 */
export type KioskSnapshotData = Omit<KioskSnapshot, "askUrl" | "onShift">;

const DESCRIPTION_MAX = 180;

export async function assembleKioskSnapshot(
  options: { db?: Db; now?: Date } = {}
): Promise<KioskSnapshotData> {
  const db = options.db ?? (await getDb());
  const now = options.now ?? new Date();

  const [tools, statusCounts, projects, tickets] = await Promise.all([
    listCatalogTools({ db }),
    listUnitStatusCounts(db),
    listPublishedProjects({ db }),
    readTicketCounts(db),
  ]);

  const { down, unitsInService } = downMachines(tools, statusCounts);

  return {
    generatedAt: now.toISOString(),
    demo: dataSubstrate() === "pglite-demo",
    lab: { hoursText: siteConfig.labHours, openNow: null, closesAt: null },
    unitsInService,
    down,
    tickets,
    featured: featuredOrder(
      tools.filter((tool) => isProductImage(tool.imageSrc)).map(featuredTool),
      projects.map(featuredProject),
      labToday(now)
    ),
  };
}

/** Cached under every tag whose writes change what the screen shows. */
export async function loadKioskSnapshot(): Promise<KioskSnapshotData> {
  "use cache";
  cacheTag(CATALOG_TAG, PROJECTS_TAG, MAINTENANCE_TAG);
  cacheLife(KIOSK_CACHE);

  return assembleKioskSnapshot();
}

/**
 * The cached snapshot with the QR target for `origin` and who is on shift now
 * (on-shift spec 2026-10-07; empty when nobody is or the roster could not be
 * read).
 */
export function withAskUrl(snapshot: KioskSnapshotData, origin: string, onShift: string[] = []): KioskSnapshot {
  return { ...snapshot, askUrl: kioskAskUrl(origin), onShift };
}

async function readTicketCounts(db: Db): Promise<KioskTicketCounts | null> {
  try {
    const { open, inProgress } = await countOpenTickets(db);
    return { open, inProgress };
  } catch (err) {
    console.error("[kiosk] could not read the open-ticket count", err);
    return null;
  }
}

/**
 * A real product photo: one in Blob (or the local store in dev), or one of the
 * bundled photos. `toolImageSrc` falls back to a bundled path named after the
 * tool whether or not the file exists, and a featured panel showing a tool's
 * initials is not featuring anything.
 */
export function isProductImage(src: string): boolean {
  if (/^https?:\/\//i.test(src) || src.startsWith("/api/dev-blob/")) return true;
  const bundled = src.match(/^\/tool-images\/(.+)\.png$/);
  if (!bundled) return false;
  try {
    return BUNDLED_TOOL_IMAGES.has(decodeURIComponent(bundled[1]));
  } catch {
    return false;
  }
}

function featuredTool(tool: MakerLabTool): KioskFeatured {
  return {
    kind: "tool",
    slug: tool.slug,
    name: tool.name,
    shortDescription: clamp(tool.shortDescription, DESCRIPTION_MAX),
    imageSrc: tool.imageSrc,
  };
}

function featuredProject(project: MakerLabProject): KioskFeatured {
  return {
    kind: "project",
    slug: project.slug,
    title: project.title,
    coverSrc: project.photos[0] ?? "",
    toolNames: project.tools.map((tool) => tool.name),
    // The data layer says "Anonymous" for a project with no byline; the
    // screen says nothing rather than name nobody.
    author: project.author === "Anonymous" ? null : shortAuthorName(project.author),
  };
}

function clamp(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s.,;:–—-]+$/, "")}…`;
}

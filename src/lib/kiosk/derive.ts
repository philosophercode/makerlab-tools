import type { DownState, KioskDownMachine, KioskFeatured } from "./types";

/**
 * The kiosk's pure decisions (kiosk spec §3.1, §5): which machines read as
 * down, how an author's name is shortened, the day's featured order, and the
 * screen's timing — staleness, back-off, burn-in shift, rotation, the nightly
 * reload. No I/O and no clock of its own: every function takes `now`, so the
 * tests pin the boundaries and the client and server agree.
 */

// ── Down machines ───────────────────────────────────────────────────

/** A tool as the down-machine panel needs it. */
export interface DownCandidate {
  id: string;
  slug: string;
  name: string;
  imageSrc: string;
}

/** How many of a tool's units hold one stored status (`units.status`). */
export interface UnitStatusCount {
  toolId: string;
  status: string;
  count: number;
}

const DOWN_STATUSES = new Set(["under_maintenance", "out_of_service"]);

/**
 * The tools with at least one unit under maintenance or out of service, most
 * units down first. Retired units count toward neither side ("1 of 2 down"
 * means two units still in service); `in_use` is working, not down. Also
 * returns every unit in service, for "All 42 machines running".
 */
export function downMachines(
  tools: readonly DownCandidate[],
  counts: readonly UnitStatusCount[]
): { down: KioskDownMachine[]; unitsInService: number } {
  const byTool = new Map<string, Map<string, number>>();
  for (const row of counts) {
    const statuses = byTool.get(row.toolId) ?? new Map<string, number>();
    statuses.set(row.status, (statuses.get(row.status) ?? 0) + Number(row.count));
    byTool.set(row.toolId, statuses);
  }

  let unitsInService = 0;
  const down: KioskDownMachine[] = [];
  for (const tool of tools) {
    const statuses = byTool.get(tool.id);
    if (!statuses) continue;
    let total = 0;
    let maintenance = 0;
    let outOfService = 0;
    for (const [status, n] of statuses) {
      if (status === "retired") continue;
      total += n;
      if (status === "under_maintenance") maintenance += n;
      if (status === "out_of_service") outOfService += n;
    }
    unitsInService += total;
    const unitsDown = maintenance + outOfService;
    if (unitsDown === 0) continue;
    const state: DownState = maintenance && outOfService ? "mixed" : maintenance ? "under_maintenance" : "out_of_service";
    down.push({ toolSlug: tool.slug, toolName: tool.name, imageSrc: tool.imageSrc, unitsDown, unitsTotal: total, state });
  }
  down.sort((a, b) => b.unitsDown - a.unitsDown || a.toolName.localeCompare(b.toolName));
  return { down, unitsInService };
}

/** Whether a stored unit status reads as down on the kiosk. */
export function isDownStatus(status: string): boolean {
  return DOWN_STATUSES.has(status);
}

// ── Names ───────────────────────────────────────────────────────────

const FIRST_NAME_MAX = 24;

/**
 * "Maya Rodriguez" → "Maya R." (owner answer Q3, 2026-09-27). The screen is
 * public and the booth's audience is wider than the gallery's, so a full name
 * never leaves the server: one word stays as it is, more words become the
 * first plus the last word's initial, and anything that looks like an address
 * — or holds no letter at all — is dropped rather than shortened.
 */
export function shortAuthorName(name: string | null | undefined): string | null {
  const words = (name ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length === 0 || words.some((word) => word.includes("@"))) return null;
  const first = Array.from(words[0]).slice(0, FIRST_NAME_MAX).join("");
  if (!/\p{L}/u.test(first)) return null;
  if (words.length === 1) return first;
  const initial = words[words.length - 1].match(/\p{L}/u)?.[0];
  return initial ? `${first} ${initial.toLocaleUpperCase()}.` : first;
}

// ── Featured rotation ───────────────────────────────────────────────

export const FEATURED_LIMIT = 12;
/** Projects are few and tools are many; this keeps the student work on screen. */
export const FEATURED_PROJECT_SHARE = 4;

/** A 32-bit FNV-1a hash, the shuffle's seed. */
function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: small, fast, and the same on every machine for the same seed. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A Fisher–Yates shuffle seeded by `seed`; the input is not changed. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const out = [...items];
  const random = seededRandom(hashSeed(seed));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The day's featured items: up to {@link FEATURED_PROJECT_SHARE} projects and
 * tools to fill {@link FEATURED_LIMIT}, shuffled by the **lab's** date
 * (`labToday()`), so every screen shows the same order all day and a new one
 * tomorrow. Items arrive in a stable order (by slug) before the shuffle, so
 * the order does not depend on how the database happened to return them.
 */
export function featuredOrder(
  tools: readonly KioskFeatured[],
  projects: readonly KioskFeatured[],
  labDay: string
): KioskFeatured[] {
  const bySlug = (a: KioskFeatured, b: KioskFeatured) => a.slug.localeCompare(b.slug);
  const pickedProjects = seededShuffle([...projects].sort(bySlug), `projects:${labDay}`).slice(0, FEATURED_PROJECT_SHARE);
  const pickedTools = seededShuffle([...tools].sort(bySlug), `tools:${labDay}`).slice(
    0,
    FEATURED_LIMIT - pickedProjects.length
  );
  return seededShuffle([...pickedProjects, ...pickedTools], `featured:${labDay}`);
}

// ── The screen's clock ──────────────────────────────────────────────

/** A poll every minute, plus up to 10 s so ten screens do not poll in step (§5.2). */
export const POLL_MS = 60_000;
export const POLL_JITTER_MS = 10_000;
/** After a failure: one minute, then two, then five at most (§5.2). */
export const BACKOFF_MS = [60_000, 120_000, 300_000] as const;
/** Three minutes without a good answer is stale (§5.3). */
export const STALE_AFTER_MS = 3 * 60_000;
/** One featured item for 20 s at a time (§5.2). */
export const ROTATE_MS = 20_000;
/** The layout moves every five minutes (§5.5). */
export const SHIFT_EVERY_MS = 5 * 60_000;
/** The nightly reload, in lab time (§5.2). */
export const RELOAD_HOUR = 4;

export type Staleness = "fresh" | "stale" | "offline";

/**
 * How much to trust what is on screen. `lastOkAt` is when the screen last got
 * a good answer — not the snapshot's own `generatedAt`, which a cached read
 * keeps for minutes after the fact while still being current, because every
 * write invalidates it.
 */
export function staleness(lastOkAt: number, now: number, online: boolean): Staleness {
  if (!online) return "offline";
  return now - lastOkAt >= STALE_AFTER_MS ? "stale" : "fresh";
}

/** How long to wait before the next poll, given how many in a row have failed. */
export function nextPollDelay(failures: number, random: number = Math.random()): number {
  if (failures <= 0) return POLL_MS + Math.floor(Math.max(0, Math.min(1, random)) * POLL_JITTER_MS);
  return BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1];
}

/**
 * The burn-in shift (§5.5): a fixed cycle of offsets, none more than 8 px from
 * centre, advanced every five minutes. Same time, same offset on every screen.
 */
export const SHIFT_OFFSETS: readonly (readonly [number, number])[] = [
  [0, 0],
  [6, -4],
  [-5, 7],
  [8, 5],
  [-7, -6],
  [3, 8],
  [-8, 2],
  [5, -8],
];

export function burnInOffset(now: number): readonly [number, number] {
  return SHIFT_OFFSETS[Math.floor(now / SHIFT_EVERY_MS) % SHIFT_OFFSETS.length];
}

/** Which featured item shows at `now` — from the clock, so a refresh keeps its place. */
export function rotationIndex(now: number, count: number): number {
  if (count <= 0) return 0;
  return Math.floor(now / ROTATE_MS) % count;
}

/**
 * Milliseconds from `now` until the next `hour`:00 on the wall clock of
 * `timeZone`. A timezone `Intl` does not know is read as UTC, like `labToday`.
 * Across a daylight-saving change the answer may be an hour off, once a year,
 * for a reload nobody is awake to see.
 */
export function msUntilLabHour(now: number, hour: number, timeZone: string): number {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(now));
  } catch {
    return msUntilLabHour(now, hour, "UTC");
  }
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const elapsed = ((get("hour") * 60 + get("minute")) * 60 + get("second")) * 1000 + (now % 1000);
  const target = hour * 3_600_000;
  const day = 86_400_000;
  const wait = (target - elapsed + day) % day;
  return wait === 0 ? day : wait;
}

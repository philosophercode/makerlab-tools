/**
 * The kiosk's payload (kiosk spec §3.2) — what `/kiosk` renders first and what
 * `GET /api/kiosk` answers every minute after.
 *
 * **Public data only.** No field can carry an email, a ticket's text, a draft
 * or a full name. The one piece of student-written text is a *published*
 * project's title (moderation is the gate), and its author travels only as
 * first name plus last initial, derived on the server (`shortAuthorName`,
 * owner answer Q3, 2026-09-27). `snapshot.test.ts` asserts the serialised
 * payload holds none of the things it must not.
 *
 * Plain types, no imports: the client screen reads them too.
 */

export type DownState = "under_maintenance" | "out_of_service" | "mixed";

export interface KioskDownMachine {
  toolSlug: string;
  toolName: string;
  imageSrc: string;
  /** Units under maintenance or out of service. */
  unitsDown: number;
  /** Every unit that is not retired. */
  unitsTotal: number;
  state: DownState;
}

export interface KioskFeaturedTool {
  kind: "tool";
  slug: string;
  name: string;
  shortDescription: string;
  imageSrc: string;
}

export interface KioskFeaturedProject {
  kind: "project";
  slug: string;
  title: string;
  coverSrc: string;
  toolNames: string[];
  /** "Maya R." — first name and last initial, or null when there is none to show. */
  author: string | null;
}

export type KioskFeatured = KioskFeaturedTool | KioskFeaturedProject;

export interface KioskTicketCounts {
  open: number;
  inProgress: number;
}

export interface KioskSnapshot {
  /** When the loader read the database (ISO). Cached reads keep the time they were read. */
  generatedAt: string;
  /** The catalogue is the built-in demo seed, not the lab's inventory. */
  demo: boolean;
  /** Phase 1 knows the hours only as text; `openNow` and `closesAt` arrive with phase 2. */
  lab: { hoursText: string; openNow: boolean | null; closesAt: string | null };
  /** Units that are not retired, across the published catalogue — "All 42 machines running". */
  unitsInService: number;
  down: KioskDownMachine[];
  /** Null when the count could not be read — never a zero it did not read (Article 4). */
  tickets: KioskTicketCounts | null;
  /** ≤ 12, published only, in the day's rotation order. */
  featured: KioskFeatured[];
  /** What the QR code encodes: the catalogue with the assistant open. */
  askUrl: string;
}

/** What `/api/kiosk` answers: the snapshot plus when this response was served. */
export interface KioskResponse extends KioskSnapshot {
  servedAt: string;
}

import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { tools } from "../db/schema/tools.ts";
import type { Db } from "../db/types.ts";
import { isUuid } from "../data/uuid.ts";
import type { UsageAudience } from "../db/schema/vocabulary.ts";
import type { UsageEvent } from "./events.ts";

/**
 * What the page-view beacon (`POST /api/usage`) may record, decided before
 * anything is written (usage insight spec §5.3). Pure except for the one
 * "is this a published tool" read.
 *
 * - A browser that asks not to be tracked (`Sec-GPC: 1` or `DNT: 1`) and a
 *   bot's user agent are recorded as nothing. The user agent is read here and
 *   never stored.
 * - The body is `{ kind, toolId?, source? }`: a `tool_view` needs a published
 *   tool's id (`source` `qr` or `direct`); a `kiosk_view` from the beacon is
 *   an arrival from the kiosk's QR code (`source` `qr`). Anything else is
 *   ignored — the route answers the same either way.
 */

const BOT_UA = /bot|crawl|spider|slurp|headless|preview|facebookexternalhit|lighthouse|pingdom|monitor|curl|wget|python-requests/i;

export function declinesTracking(headers: Headers): boolean {
  if (headers.get("sec-gpc") === "1" || headers.get("dnt") === "1") return true;
  const ua = headers.get("user-agent") ?? "";
  return BOT_UA.test(ua);
}

export async function beaconEvent(body: unknown, audience: UsageAudience, options: { db?: Db } = {}): Promise<UsageEvent | null> {
  if (!body || typeof body !== "object") return null;
  const { kind, toolId, source } = body as Record<string, unknown>;
  if (kind === "kiosk_view") return { kind: "kiosk_view", surface: "web", audience, source: "qr" };
  if (kind !== "tool_view" || typeof toolId !== "string" || !isUuid(toolId)) return null;
  const db = options.db ?? (await getDb());
  const [tool] = await db
    .select({ id: tools.id })
    .from(tools)
    .where(and(eq(tools.id, toolId), eq(tools.published, true), isNull(tools.archivedAt)))
    .limit(1);
  if (!tool) return null;
  return { kind: "tool_view", surface: "web", audience, toolId: tool.id, source: source === "qr" ? "qr" : "direct" };
}

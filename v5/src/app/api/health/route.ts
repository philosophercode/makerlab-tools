import { cacheLife } from "next/cache";
import { HEALTH_CACHE } from "../../../lib/cache";
import { getCatalogTools } from "../../../lib/catalog";
import { getNotionEnvContract } from "../../../lib/notion";
import { rateLimitAsync } from "../../../lib/rate-limit";
import { resolveIdentity } from "../../../lib/auth/identity";
import { mockTools } from "../../../components/mock-catalog";

// `runtime` cannot be set when nextConfig.cacheComponents is enabled.
// Default Node.js runtime is used.

const NOTION_API_URL = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const PROBE_TIMEOUT_MS = 5_000;

type NotionHealth = "ok" | "unreachable" | "unconfigured";

interface HealthReport {
  status: "ok" | "degraded";
  notion: NotionHealth;
  catalog: "live" | "mock";
  toolCount: number;
  checkedAt: string;
}

/**
 * One minimal, uncached Notion call — `page_size: 1` against the Tools database.
 * It deliberately does *not* go through `catalog.ts`, whose day-long cache would
 * happily keep answering through an outage (which is the point of that cache and
 * the reason this probe exists).
 *
 * Nothing about the failure escapes this function: the caller gets one of three
 * words. A health endpoint that reports `NOTION_DB_TOOLS is missing` or echoes a
 * Notion error body hands an attacker the configuration, so the detail is logged
 * server-side and nowhere else.
 */
async function probeNotion(): Promise<NotionHealth> {
  const configured = getNotionEnvContract().every((key) => Boolean(process.env[key]));
  if (!configured) return "unconfigured";

  try {
    const res = await fetch(
      `${NOTION_API_URL}/databases/${process.env.NOTION_DB_TOOLS}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
          "Content-Type": "application/json",
          "Notion-Version": NOTION_VERSION,
        },
        body: JSON.stringify({ page_size: 1 }),
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      }
    );

    if (!res.ok) {
      console.warn("Health probe: Notion query failed with status", res.status);
      return "unreachable";
    }
    return "ok";
  } catch (error) {
    console.warn("Health probe: Notion unreachable:", error);
    return "unreachable";
  }
}

/**
 * Cached for ~30s so a monitor polling every minute costs at most one Notion
 * call per 30s and the endpoint cannot be used to hammer Notion. `checkedAt` is
 * captured with the cached value, so it reports when the probe actually ran.
 *
 * The tool count comes from the catalog only when Notion answered; otherwise the
 * catalog is on its mock fallback and counting it would mean five more failing
 * Notion calls to learn something already known.
 */
async function checkHealth(): Promise<HealthReport> {
  "use cache";
  cacheLife(HEALTH_CACHE);

  const notion = await probeNotion();
  const live = notion === "ok";
  const toolCount = live ? (await getCatalogTools()).length : mockTools.length;

  return {
    status: live ? "ok" : "degraded",
    notion,
    catalog: live ? "live" : "mock",
    toolCount,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Public and unauthenticated so any uptime service can watch it.
 *
 * **The status code is the contract**: 200 when healthy, 503 when degraded.
 * Monitors alert on codes, so a 200 carrying `"status": "degraded"` would be
 * invisible — which is the exact silent failure this endpoint exists to end.
 *
 * Deliberately does not check Anthropic: a model outage doesn't make the catalog
 * wrong, and folding it in would fire the alert for something students can route
 * around.
 */
export async function GET(req: Request) {
  // Rate limit before the probe — cheap as it is, it still touches Notion.
  const identity = await resolveIdentity(req);
  const { allowed } = await rateLimitAsync(`health:${identity.rateLimitKey}`, {
    limit: 30,
    windowMs: 60_000,
  });
  if (!allowed) {
    return Response.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  const report = await checkHealth();
  return Response.json(report, {
    status: report.status === "ok" ? 200 : 503,
    // The probe is cached, the verdict is not: a monitor must always get a
    // freshly evaluated status code rather than a stored one.
    headers: { "Cache-Control": "no-store" },
  });
}

import { cacheLife } from "next/cache";
import { HEALTH_CACHE } from "../../../lib/cache";
import { getCatalogTools } from "../../../lib/catalog";
import { dataSubstrate, pingDb } from "../../../lib/db/client";
import { rateLimitAsync } from "../../../lib/rate-limit";
import { resolveIdentity } from "../../../lib/auth/identity";

// `runtime` cannot be set when nextConfig.cacheComponents is enabled.
// Default Node.js runtime is used.

const PROBE_TIMEOUT_MS = 5_000;

type DatabaseHealth = "ok" | "unreachable" | "demo";

interface HealthReport {
  status: "ok" | "degraded";
  database: DatabaseHealth;
  catalog: "live" | "demo";
  toolCount: number;
  checkedAt: string;
}

/**
 * `pingDb()` carries no signal of its own (spec §3.2), and a hung connection
 * must not hang this endpoint — race it against a plain timer instead.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Health probe timed out")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * One `select 1` against Postgres — or `"demo"` with no round trip at all when
 * `DATABASE_URL` is unset, since that runs the app on the in-process PGlite
 * demo seed (spec §3.10) rather than on nothing. Demo is a known, expected
 * substrate, not a failure, so it gets its own word instead of collapsing into
 * `"ok"` or `"unreachable"`.
 *
 * Nothing about a real failure escapes this function beyond one of three
 * words — a health endpoint that echoes a connection string or driver error
 * hands an attacker the configuration, so the detail is logged server-side
 * and nowhere else.
 */
async function probeDatabase(): Promise<DatabaseHealth> {
  if (dataSubstrate() === "pglite-demo") return "demo";

  try {
    await withTimeout(pingDb(), PROBE_TIMEOUT_MS);
    return "ok";
  } catch (error) {
    console.warn("Health probe: database unreachable:", error);
    return "unreachable";
  }
}

/**
 * Cached for ~30s so a monitor polling every minute costs at most one probe
 * per 30s and the endpoint cannot be used to hammer Postgres. `checkedAt` is
 * captured with the cached value, so it reports when the probe actually ran.
 *
 * The tool count comes from the catalogue whenever there is one to safely
 * read: on the demo seed `getCatalogTools()` reads the local PGlite instance,
 * which costs nothing extra to ask. A configured-but-unreachable Postgres is
 * the one case that skips it — counting from a database this same probe just
 * proved was down would mean either inventing a number or making the failing
 * call twice, and Article 4 rules out the former.
 */
async function checkHealth(): Promise<HealthReport> {
  "use cache";
  cacheLife(HEALTH_CACHE);

  const database = await probeDatabase();
  const toolCount = database === "unreachable" ? 0 : (await getCatalogTools()).length;

  return {
    status: database === "unreachable" ? "degraded" : "ok",
    database,
    catalog: database === "ok" ? "live" : "demo",
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
  // Rate limit before the probe — cheap as it is, it still touches Postgres.
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

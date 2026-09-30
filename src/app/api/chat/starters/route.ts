import { resolveIdentity } from "../../../../lib/auth/identity";
import { findPublishedStarterTool } from "../../../../lib/data/starter-answers";
import { getDb } from "../../../../lib/db/client";
import { checkRateLimit } from "../../../../lib/rate-limit";
import { answerForChip, servableStarterAnswers, STARTER_LOCALE, type ServedStarterAnswer } from "../../../../lib/starters/cache";
import { scheduleUsage } from "../../../../lib/usage/schedule";
import { starterChipUsageEvents } from "../../../../lib/usage/starter-chip";

// `runtime` cannot be set when nextConfig.cacheComponents is enabled.

/**
 * The starter chips' pre-run answers (starter answers).
 *
 * `GET /api/chat/starters?toolId=<slug or id>&locale=en` — the answers this
 * chip set may serve right now: accepted by the grader and still matching
 * what they were made from (`lib/starters/cache.ts`). The chat asks when its
 * chips are on screen, so a click shows the answer with no model call. No
 * `toolId` is the general chips. Another locale, a draft, an archived or
 * unknown tool, or a database that cannot be read all answer `{ answers: [] }`
 * — the chips then answer live, as before; this route never fails the chat.
 *
 * `POST /api/chat/starters` `{ toolId?, question, locale }` — a chip was
 * answered from the cache: count it in Usage Insight as the live turn would
 * have been (`lib/usage/starter-chip.ts`, `source: "cached"`), after the
 * response. Re-checks that the answer is still servable; always 204.
 *
 * Both are rate-limited by identity (`starters` tier). The answers were made
 * as an anonymous visitor, so they are the same for everyone who asks.
 */

interface Scope {
  toolId: string | null;
  locale: string;
}

async function servable(scope: { toolId?: string | null; locale?: string | null }): Promise<{ scope: Scope; answers: ServedStarterAnswer[] }> {
  const locale = scope.locale || STARTER_LOCALE;
  const none = { scope: { toolId: null, locale }, answers: [] };
  if (locale !== STARTER_LOCALE) return none;
  const db = await getDb();
  let toolId: string | null = null;
  if (scope.toolId) {
    const tool = await findPublishedStarterTool(db, scope.toolId);
    if (!tool) return none;
    toolId = tool.id;
  }
  return { scope: { toolId, locale }, answers: await servableStarterAnswers(db, { toolId, locale }) };
}

export async function GET(req: Request) {
  const identity = await resolveIdentity(req);
  const decision = await checkRateLimit("starters", identity);
  if (!decision.allowed) {
    return Response.json({ answers: [] }, { status: 429, headers: { "Retry-After": String(decision.retryAfterSeconds) } });
  }
  const url = new URL(req.url);
  try {
    const { answers } = await servable({ toolId: url.searchParams.get("toolId"), locale: url.searchParams.get("locale") });
    return Response.json(
      { answers: answers.map(({ question, message }) => ({ question, message })) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.warn("[starters] cached answers unavailable; chips answer live", err instanceof Error ? err.message : err);
    return Response.json({ answers: [] }, { headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(req: Request) {
  const identity = await resolveIdentity(req);
  const decision = await checkRateLimit("starters", identity);
  if (!decision.allowed) {
    return new Response(null, { status: 429, headers: { "Retry-After": String(decision.retryAfterSeconds) } });
  }
  try {
    const body = (await req.json().catch(() => null)) as { toolId?: unknown; question?: unknown; locale?: unknown } | null;
    const question = typeof body?.question === "string" ? body.question.slice(0, 500) : "";
    if (question) {
      const { answers } = await servable({
        toolId: typeof body?.toolId === "string" ? body.toolId.slice(0, 200) : null,
        locale: typeof body?.locale === "string" ? body.locale : null,
      });
      const served = answerForChip(answers, question);
      if (served) {
        scheduleUsage(starterChipUsageEvents({ question: served.question, stored: served.usageEvents, role: identity.role, locale: body?.locale }));
      }
    }
  } catch (err) {
    console.warn("[starters] cached chip not counted", err instanceof Error ? err.message : err);
  }
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

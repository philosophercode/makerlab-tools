import { anthropic } from "@ai-sdk/anthropic";
import { gateway } from "@ai-sdk/gateway";
import type { LanguageModel } from "ai";

/**
 * The one place a chat model is named.
 *
 * Every surface that talks to the model — the chat route today, the eval
 * harness later — imports {@link chatModel} from here, so upgrading the model
 * is a one-line change rather than a hunt through call sites.
 *
 * Which provider path is used is decided by env, and **both paths stay
 * supported on purpose**: a contributor who clones the repo with only an
 * `ANTHROPIC_API_KEY` must still be able to run the app, so the direct path is
 * the default and the gateway is opt-in.
 *
 * | Variable | Behavior |
 * |---|---|
 * | `AI_GATEWAY_API_KEY` | Set → route through the Vercel AI Gateway |
 * | `ANTHROPIC_API_KEY`  | Used when the gateway key is absent (the default) |
 */

/**
 * Model id for the direct Anthropic provider — dashes, Anthropic's own naming.
 * This is the exact id the chat route used inline before it was centralized
 * here; changing it changes the model in production.
 */
export const CHAT_MODEL_ID = "claude-sonnet-4-6";

/**
 * The same model addressed through the gateway. Note the id is *not* the same
 * string: the gateway namespaces by provider and spells the version with dots
 * (`anthropic/claude-sonnet-4.6`), while Anthropic's own API uses dashes. Two
 * constants rather than one derived string, because that mapping is a naming
 * coincidence and not a rule.
 */
export const GATEWAY_CHAT_MODEL_ID = "anthropic/claude-sonnet-4.6";

/** True when the deployment is configured to route model calls through the gateway. */
export function usesGateway(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY);
}

/**
 * Pick the model for this deployment.
 *
 * The gateway branch goes through the explicit `gateway(...)` provider from
 * `@ai-sdk/gateway` rather than a bare model id. A bare string would also
 * resolve — the AI SDK's global provider *is* the gateway — but the explicit
 * provider is the seam per-request provider options and failover config attach
 * to, and it makes the dependency visible in `package.json` instead of implied
 * by a transitive one. The provider reads `AI_GATEWAY_API_KEY` itself; it is
 * constructed lazily, so building the model makes no network call.
 *
 * **The direct path stays the default.** A contributor with only an
 * `ANTHROPIC_API_KEY` must be able to run the app, so the gateway is opt-in and
 * an absent (or blank) gateway key falls back to the provider that works.
 *
 * NOTE: the gateway branch is **unverified against a live gateway** — nobody
 * holds an `AI_GATEWAY_API_KEY` yet. The selection logic is tested; the
 * round trip is not. Phase 3+ of
 * `docs/specs/2026-07-29-ai-gateway-migration-design.md` (Vercel config, then a
 * preview deploy) is where a full conversation gets exercised for real.
 */
export function resolveChatModel(): LanguageModel {
  return usesGateway() ? gateway(GATEWAY_CHAT_MODEL_ID) : anthropic(CHAT_MODEL_ID);
}

/** The chat model for this process. */
export const chatModel: LanguageModel = resolveChatModel();

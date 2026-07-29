# AI Gateway Migration — Design Spec

**Date:** 2026-07-29
**Status:** Draft — awaiting approval
**Target:** `v5/`
**Branch:** `v5/ai-gateway`

## 1. Summary

The assistant calls Anthropic directly with a personal `ANTHROPIC_API_KEY`. That is fine for
a project one person runs and wrong for one an institution owns: the bill lands on an
individual's card, there is no spend ceiling, and nobody but the key holder can see what is
being spent or on what.

This routes model calls through **Vercel AI Gateway**. Cornell already needs a Vercel
account to host the app, so this consolidates model spend onto the invoice they are already
paying — and adds spend limits, usage visibility, and provider failover as a side effect.

The change is small: the model reference and one environment variable. Everything else —
tools, streaming, document attachment, vision — is unchanged, because the AI SDK is the
same library either side of the gateway.

**Deliberately v5-only.** Blueprint must run with no third-party account at all
(constitution Article 3 there), so it keeps direct provider calls. The two tracks have
opposite constraints, and this is not a contradiction — v5 is a hosted app handed to an
institution that wants one invoice.

## 2. Goals / Non-goals

### Goals

- Model spend appears on the same invoice as hosting.
- A monthly spend ceiling exists and is enforced by the platform, not by discipline.
- Whoever operates the app can see usage without holding the Anthropic key.
- A provider outage has a fallback rather than taking the assistant down.
- No behavioral change students can perceive.

### Non-goals (this iteration)

- **No model change.** Same Claude model, same prompts. Changing the model and the routing
  at once makes any regression impossible to attribute.
- **No multi-provider routing.** Failover is configured; deliberately routing some traffic
  to a different provider is a separate decision with quality implications.
- **No per-user cost attribution.** The gateway reports in aggregate. Per-user needs the
  request-tagging Blueprint's `agent_runs` provides.
- **No caching layer.** Prompt caching is worth revisiting once real usage exists; it is not
  part of this migration.

## 3. Architecture

One seam changes. Today:

```ts
import { anthropic } from "@ai-sdk/anthropic";
const model = anthropic("claude-sonnet-4-6");
```

After:

```ts
// src/lib/model.ts  — new, and the only place a model is named
import { gateway } from "@ai-sdk/gateway";

export const chatModel = process.env.AI_GATEWAY_API_KEY
  ? gateway("anthropic/claude-sonnet-4-6")
  : anthropic("claude-sonnet-4-6");   // direct fallback
```

**Both paths stay supported, and that is the important decision.** A contributor cloning the
repo with only an `ANTHROPIC_API_KEY` must still be able to run the app — requiring a Vercel
account to develop locally would be a real regression. The gateway is used when configured
and bypassed when not.

**Centralizing the model reference is worth more than the migration.** Today the model name
is chosen at the call site; afterwards there is one module, which makes the next model
upgrade a one-line change and gives the eval harness a single thing to point at.

**Env:**

| Variable | Behavior |
|---|---|
| `AI_GATEWAY_API_KEY` | Set → route through the gateway |
| `ANTHROPIC_API_KEY` | Fallback when the gateway key is absent |

## 4. Data model

None.

## 5. Behavior / flow

Unchanged for students. Same streaming, same tools, same document attachment, same vision,
same latency envelope.

**Gateway unreachable.** The AI SDK surfaces the error like any other model failure and the
chat route's existing handling applies. Worth noting honestly: **this adds a hop and
therefore a new failure mode.** The mitigation is that the gateway's own failover covers
provider-side outages, which are the more common case, and that the direct path remains one
env var away.

**Operator view.** Usage, spend, and errors in the Vercel dashboard. Spend limits configured
there, not in code.

## 6. UI

None.

## 7. Relationship to existing work

- Touches `src/app/api/chat/route.ts`, which `chat-inventory-intake` refactors. **Do this
  after that merge** — it is a two-line change afterward and a conflict before.
- Independent of auth and projects.
- The eval harness should import `chatModel` from the same module, so evals exercise
  whatever production uses.

## 8. Security and safety

- **The gateway key is a new credential** with the same handling as any other: Vercel env
  vars, never committed, rotatable.
- **Prompts and student questions transit Vercel's infrastructure.** This is a genuine
  change in data flow and should be stated plainly to whoever owns the deployment, not
  buried. Confirm Vercel's zero-data-retention posture applies to this account before
  routing production traffic — *open question, and it blocks the switch, not the code.*
- **Spend limits are the actual security win.** An uncapped key behind a public chat
  endpoint is the largest financial risk in the app; the tiered rate limiting in the auth
  spec is the first defense and a platform ceiling is the second.
- No change to prompt-injection surface.

## 9. Phased build order

1. **`src/lib/model.ts`** with the conditional export; every call site imports from it.
   No behavior change — the gateway key is unset, so the direct path runs. Suite green.
2. **Add `@ai-sdk/gateway`**, wire the gateway branch, verify locally with a key.
3. **Configure in Vercel**: key, spend limit, alert threshold.
4. **Deploy to preview**, verify a full conversation including tool calls and a PDF manual.
5. **Production**, then watch the first day's usage against the limit.

Phase 1 is worth landing on its own even if the rest is deferred — centralizing the model
reference has value independent of the gateway.

## 10. Testing

- **Unit** — `model.ts` selects the gateway when `AI_GATEWAY_API_KEY` is set and the direct
  provider when it is not. Env stubbed both ways. This is the whole logical surface.
- **Integration** — the existing `/api/chat` tests pass unchanged, which is the real
  assertion: the migration is invisible above this seam. The suite mocks at the `streamText`
  boundary, so it neither knows nor cares which provider was selected.
- **Manual, in preview** — a full conversation, a tool call, a PDF manual attachment, and a
  photo upload, before production.

**Cases that would embarrass us**: the gateway configured but the direct key silently used
because of a typo in the env name (unit test covers it); spend limit unset in production
after all this.

## 11. Open questions

1. **Does Cornell's Vercel account have the required plan, and who administers it?** Blocks
   phase 3, not the code. *Ties to the "who owns the deployment" question in the auth spec.*
2. **Is routing prompts through Vercel acceptable to the university?** Student questions,
   possibly with photos. Worth an explicit answer rather than an assumption.
3. **What monthly ceiling?** Unknowable without data. Suggest setting it deliberately low at
   first with an alert, then raising it — a limit that trips is a conversation, a limit that
   never trips teaches nothing.

---

## Amendments

Appended per [`DRIFT.md`](DRIFT.md). Original text above is never edited — the reason a
design changed usually outlives the change.

### 2026-07-29 — gateway model id, and what phase 2 could not verify (as-built)

**What changed.** Two departures from §3 and §9 phase 2.

*The gateway model id is not the string in §3.* §3 writes
`gateway("anthropic/claude-sonnet-4-6")`. The code uses
`anthropic/claude-sonnet-4.6` — dot, not dash — and keeps it as a second constant
(`GATEWAY_CHAT_MODEL_ID`) alongside the direct id `claude-sonnet-4-6`.

**Why.** Anthropic's own API spells model versions with dashes; the Vercel AI Gateway
namespaces by provider and spells them with dots (`anthropic/claude-sonnet-4.5`,
`openai/gpt-4o`). §3's string is the direct id with a provider prefix bolted on, which is
what you write when the two conventions look interchangeable. They are not, and neither
string works in the other place. Two constants rather than one derived from the other,
because that relationship is a coincidence of naming and not a rule that will keep holding.

*Phase 2 says "verify locally with a key" and that did not happen.* Nobody holds an
`AI_GATEWAY_API_KEY`. The dependency is added, the branch is written and unit-tested, and
the model id above is **unverified against a live gateway** — if it is wrong, the failure is
a `GatewayModelNotFoundError` on the first real request, not a silent fallback. Phase 3 is
where a person creates the key; whoever does that should send one message through a preview
deploy before production, per §9 phase 4.

**Scope.** `@ai-sdk/gateway` is pinned to `^3` rather than the latest `4.x`: `ai@6` speaks
provider spec v3, and gateway 4.x is spec v4. The newer major installs cleanly and then
fails to typecheck as a `LanguageModel`. This is the kind of thing that looks like a routine
dependency bump later, so: **the gateway major is tied to `ai`'s provider spec, not free to
float.**

The direct Anthropic path remains the default and is unchanged, per §3 — a contributor with
only an `ANTHROPIC_API_KEY` still runs the app with no Vercel account. The existing
`/api/chat` integration tests pass untouched, which is the assertion §10 asks for.

**Status.** Accepted — the code is right and the spec's example string was wrong.

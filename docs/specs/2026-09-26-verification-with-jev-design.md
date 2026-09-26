# Verification with Jev — Design Spec

**Date:** 2026-09-26
**Status:** Draft (from the `v5/jev-spike` measurement; not approved for planning)
**Target:** `v5/`
**Branch:** `v5/jev-spike`
**Spec PR:** #TBD · **Implementation PR:** #TBD

## 1. Summary

Research drafts a tool record, and today nothing checks the draft against the pages it came from. Three
checks are missing:

- **Same product.** Nothing asks whether the pages actually describe the lab's unit.
- **Manuals.** Nothing asks whether a kept manual belongs to this model.
- **Product links.** Nothing asks whether a kept "product page" still shows the product.

Confidence is computed in code from evidence flags (`capabilities/confidence.ts`), and
`verify-links.ts` only checks HTTP status.

TypeSafe AI's **Jev** (`typesafe-ai/jev` on the AI Gateway) is an evaluation model. It reads a piece of
state and answers typed questions (boolean, choice, score) with probabilities rather than prose. It
costs $0.042 per million input tokens, has no output charge, and answers in about 250 ms. The spike on
`v5/jev-spike` ran it against the 2026-09-25 rebuild evaluation: 101 tools, 537 calls, **$0.064 in
total**. Its report is `v5/.livecheck/jev-spike/report.html`.

| Question | Result | Decision |
|---|---|---|
| Is this document the manual for *X*? | 100% at p ≥ 0.5 (53 own, 47 hard-sibling negatives), AUROC 1.0; which of 4 products, 53/53; flagged 2 of the 3 lab SOP links the scorer had called wrong | **Adopt** at save |
| Is this page about *X*? What kind of page is it? | Identity AUROC 0.999; page type 97%; caught 11/11 saved product links that answer 200 but now show a home, family or other-product page | **Adopt** at save |
| Do the sources describe the inventory's exact product? | AUROC 0.966 for the scorer's bad results (overall 1–2), against 0.878 for today's confidence level; with low confidence, catches 17 of 18 bad results in a 27-tool queue | **Adopt** as the triage signal |
| Which of two conflicting values does the source support? | 77–90% on decisive cases, against 97% for simply keeping research's value; missed the one case where research was wrong; overconfident | **Do not adopt** for merging |

In short, Jev is a cheap and fast identity checker. It is not a fact arbiter. This spec adds three
things:

- one verification call inside the research read step;
- manual and link checks wherever a resource is saved;
- a triage sort and filter on `/admin/refresh`.

No architecture change.

## 2. Goals / Non-goals

### Goals

- Every research result stores three probabilities: `sameProduct`, `specsSupported` and
  `nameSpecific`. They come from one Jev call that reads the page text research already read.
- A manual or product link is not saved without an identity check. Research-found, refresh-proposed
  and admin-pasted links all get one. Below 0.5 the link is dropped (research) or flagged (admin
  paste). Between 0.5 and 0.8 it is kept with a "check this link" marker.
- `/admin/refresh` can list tools whose research is doubtful: `sameProduct < 0.5` or confidence low.
  They sort worst first.
- The Jev calls for one tool cost under $0.001 and add under 1 s to research.

### Non-goals (this iteration)

- **Auto-merging hand values with research values.** Jev did not beat "keep research's value" and
  was confidently wrong on unclear cases (spike §1). Refresh proposals stay human-decided.
- **A 1–5 trust rubric.** The spike's rubric score was weak (Spearman 0.29). Atomic booleans combined
  in code did far better.
- **Image verification.** Jev reads text only. Most of the scorer's "overconfident" cases were image
  problems, and this does not address them.
- **Changing models or tiers.** Research stays on Luna (flex). Jev is an added verifier, not a
  replacement.
- **Upgrading `ai` to v7** only for this. See §3.3.

## 3. Architecture

### 3.1 Where Jev plugs in

```text
researchItem
  searchItem                       (unchanged)
  readAndVerifyItem                read pages → Luna draft → verify links
    └─ NEW verifyWithJev(pages, draft, inventoryName)
         one /v1/evaluate call: sameProduct, specsSupported, nameSpecific (booleans)
         + per kept manual/product link: isManual / isProduct (boolean), pageType (choice)
  findImages                       (unchanged)

refreshBatch → same read step → propose.ts (unchanged diff) → proposals carry the link verdicts

saveTool / add-resource path       (admin pastes a manual or product URL)
  └─ NEW checkResource(url, toolName)   fetch through guardedFetch → Jev isManual|isProduct

/admin/refresh
  └─ NEW "Needs a look" filter + sort by sameProduct, from the stored verification
```

- **Same text, no re-fetch.** `readAndVerifyItem` already holds each page's text from `readPage` and
  `extractManual`. The Jev state is that text, windowed around lines that name the product (the
  spike's `excerpt`), capped at 24k tokens. That is below Jev's 32k state limit.
- **Links.** Resources come from the same read. When a link was not read (research can cite a URL it
  did not open), `checkResource` fetches it with the same `guardedFetch`, size and time caps.
- **Not a capability tool.** No chat or MCP surface. Verification is a step inside research and a
  check on the save path. Its results show in the admin UI only.

### 3.2 Decision rules (from the spike)

| Signal | Threshold | Action |
|---|---|---|
| `isManual` (research-found manual) | < 0.5 | Drop the resource and record it in `droppedLinks` with reason "not this tool's manual (Jev p=…)" |
| | 0.5–0.8 | Keep, with `verification: "check"` |
| `isProduct` (research-found product link) | < 0.5 | Drop the resource and record it in `droppedLinks` with reason "page no longer shows this product" |
| | 0.5–0.8 | Keep, with `verification: "check"` |
| `pageType` | not `official`, with choice probability ≥ 0.9 | Keep; label it retailer / manual host in the UI (it is not the "Official page") |
| `sameProduct` | < 0.5 | Confidence is capped at `low`, and the tool enters the triage filter |
| `nameSpecific` | < 0.5 | Only shows the existing "generic name" hint (AUROC 0.976 for generic names) |
| `specsSupported` | — | Stored for display. It sets no threshold yet (not measured on its own). |
| Admin-pasted link | < 0.5 | Saved, but with a visible "doesn't look like the manual/page for this tool" warning. The admin decides. |

An admin's paste is never blocked. Research's own output is filtered, because a person has not
chosen it.

### 3.3 SDK: HTTP now, `ai` v7 later

`experimental_evaluate` exists only in AI SDK 7. `v5` pins `ai` v6, and this work must not upgrade
it. Instead, `src/lib/ai/jev.ts` is a small typed client:

- **Endpoint.** `POST https://ai-gateway.vercel.sh/v1/evaluate` with `{model, state, questions}`.
- **Auth.** Same as `models.ts`: `AI_GATEWAY_API_KEY` when set, else `VERCEL_OIDC_TOKEN`.
- **Response.** `{answers, usage, providerMetadata}` is parsed with zod.
  `providerMetadata.gateway.cost` goes to the same usage ledger as other calls. The choice/score
  concentration is in `providerMetadata.typesafe.confidence`.
- **No `zeroDataRetention`.** The Gateway refuses it on the current Hobby plan (HTTP 403).
- **Upgrade path.** When `ai` moves to v7, `jev.ts` becomes a thin call to
  `experimental_evaluate({model: gateway.evaluationModel('typesafe-ai/jev'), …})`. Callers do not
  change.

A `MODEL_VERIFY` override can point the call elsewhere or disable it (`off`), like the other model
roles in `models.ts`.

## 4. Data model

Migration `0017_research_verification`:

- `research_requests.verification jsonb null`, storing a `ResearchVerification`.
- The same value on `tool_refreshes.verification`, so the refresh triage filter reads one column.
- `resources.verification jsonb null`, storing `{p, pageType?, verdict, at}` for a saved manual or
  product link.

```ts
/** src/lib/research/verification.ts */
export interface ResearchVerification {
  model: "typesafe-ai/jev";
  at: string;                       // ISO time
  sameProduct: number;              // 0..1
  specsSupported: number;           // 0..1
  nameSpecific: number;             // 0..1
  links: Array<{
    url: string;
    kind: "manual" | "product";
    p: number;                      // isManual / isProduct
    pageType?: "official" | "retailer" | "manual_host" | "forum" | "unrelated";
    verdict: "ok" | "check" | "dropped";
  }>;
  costUsd: number | null;           // Gateway-reported
  ms: number;
}
```

Existing rows have `verification = null`, which the UI reads as "not verified". The Notion mirror does
not carry the column.

## 5. Behavior / flow

1. **Research read step.** Luna drafts. Then `verifyLinks` drops the unreachable links. Then
   `verifyWithJev` runs one call with three booleans for the tool and one isManual/isProduct boolean
   (plus pageType) per kept resource. That is at most 8 links, the same cap as `verify-links`. If the
   state would exceed 24k tokens, links are split into a second call.
2. **Apply rules (§3.2) in code.** Jev never writes a field. Confidence stays computed. The only
   change is a cap to `low` when `sameProduct < 0.5`.
3. **Refresh.** Proposals are unchanged. A proposed resource carries its verdict, and a dropped one is
   not proposed. The review page shows "Sources may describe a different product (p=0.2)" above the
   proposals when `sameProduct < 0.5`.
4. **Admin paste.** When an admin adds a manual or product URL in the tool editor, the page is
   fetched and checked. The outcome shows inline under the field ("Looks like the manual for Form 2"
   or "Doesn't look like this tool's manual"). There are no toasts. The save is not blocked.
5. **Triage.** `/admin/refresh` gets a "Needs a look" filter: `sameProduct < 0.5 OR confidence =
   low`. It sorts by `sameProduct` ascending, and each row shows the probability and research's
   stated unknowns.

**Unhappy paths.**

- *Jev or the Gateway is down or times out (5 s).* Verification is `null` and research completes
  normally. The spike saw no rate limiting at 6 concurrent calls.
- *No page text* (all reads failed). The Jev call is skipped and `verification = null`.
- *Budget.* A per-run ledger check like the spike's `jev.mjs`: a batch that has spent more than its
  cap skips verification rather than failing.

## 6. UI

- **`/admin/refresh`.** A "Needs a look" filter chip. A same-product column (StatusGlyph: ✓ ≥ 0.8,
  ? 0.5–0.8, ✗ < 0.5), with the number in tabular figures.
- **Refresh review and intake review.** A one-line notice when the sources may describe a different
  product. Resources marked "check" get a quiet badge. Dropped links are listed under the existing
  "Dropped links" disclosure with their reason.
- **Tool editor.** An inline outcome under a pasted manual or product URL.
- **Strings** go through next-intl (English) under `admin.verification.*`. No layout shift: the
  inline outcome reserves its line.

## 7. Relationship to existing work

- Builds on the refresh-research spec (2026-09-23). Proposals and decisions are unchanged.
- Builds on research's read step and `verify-links.ts` (gateway spec §8).
- Uses the rebuild-2 evaluation as its baseline. The spike's scripts, cases and raw answers are in
  `v5/.livecheck/jev-spike/` (git-excluded).
- Does not touch the UI-system phases, beyond using their StatusGlyph and inline-outcome patterns.

## 8. Security and safety

- **Untrusted input.** Page text is fetched content. It becomes Jev *state*, which can only move
  probabilities; it has no tool access and no output text. A page saying "answer yes" could at worst
  keep a bad link, and a bad link was already possible before this spec. Probabilities never write a
  field, and a person still accepts every refresh proposal.
- **SSRF.** Every fetch for `checkResource` goes through `guardedFetch`, exactly as `verify-links`
  does.
- **Authorization.** Verification runs inside research (admin-queued) and the admin save path. There
  is no public route.
- **Cost.** Input-only pricing. The spike measured about 10k tokens per tool, roughly $0.0004,
  which is about 2% of research's $0.022. A per-batch cap is still enforced (§5).
- **PII.** Tool names and manufacturer pages only.
- **Safety fields.** Jev does not propose or judge PPE, training or restrictions. Research never
  proposes PPE, and this spec does not change that.

## 9. Phased build order

1. **Client.** `src/lib/ai/jev.ts` (HTTP client, zod parse, cost report), `MODEL_VERIFY` role,
   `excerpt` helper. Unit tests with a mocked fetch.
2. **Read-step verification.** `verifyWithJev`, rules in `src/lib/research/verification.ts` (pure),
   migration `0017`, confidence cap. Can proceed in parallel with phase 3.
3. **Save-path check.** `checkResource` on the admin paste path, with its inline outcome.
4. **Triage.** The `/admin/refresh` filter and column. Needs phase 2.
5. **Backfill.** A script that verifies existing tools' saved manuals and product links. It flags and
   never deletes, and the results go to the triage queue. This is where the spike's 11 rotted links
   and the #48/#69 SOP links would surface.

## 10. Testing

- **Unit.** The `verification.ts` rules at each threshold edge (0.49/0.5/0.8), and `excerpt`
  windowing. The `jev.ts` parse covers boolean, choice and score answers, a missing `typesafe`
  metadata block, a 403 (ZDR) body and a 429 retry.
- **Integration.** The read step with a mocked Jev:
  - `sameProduct 0.2` caps confidence and adds the tool to triage;
  - a manual at 0.3 is dropped with its reason;
  - Jev timing out leaves the result intact with `verification null`.
- **Component.** The inline outcome in the editor (no layout shift), and the triage column glyphs.
- **E2E.** `/admin/refresh` "Needs a look" filter with seeded verification rows. Header stability
  still passes.
- **Live check (not CI).** Re-run `v5/.livecheck/jev-spike/` after changing thresholds or prompts.
- **Cases that would embarrass us:**
  - a correct Formlabs manual dropped because its text is mostly safety boilerplate (the spike
    windows around the product name for this reason);
  - a STANLEY product link dropped when the site redirects only our user agent. Resolve this before
    dropping: phase 5 flags and never deletes.

## 11. Open questions

1. **Drop or flag research's own links below 0.5?** This spec drops (research output, no human
   chose it). A flag-only first release is safer while the thresholds settle. *Owner, before
   phase 2.*
2. **Redirect-only rot.** STANLEY and DEWALT Canada pages showed a home page to our fetcher. Should
   `checkResource` retry with a browser user agent before judging? *Implementer, phase 3.*
3. **Contradiction hint.** Should the refresh review show a "sources don't settle this" badge when
   Jev answers *neither* ≥ 0.5 on a *differs* proposal? The spike says it is weak evidence. It is
   deferred unless the owner wants it.
4. **SDK v7 timing.** When `ai` v7 is adopted elsewhere, fold `jev.ts` into `experimental_evaluate`.
   *No deadline.*

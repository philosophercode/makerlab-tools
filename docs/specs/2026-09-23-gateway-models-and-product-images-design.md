# Gateway-First Models and a Product Image Finder — Design Spec

**Date:** 2026-09-23
**Status:** Draft
**Target:** `v5/`
**Branch:** `v5/gateway-images-spec`
**Spec PR:** #TBD · **Implementation PR:** #TBD

## 1. Summary

Every model call in v5 goes through the **Vercel AI Gateway**, and each job the app
does with a model — chat, research search, research reading, image ranking, image
cleaning — names its own model. The default for every language job becomes
**`openai/gpt-6-luna`** ($0.10 per million input tokens, $0.50 per million output;
vision, file input, tool calling, structured output). Any job can be moved to a
stronger model with one environment variable, without touching code. The
direct-Anthropic path, `ANTHROPIC_API_KEY`, and the Anthropic-only tools the app leans
on today are retired.

That last part is the real work. Chat and research use Anthropic's server-side
`web_search` and `web_fetch`, and chat attaches manuals with Anthropic's cache
markers. None of these work with another provider. They are replaced by
provider-neutral pieces:

- **Exa search**, which the Gateway exposes to any model.
- **Reading pages ourselves:** a server-side `read_page` fetch in place of `web_fetch`.
- **Plain AI SDK file parts** for PDFs, with no Anthropic cache markers.

Reading pages ourselves is also what makes the second feature possible.

**A product image finder** becomes a stage of the research workflow. Research already
decides which pages describe a machine. Once our server reads those pages, it can
take each page's declared product image (`og:image`, or a JSON-LD `Product.image`). If
that yields fewer than three images, it adds the images Exa reports. The candidates
are then processed as follows:

1. **Rank.** A cheap vision call ranks the candidates.
2. **Clean.** A Gateway image model makes a background-removed copy of the top one.
3. **Choose.** The preliminary page shows the three candidates, with the cleaned copy
   beside its original. The admin picks one, or none.
4. **Store the pick only.** Nothing is stored for a candidate the admin did not pick,
   and nothing is published without that choice. The picked image becomes the
   tool's cover photo in Blob, with its source URL recorded.

**Architecture change:** the model layer moves from "one Claude model, two providers"
to "a job registry, one provider". This is the change to review hardest; the image
finder is ordinary feature work on top of it.

## 2. Goals / Non-goals

### Goals

- **Gateway only, one job registry.** Every `streamText` / `generateText` /
  `generateImage` call gets its model from `modelFor(job)`, which always returns a
  Gateway model. No other code names a model.
- **Luna by default, overrides by env var.** Each job defaults to `openai/gpt-6-luna`,
  except image cleaning, which defaults to `openai/gpt-image-1-mini`. `MODEL_<JOB>`
  overrides one job.
- **No provider-specific tools, options or wire formats remain.** None in `src/` or
  `evals/`, and none in any test mock.
- **Nothing a person does gets worse.** Chat keeps:
  - web search, with a per-turn cap;
  - reading the focused tool's own pages;
  - reading the focused tool's manual PDFs;
  - answering honestly, in the visitor's language.
- **An eval gate for chat.** Chat switches to Luna only after `npm run eval` passes
  on it (§10).
- **Research produces up to three ranked image candidates per item,** plus one
  cleaned copy of the best. It keeps the cost under five cents per item for images.
- **Nothing stored until chosen.** The preliminary page lets an admin choose the
  cleaned copy, an original, or no image. Only the chosen image becomes a stored,
  public file, recorded with its source URL.
- **Uploaded photos come first.** Photos the admin uploaded in chat still take
  precedence: an item that has one skips the image stage.

### Non-goals (this iteration)

- **An admin settings page for models.** Env vars are enough while one person changes
  them. A page needs a table, an allow-list and a UI.
- **Automatic fallback between models or providers.** The Gateway offers provider
  fallback, but a silent change of model is a change of behaviour nobody reviewed.
  A job fails loudly and is retried the way it is today.
- **Embeddings, retrieval, or manual pre-processing.** Manual pre-processing, the
  "shred once, search" idea discussed on 2026-09-23, gets its own spec.
- **Cleaning more than the top candidate,** or cleaning on demand. The top candidate
  covers the common case. A second button is a later nicety.
- **Image search as a primary source.** Exa's image fields are the only search, and
  only as a top-up.
- **Editing or cropping images in the app.** Pick or reject only.
- **Finding images for existing tools.** This covers the intake path only. A backfill
  over the imported inventory is a later, separate decision (§11).
- **Per-user cost tracking.** Gateway spend limits and reports cover the lab's needs.

## 3. Architecture

### 3.1 The job registry (`src/lib/ai/models.ts`)

`src/lib/model.ts` is replaced by a registry. `src/lib/ai/` is new and holds
everything that talks to the Gateway.

```ts
// src/lib/ai/models.ts
import "server-only"; // see note on step code below
import { gateway } from "@ai-sdk/gateway";

export const MODEL_JOBS = {
  chat:           { kind: "language", env: "MODEL_CHAT",           default: "openai/gpt-6-luna" },
  researchSearch: { kind: "language", env: "MODEL_RESEARCH_SEARCH", default: "openai/gpt-6-luna" },
  researchRead:   { kind: "language", env: "MODEL_RESEARCH_READ",   default: "openai/gpt-6-luna" },
  imageRank:      { kind: "language", env: "MODEL_IMAGE_RANK",      default: "openai/gpt-6-luna" },
  imageClean:     { kind: "image",    env: "MODEL_IMAGE_CLEAN",     default: "openai/gpt-image-1-mini" },
} as const;

export type ModelJob = keyof typeof MODEL_JOBS;

/** "provider/model" — the only shape the Gateway accepts. Anything else is a config error. */
export function modelIdFor(job: ModelJob): string;
export function languageModelFor(job: Exclude<ModelJob, "imageClean">): LanguageModelV3;
export function imageModelFor(job: "imageClean"): ImageModelV3;
```

- **An override is validated when it is read.** It must match `^[a-z0-9-]+/[a-z0-9.-]+$`.
  A malformed override throws at the first call with the variable's *name*, never its
  value.
  - An id the Gateway does not know fails with `GatewayModelNotFoundError`, which is
    not retried.
  - Both are configuration errors, and research records them in `research_error` as
    "model not available (MODEL_RESEARCH_READ)".
- **Where identify lives.** Identify is not a separate call. `identify_tools` is a
  chat tool, so it runs on the `chat` model. The job list names what the code
  actually calls.
- **Evals** use `languageModelFor("chat")` unless `EVAL_MODEL` is set. When it is,
  `EVAL_MODEL` is a Gateway id too, which fixes today's quirk where it bypassed the
  Gateway.
- **Step code runs under plain Node, not `server-only`.** `src/lib/research/steps.ts`
  and the manual archiver already work around this. So `models.ts` is split:
  - `models.ts` holds the pure table and `modelIdFor`, with no `server-only`;
  - the factories stay in the same file only if they import nothing `server-only`.
  - The build phase confirms which split works. The rule is: one table, one place.
- **Authentication.** The Gateway provider reads `AI_GATEWAY_API_KEY`, and on Vercel
  falls back to the deployment's OIDC token. Production therefore needs **no AI key**
  at all.
  - Locally, set `AI_GATEWAY_API_KEY` in `.env.local`, or run `vercel env pull` for a
    short-lived OIDC token (it expires after about 12 hours).
  - `ANTHROPIC_API_KEY` is read by nothing, and is removed from `.env.example`,
    `docs/deploy.md` and Vercel.
- **What is proposed for deletion, separately (Working agreements):**
  - the `@ai-sdk/anthropic` dependency;
  - `src/lib/model.ts` and its test, once nothing imports them.
- **Test-only base URL.** `AI_GATEWAY_BASE_URL` points the provider at a local stub,
  set through `createGateway({ baseURL })`. It exists for the E2E stub, like
  `NOTION_API_BASE_URL`, and is documented as such.

### 3.2 Web search: Exa through the Gateway

`gateway.tools.exaSearch(config)` is a provider-defined tool that the Gateway executes.
It works with any model, and each result can carry page text, highlights, the page's
own `image`, and `extras.imageLinks`.

| Where | Config | Replaces |
|---|---|---|
| Chat | `numResults: 5`, `contents: { highlights: true }` | `anthropic.tools.webSearch_20250305({ maxUses: 5 })` |
| Research search step | `numResults: 6`, `contents: { highlights: true }`, `extras: { imageLinks: 3 }` | `webSearch_20250305({ maxUses: 4 })` |

**Caps become ours.** `maxUses` was an Anthropic server-side cap. Exa has none.

- The chat route and the research search step count Exa calls in `prepareStep`.
- When the cap (5 for chat, 4 for research) is reached, they remove `exa_search` from
  `activeTools` for the rest of the turn.
- A unit test pins both caps.

### 3.3 Reading pages: `read_page` and the server-side reader

`web_fetch` ran on Anthropic's servers, so our server never saw the pages. Its
replacement runs on ours, as one module and two callers:

```ts
// src/lib/web/read-page.ts  (plain Node — step code imports it)
export interface ReadPageResult {
  url: string;               // final URL after redirects
  status: "ok" | "blocked" | "failed" | "too_large" | "unsupported";
  contentType: string | null;
  title: string | null;
  text: string | null;       // readable text, capped at READ_PAGE_MAX_CHARS (40k)
  pdf: Uint8Array | null;    // for application/pdf; the caller decides what to do with it
  images: ImageHint[];       // og:image, twitter:image, JSON-LD Product.image, in that order
  reason?: string;
}
export interface ImageHint { url: string; source: "og" | "twitter" | "jsonld" | "exa"; }
export function readPage(url: string, opts: { signal: AbortSignal; allowedHosts?: string[] }): Promise<ReadPageResult>;
```

- **SSRF guard.** This is new, because the only server-side GET the app has today
  throws the body away. The reader:
  - takes `http(s)` URLs only;
  - resolves the host and refuses loopback, private (RFC 1918), link-local and
    unique-local addresses, and the metadata addresses;
  - follows at most 3 redirects, re-checking each hop;
  - reads at most 5 MB of HTML or 10 MB of PDF;
  - gives up after 15 s per page.
- **HTML to text.** Scripts, styles and navigation are dropped, the main content is
  kept, and the result is collapsed to plain text. A small parser from the existing
  dependency tree is preferred; if none fits, the dependency is proposed in the build
  PR, not silently added.
- **In chat, `read_page` is a capability tool** (Article 2), in a new `web` capability
  that is `chatOnly`.
  - It is allowed only on hosts of the focused tool's resource links, exactly the
    `allowedDomains` rule `web_fetch` has today.
  - It is capped at 5 calls per turn.
  - It returns `text` fenced as untrusted data, never HTML.
- **In research, the read step no longer gives the model a tool.** The server reads
  the search step's candidate URLs itself, up to 4 pages, using the existing hosts
  rule. It then calls `researchRead` with:
  - the page texts, each fenced and labelled with its URL;
  - any PDF, as a file part (Luna accepts file input);
  - the same `FETCH_SHAPE` output contract as today.

  The step becomes deterministic, is easier to test, and has a smaller
  prompt-injection surface: a model with no tools cannot be steered into fetching
  anything.

### 3.4 Manuals in chat

PDF file parts stay as they are: `{ type: "file", mediaType: "application/pdf", data }`.
They are provider-neutral in the AI SDK. The Anthropic `cacheControl` provider option
is removed, and caching now depends on the provider:

- **Luna caches repeated context implicitly.** The Gateway lists it as
  `implicit-caching`, with cache reads at $0.01 per million tokens.
- **Cost.** At Luna's price a 200k-token manual costs about **2¢** uncached.
- **Article 4 is still met,** by the provider's implicit caching plus lazy loading:
  manuals are attached only when a tool is focused.

`MAX_PDFS_PER_CHAT = 3` and the 10 MB cap stay. The archived Blob copy is preferred,
as built on 2026-09-23.

### 3.5 The image stage of the research workflow

```text
researchItem(id)
  ├─ step: searchItem(id, requestId)          — researchSearch + exa_search (≤4)
  ├─ step: readAndVerifyItem(id, requestId)   — server reads ≤4 pages → researchRead; verify links
  │                                              ↳ also returns ImageHint[] from those pages
  └─ step: findImages(id, requestId)          — NEW; skipped if the item has an uploaded photo
        1. candidates = hints from read pages ∪ Exa `image`/imageLinks, de-duplicated, ≤8
        2. probe each: GET with SSRF guard, ≤8 MB, must decode as JPEG/PNG/WebP, ≥400px short edge
        3. rank: imageRank model sees ≤6 probed images (downscaled) + the item name → top 3 with reasons
        4. clean: imageClean edits the #1 image → transparent PNG → private Blob, owned by the pending item
        5. record: research.images = { candidates: top 3, cleaned: {attachmentId} | null }
```

- **A third step.** `findImages` has its own 240 s abort and `maxRetries = 2`, and it
  keeps Hobby's 300 s ceiling honest.
- **Failure never fails the item.** If `findImages` fails, the item still becomes
  `researched`, with `images: null` and the reason in `research.imageError`. A machine
  without a found photo is a normal outcome; a machine without a description is not.
- **Probed bytes are never stored.** Ranking downloads candidates into memory and
  drops them. The *only* file written before a person decides is the cleaned copy:
  it is the one thing that has no URL of its own to point back to.
- **Cleaning.** It uses `generateImage` with `prompt: { images: [original], text: CLEAN_PROMPT }`
  and `providerOptions` asking for a transparent PNG background. Whether the Gateway
  passes that option through to OpenAI is verified in Phase 0 (§11).
  - `CLEAN_PROMPT` asks for the object only: unchanged, centred, on a transparent
    background, with no added objects, text or shadow.
  - The result is checked in code: it must decode, and it must be a PNG with an alpha
    channel. A result that fails the check is dropped (`cleaned: null`), never shown.
- **Ranking is advice, the choice is human.** The vision call's output is parsed
  strictly: `{ order: number[], reasons: string[] }`, with indexes that must exist.
  Nothing it says is published.

## 4. Data model

### 4.1 `ResearchResult` gains `images`

`src/lib/research/result.ts` is a `strictObject`. The new field is **optional with a
`null` default**, so rows researched before this change still parse.

```ts
export interface ImageCandidate {
  url: string;          // the image's own URL — what a choice of "original" downloads
  pageUrl: string | null; // the page it was declared on, for attribution
  source: "og" | "twitter" | "jsonld" | "exa";
  width: number;
  height: number;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  rank: 1 | 2 | 3;
  reason: string;       // the ranking model's one-line reason, ≤200 chars
}

export interface ResearchImages {
  candidates: ImageCandidate[];          // 0–3, rank order
  cleaned: { attachmentId: string; fromUrl: string } | null; // cleaned copy of rank 1
}

// ResearchResult
images?: ResearchImages | null;          // absent/null = stage skipped or found nothing
imageError?: string | null;              // one-line reason when the stage failed
```

### 4.2 `attachments` gains two columns (migration `0008`)

| Column | Type | Notes |
|---|---|---|
| `origin` | text null, CHECK in `ATTACHMENT_ORIGIN` | `upload`, `import`, `manual_archive`, `research_image`, `research_image_cleaned`. Null on rows written before the migration |
| `source_url` | text null | Where the bytes came from: the image URL for `research_image`, the original's URL for `research_image_cleaned`, the manufacturer URL for `manual_archive` |

- **`origin` lets the code tell a cleaned candidate from a person's upload.** Both
  are owned by the pending item.
- **`source_url` is the attribution the admin asked for.**
- **The manual archiver backfills `source_url` on its own rows** in the same
  migration. Its `source_key` already encodes the URL.
- **Nothing else changes.** Pending items still own their photos, approval still
  re-owns them, and the orphan sweep and the 14-day expiry already delete what is
  released.

### 4.3 The approval input gains `image`

```ts
// ApprovePendingInput.fields
image?:
  | { choice: "cleaned" }                         // the cleaned copy of rank 1
  | { choice: "original"; candidateUrl: string }  // must equal one of research.images.candidates[].url
  | { choice: "none" }
  | undefined;                                     // treated as "none"
```

## 5. Behavior / flow

### 5.1 Research (per item)

1. **Search.** As today, but through `researchSearch` and Exa, with our own cap of 4
   calls.
2. **Read and verify.** The server reads up to 4 pages. `researchRead` drafts the
   record from them, and the links are verified as today.
3. **Find images.**
   - *Skipped* when the item already owns an `upload` photo. The admin's photo is the
     cover, and nothing is spent.
   - Otherwise the stage probes, ranks and cleans, then records the result.
   - *No usable candidate:* `images: { candidates: [], cleaned: null }`.
   - *Cleaning fails or fails the alpha check:* the candidates are still shown, with
     no cleaned copy.

### 5.2 Review and approval

1. The preliminary page shows **Product image**: the cleaned copy beside its original,
   ranks 2 and 3 as smaller choices, and "No image".
   - The cleaned copy is preselected when it exists, otherwise rank 1.
   - Candidates display from their **source URLs**, loaded by the admin's browser.
     They are not proxied: nothing is stored or fetched server-side for display.
2. **Approve / Approve as draft** sends `image`. The server action checks the choice
   *before* the transaction:
   - **`original`:** `candidateUrl` must be one of the recorded candidates; any other
     URL is `invalid_field` (SSRF guard). The server downloads it through the same
     guarded reader, checks it decodes, uploads it public, and holds the attachment id.
   - **`cleaned`:** the cleaned attachment is made public with `copyToPublic`.
   - **`none`:** nothing.
3. **Inside the approval transaction:**
   - the chosen image's attachment is owned by the new tool at a position before
     every uploaded photo, so it becomes the cover;
   - `origin` and `source_url` are recorded;
   - any unchosen cleaned copy is **released**, and the nightly orphan sweep deletes
     its bytes.
4. **Unhappy paths:**
   - *The chosen original 404s, is too large, or does not decode at approval time.*
     The approval **still succeeds**, without an image, and answers
     `warning: "image_not_attached"`. The page says so, so the admin can add a photo
     in the editor (Article 4: never report a photo that is not there).
   - *Blob not configured.* This is the same warning, and in local dev the local Blob
     folder applies.
   - *Discard, or the 14-day expiry.* The cleaned copy is released along with the
     item's other photos, as today.

### 5.3 Chat

This is the same experience with different plumbing:

- **Exa search**, capped at 5 per turn.
- **`read_page`** on the focused tool's hosts, capped at 5.
- **Manual PDFs as file parts.**
- **`describeChatError`.** It is reworded from Anthropic's 529 "overloaded" to
  provider-neutral messages, keyed on the Gateway's error classes: rate limited,
  model not found, provider unavailable.

## 6. UI

- **`PreliminaryToolPage` — a new `ProductImage` section,** placed above the existing
  read-only *Photos* section. The section:
  - uses a radio group of image tiles, with a keyboard-reachable choice per tile;
  - labels the cleaned tile *"Background removed"*;
  - gives every tile a *"From <host>"* link to its page (source attribution);
  - offers *"No image"*;
  - shows, when the item has an uploaded photo, *"Using your photo"* instead of the
    candidates;
  - shows a single line when the stage failed: *"No product image was found"* plus
    the reason, and never an empty frame.
- **The cleaned tile.** It is drawn on a checkerboard so transparency is visible,
  with a one-line note: *"Redrawn by an image model — compare it with the original
  before choosing."*
- **Mobile.** Tiles stack in one column, with the choice first.
- **Strings.** About 14 new keys under `admin.intake.image.*`, English only, per
  Article 6 as amended.
- **Tool editor.** No change. An approved cover is an ordinary tool photo and is
  reordered or deleted there as today.

## 7. Relationship to existing work

- **Supersedes `docs/specs/2026-07-29-ai-gateway-migration-design.md`.** Its phases 1–2
  (centralize, add a Gateway branch) are built; phases 3–5 (key, spend limit, preview
  check, production) are folded into §9 here. Its non-goal "no model change" is
  reversed by Isaac's decision of 2026-09-23.
- **Amends `docs/specs/2026-09-14-v5-data-platform-design.md`:**
  - §3.7: research tools, which are now Exa plus a server-side read, and model
    selection;
  - §4.10: `ResearchResult.images`;
  - §3.6: the new `web` capability;
  - §4.7: the `attachments` columns.
  An amendment in that file points here when this merges.
- **Builds on the 2026-09-23 manual archiving work** (uncommitted on
  `v5/data-platform-phase-8` at the time of writing): `source_url` generalizes its
  `source_key`.
- **Builds on the local Blob folder** (in progress the same day), so the image stage
  works in local dev.
- **Stacks on PRs #35 → #39.** This is built after #39 merges, on a fresh branch from
  `main`.

## 8. Security and safety

- **Authorization.**
  - The image choice is part of approval, which needs `tools.approve` and is checked
    in the server action as today.
  - `read_page` is available only on chat surfaces, and only within the focused tool's
    hosts.
- **Rate limiting and cost (Article 4).** Research keeps 25 items per request and 100
  per person per day. Approximate costs per researched item:

  | Stage | Cost |
  |---|---|
  | Search: up to 4 Exa calls | a few cents, depending on Exa pricing (§11) |
  | Read | fractions of a cent on Luna |
  | Rank | under 1¢ |
  | Clean | about 1–2¢ |

  The Gateway's spend limit (§9, Phase 5) is the ceiling.
- **SSRF** is the new risk, because the server now reads bodies of URLs a model
  proposed. Guarded by `readPage` (§3.3):
  - the scheme is checked;
  - private and link-local addresses are refused after DNS, at every redirect;
  - sizes and times are capped.

  At approval, only a URL that research recorded can be downloaded.
- **Prompt injection.**
  - *Research reading:* the read step's model has **no tools**, and page text is
    fenced as data with the existing injection paragraph.
  - *Chat:* `read_page` output is fenced the same way.
  - *Ranking:* the ranking model sees images and a name only, and its output is a
    permutation plus reasons.
  - *Approval:* a human chooses, and nothing publishes without approval (Article 5).
- **Generated images.**
  - A cleaned copy is a redraw, not a crop, so it is never chosen silently and is
    always shown beside its original.
  - It is private until chosen and released if not.
- **Copyright.** Manufacturer product photos are used for an internal lab inventory,
  with the source page recorded (`source_url`) and linked on the review page. The
  admin's own photo always wins.
- **Secrets.** There is no AI key in production (OIDC). `AI_GATEWAY_API_KEY` stays
  local and is never logged; error messages name environment variables, not values.
- **PII.** None added. Item names and page text go to the model, as today. No person's
  name or email reaches any new call.

## 9. Phased build order

Each phase is its own PR and leaves `main` deployable.

| # | Phase | Delivers | Depends on |
|---|---|---|---|
| **0** | Live check (people plus a script, not merged code) | With a real Gateway key, confirm six things and record the results as an amendment. If Luna fails a check, that job keeps a named fallback model for its default. | This spec |
| **1** | Registry, Gateway only | `src/lib/ai/models.ts`; every call site uses it; `ANTHROPIC_API_KEY` path removed; `AI_GATEWAY_BASE_URL` for stubs. **Defaults stay `anthropic/claude-sonnet-4.6`** so this phase changes plumbing, not behaviour | 0 |
| **2** | Provider-neutral tools | Exa in chat and research search with our caps; `readPage` + the `web` capability; research read step reads server-side; `cacheControl` removed; tests and E2E stub moved to the Gateway wire format | 1 |
| **3** | Luna | Evals run on Luna vs the current model. Research, rank and image jobs switch to Luna; chat switches if the gate passes (§10), else chat stays on a named stronger model and the result is recorded | 2 |
| **4** | Image stage | `findImages` step; `ResearchResult.images`; migration `0008`; the cleaned copy | 2 (3 in parallel) |
| **5** | Review and approval | `ProductImage` section; approval `image` input; warnings; docs and deploy notes; the Gateway spend limit set in Vercel | 4 |

The six Phase 0 checks:
1. Luna calls tools.
2. `exa_search` executes through the Gateway with Luna, and returns `image` and
   `imageLinks`.
3. Luna reads a PDF file part.
4. `gpt-image-1-mini` edits an input image and returns a PNG with alpha.
5. OIDC authentication works on a preview deployment.
6. What Exa costs per call.

Phases 1–3 and 4–5 can be split across people. Phase 4 needs Phase 2's `readPage`.

## 10. Testing

Every layer runs with no environment variables and no network (Article 3).

- **How models are stubbed changes.** Unit and integration tests stub at the AI SDK
  boundary with `MockLanguageModelV3` and `MockImageModelV3` from `ai/test`, instead
  of `vi.mock("@ai-sdk/anthropic")`. Nothing in a test knows the provider.
- **The workflow tier and E2E** stub the Gateway's HTTP endpoint:
  - MSW for the workflow-tier test;
  - `e2e/stubs/gateway-stub.ts` for Playwright, which replaces `anthropic-stub.ts`.

  Both use the Gateway wire format captured as fixtures in Phase 0.

**Unit.**
- `modelIdFor`: defaults, overrides, a malformed override naming the variable, and an
  unknown job.
- The Exa call cap in `prepareStep`, for chat (5) and research (4).
- `readPage`:
  - text extraction;
  - `og:image` / `twitter:image` / JSON-LD extraction, including JSON-LD arrays and
    `@graph`;
  - size and time caps;
  - redirects;
  - **private, loopback, link-local and metadata addresses refused, including after a
    redirect.**
- Candidate de-duplication and filtering (size, type, decode).
- Ranking output parsing: a permutation with bad indexes is rejected.
- Cleaned-image check: a PNG without alpha, or an undecodable result, is dropped.
- `ResearchResult` parses rows **without** `images` (old rows) and with them.

**Integration** (PGlite, MSW).
- **Research step with a mocked model:**
  - pages are read server-side and fenced;
  - the read step passes no tools.
- **`findImages`:**
  - skipped with an uploaded photo;
  - no candidates;
  - three candidates ranked;
  - cleaning fails, with candidates still recorded;
  - the stage throws and the item is still `researched`.
- **Approval:**
  - `original` from the candidate list is stored public at the cover position, with
    `source_url`;
  - `original` with an unrecorded URL is `invalid_field`;
  - `cleaned` goes through `copyToPublic`;
  - `none` releases the cleaned copy;
  - a download failure answers `image_not_attached` and the tool still exists;
  - migration `0008` backfills `source_url` on archived manuals.
- **Chat route:**
  - `exa_search` and `read_page` are present;
  - there is no `anthropic` provider option anywhere in the request;
  - PDFs are file parts.

**Component.** `ProductImage`: every state (uploaded photo, candidates with cleaned,
no cleaned, none found, failed), keyboard selection, the checkerboard, the attribution
link.

**E2E.** Scenario 5 (intake) runs against the Gateway stub. The stub's research
answers include image hints, and the test picks the cleaned copy and asserts the
gallery card shows it.

**The chat eval gate (Phase 3).** Luna must pass:
- every **honest-absence** and **manual-grounding** case;
- all but one of the rest.

Run it twice to rule out flukes. The eval harness stays outside `test:all`.

**Cases that would embarrass us in production.**
- A model id typo takes chat down and the logs show the key instead of the variable
  name.
- The assistant invents a machine because the cheaper model ignores the catalogue.
- A research page makes our server fetch `http://169.254.169.254/`.
- A cleaned image quietly changes a machine's control panel, and nobody was shown the
  original.
- An admin's own photo is replaced by a stock image.
- The cover says "photo attached" when the download failed at approval.
- Chat stops answering in the visitor's language on the cheaper model.

## 11. Open questions

| # | Question | Recommendation | Who | By |
|---|---|---|---|---|
| 1 | **Exa's price through the Gateway** per search with contents | Measure in Phase 0; if >1¢ per call, drop research to 3 searches | Isaac | Phase 0 |
| 2 | **Transparent output through the Gateway** — does `providerOptions` reach OpenAI's `background: "transparent"`? | Verify in Phase 0; if not, try `recraft/recraft-v4.1-utility`, else ship without cleaning (original only) | Isaac | Phase 0 |
| 3 | **Chat model if Luna misses the eval gate** | `openai/gpt-6-sol` or `anthropic/claude-sonnet-5` — whichever passes cheaper | Isaac | Phase 3 |
| 4 | **Backfilling images for the imported inventory** | Not now; a script over `tools` without a cover, run by hand, if the lab wants it | Isaac, Niti | After Phase 5 |
| 5 | **HTML-to-text dependency** | Prefer something already in the tree; otherwise propose one small, maintained package in the Phase 2 PR | Isaac | Phase 2 |

Settled on 2026-09-23 (Isaac):
- Gateway only.
- Exa for search.
- Per-job defaults in code with environment variable overrides.
- Luna as the default.
- Cleaning during research, for the top pick only.
- Store only the chosen image.

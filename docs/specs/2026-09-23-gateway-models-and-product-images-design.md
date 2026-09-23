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

---

## Amendments

Appended per [`DRIFT.md`](DRIFT.md). Original text above is never edited — the reason a
design changed usually outlives the change.

### 2026-09-23 — Phase 0 results (as-built)

**What changed.** Nothing in the design — every check the spec asked Phase 0 to run
**passed**, 6/6, and answers open questions 1 and 2 directly. Recorded here so the
decisions above aren't read as guesses that were never checked.

**Luna tool calling** (§9 phase 0, open question 3's precondition). `generateText` with a
zod `inputSchema` tool and `stopWhen: stepCountIs(3)` ran two steps — a tool call, then a
text answer that reproduced the tool's own returned values rather than inventing them.
Luna calls tools and reads their results correctly.

**`gateway.tools.exaSearch` executes through the Gateway with Luna, and is cheap.**
`{numResults:3, contents:{highlights:true, extras:{imageLinks:3}}}` cost **$0.007/call**,
confirmed three independent ways (the tool result's own `costDollars.total`, the surrounding
call's `providerMetadata.gateway.cost` minus `inferenceCost`, and `getGenerationInfo`). That
is well under open question 1's 1¢ threshold, **so research keeps its planned 4
searches/item** (§3.2) rather than dropping to 3 — even 4 stays at roughly 2.8¢. One HTTP
request left our process per `generateText` call regardless of how many legs the Gateway ran
server-side (visible only via `providerMetadata.gateway.routing.modelAttempts[0]
.providerAttemptCount`); `numResults` in the factory config is an enforced cap independent of
whatever the model's own tool-call input asks for. Every result carried both `image` and a
non-empty `extras.imageLinks` — the exact fields the image stage's candidate step needs.

**Luna reads a PDF file part** with no URL and no upload — raw bytes inline — and answered
correctly from a fact that existed nowhere else in its context. The research read step's
design (page text and PDF bytes handed to the model directly, no fetch tool) works as
specified.

**`gpt-image-1-mini` edits a real image and returns a genuine alpha channel**, confirming
open question 2: `providerOptions.openai.{background:"transparent", output_format:"png"}` —
the spec's exact shape (§3.5) — reaches OpenAI's API through the Gateway untouched (OpenAI's
own response metadata echoed back `background:"transparent"`), and the result is really
transparent (56.7% of pixels alpha < 250, not just an all-255 channel dressed up as one). No
fallback to `recraft/recraft-v4.1-utility` was needed. **Cost was $0.050808/call** at the
default size (1536×1024, quality "high", no `size` set) — well above what a cover thumbnail
needs. **Recommendation:** request a smaller explicit size — 1024×1024 at quality "medium" —
for the production call, which should cut this cost materially; Phase 0 did not measure that
exact combination's price, so treat the saving as directional until a build confirms it, not
as a verified number the way the $0.050808 figure above is.

**Wire format.** Every request from a Phase-0-style `createGateway({ fetch })` call carried
`ai-gateway-auth-method: oidc`, confirming `VERCEL_OIDC_TOKEN` is read and used when no
`AI_GATEWAY_API_KEY` is set. **This was exercised entirely locally, reading a token pulled by
hand** (`vercel env pull`) — **a real Vercel preview deployment's own OIDC injection was not
exercised**, and remains the first real check `docs/deploy.md`'s Part 2 step 3 asks for.
Sanitized wire-format fixtures for every request/response shape used here (streaming +
tool, non-streaming, `exaSearch`, `generateImage`, plus `getGenerationInfo`) became
`v5/test/gateway/fixtures/`.

**Status.** Accepted. No design change; §3.2's 4-searches/item figure and §3.5's transparent-
background `providerOptions` shape are both now verified rather than assumed, and OIDC in an
actual deployment is the one item the spec's own testing section (§10) should still treat as
unverified until someone sends that first preview-deploy message.

### 2026-09-23 — build notes (Parts a–e and integration)

**What changed.** Nothing the spec itself specified differently — these are implementation
details Parts a–e settled while building §§3–10, worth recording so the next reader does not
have to reconstruct them from a diff.

- **The cleaned-image route** is `GET /api/pending-tools/[id]/cleaned-image` (§3.5, §6):
  streams the private cleaned PNG to a reviewer holding `tools.approve`, rate-limited, 404
  otherwise. The `ProductImage` group's cleaned tile points its `<img src>` at it directly.
- **`READ_PAGE_TEST_ORIGIN`** (§3.3, test-only) is a new env var: one exact origin the SSRF
  guard (`src/lib/web/address-guard.ts`) exempts from its loopback/private-address refusal,
  so the research read step's and the chat's `read_page` fetches can reach a local Playwright
  stub. Ignored whenever `VERCEL` is set, so it has no effect in any real deployment.
- **Cleaning is skipped without a Blob store**, not attempted and failed. `findImages`
  checks for a configured store before calling the image model at all; with none, the stage
  still ranks and records the research candidates, just with `cleaned: null`. This is the
  branch every deployment without a store is permanently in — never a paid call nobody can
  use the result of.
- **The intake E2E has its own server, with a local Blob folder** (integration). §10's
  scenario 5 runs as written — the stub's `/image-model` returns a transparent PNG, the
  review page preselects "Background removed", the test approves it and asserts the gallery
  card shows the published copy. To get there without giving the main E2E server a store
  (`projects.spec.ts` asserts the "uploads unavailable" branch), Playwright starts the same
  production build a second time on port 3103 with **`BLOB_LOCAL_DIR`** — a new test-only
  env var that moves the local store's folder (`.blob-data-e2e/`, git-ignored) and is the
  one thing that allows the local store in a production build. `blobMode()` still never
  honours it on Vercel. The second process also has its own demo database, so the approved
  tool no longer touches `gallery.spec.ts`'s count. (An earlier draft of these notes
  recorded an "E2E deviation" asserting only the uncleaned path; superseded by this.)
- **Link verification now goes through the SSRF guard** (integration; §8). The research
  read model may only cite links it was given, but a page it read can list an internal URL
  as a resource, and `verify-links.ts` used to `fetch` every resource URL directly — the
  §10 "our server fetches `http://169.254.169.254/`" case. It now uses `guardedFetch`
  (first byte only; YouTube's fixed oEmbed host unchanged): a private, loopback or metadata
  address, directly or after a redirect, drops the link as "refused (not a public web
  address)" without a request. Statuses keep their old meaning (404/410 drop, everything
  else keeps).
- **`sharp` is used when present, not a dependency.** `src/lib/research/images/downscale.ts`
  loads it through a guarded dynamic `import("sharp")` to shrink images for ranking (JPEG,
  ≤768 px) and cleaning (PNG, ≤1024 px); `next build` treats it as an external, and it
  resolves from `node_modules`, where it is Next's optional dependency (0.34.5) — not in
  `package.json`. Without it, ranking sends originals of at most 1.5 MB (larger ones are
  ranked last, unseen) and cleaning sends the original. Adding `sharp` to `package.json`
  is proposed, pending approval. `src/lib/images/inspect.ts` (dimension and alpha checks)
  stays dependency-free.
- **The clean call's size and quality** are set to 1024×1024 and "medium" per the Phase 0
  recommendation (`CLEAN_SIZE`, `CLEAN_QUALITY` in `images/clean.ts`), **not live-verified**:
  check the Gateway cost report after the first real runs.
- **`read_page` does not hand PDFs to the chat model.** A manual PDF that was not attached
  (the server-side fetch failed) is now a link the model is told to give the student, where
  Anthropic's `web_fetch` used to let it read the PDF itself.
- **Research read with no readable page** makes no model call: the search's candidate links
  are kept as resources (still link-verified) with no `sourceUrls`, so the grade cannot be
  high (`draftFromFindings(findings, { keepCandidateLinks: true })`).
- **The DNS-rebinding residual risk.** `guardedFetch`'s SSRF guard (`src/lib/web/address-guard.ts`,
  `guarded-fetch.ts`) resolves a host and checks the resolved address before connecting, but
  does not pin the TCP socket to that address — a host that resolves to a public address at
  check time and a private one at connect time (a classic DNS-rebinding race) is not fully
  closed by this design. Documented in the module, not fixed: closing it needs either a custom
  `dns.lookup` passed to `fetch`'s agent or a lower-level HTTP client, both larger changes than
  this migration's scope.

**Status.** Descriptive. None of the above changes what the spec asked for; each is a
decision the implementation had to make that the spec left open, recorded here per
`DRIFT.md` rather than left to be reconstructed from the code later.

### 2026-09-23 — The chat eval gate (§9 Phase 3, §10, open question 3)

**What changed.** Chat's default model is `anthropic/claude-sonnet-5`, not Luna. §2 made
Luna for chat conditional on the §10 gate. Luna failed the gate, so this is the "else"
branch of §9 Phase 3: chat stays on a named stronger model. Research, image ranking and
image cleaning stay on Luna and `gpt-image-1-mini`.

**How it was run.** `EVAL_MODEL=<id> npm run eval`, twice per model, against the real
Gateway with a pulled OIDC token. The case set has 13 cases: honest-absence 3,
manual-grounding 4, catalogue lookup 3 and tool calling 3. Each case gets one retry.
FAIL means both attempts failed. FLAKY means the case passed only on the retry.

| Model | Run 1 | Run 2 | Hard cases (honest-absence and manual-grounding) | Gate |
|---|---|---|---|---|
| `openai/gpt-6-luna` | 11/13 (FAIL `trotec-sop-cited`, `issue-report-calls-tool`) | 11/13 (same two) | `trotec-sop-cited` failed 4 of 4 attempts | **Fails** |
| `openai/gpt-6-sol` | 10/13 (FAIL `trotec-sop-cited`, `maintenance-history-calls-tool`, `issue-report-calls-tool`) | 10/13 (same three) | `trotec-sop-cited` failed 4 of 4 attempts | **Fails** |
| `anthropic/claude-sonnet-5` | 12/13 (FAIL `issue-report-calls-tool`) | 11/13 (FAIL `issue-report-calls-tool`, FLAKY `bambu-printer-absent`) | All manual-grounding cases passed on both runs. One honest-absence case passed only on retry in run 2 | Closest; see below |

Sonnet 5 does not strictly pass either. `evals/README.md` counts a FLAKY hard case as a
miss. The first attempt at `bambu-printer-absent` ended with "If the lab does have a
Bambu X1-Carbon and it's just missing from the catalog…". That was an honest conditional,
but it carries none of the denial cues that `no_unknown_tools` looks for. It is still the
only model that passed every manual-grounding case, and it answered every honest-absence
case correctly on at least one attempt. Luna and Sol invented nothing, but both failed to
cite the Trotec SOP every time. So Sonnet 5 is the default. **Isaac owns open question
3**, and can confirm the choice or override it with `MODEL_CHAT` without a deploy.

**Two harness bugs found on the way, both fixed before the gate was scored:**
- *The suite could not start.* `getCatalogTools()` is a `"use cache"` function. Outside a
  Next build its `cacheTag` throws, and `evals/vitest.config.ts` has no setup file that
  could mock it. The first attempted gate run died in setup, before any model call.
  `next/cache` is now aliased to a no-op stub (`test/mocks/next-cache-noop.ts`) for the
  eval runner only.
- *Typographic apostrophes defeated the denial check.* Luna writes "don’t" with U+2019.
  The `n't` cue in `evals/assertions.ts` never matched it, so an honest "I don’t see a
  waterjet cutter in the MakerLab catalog" was scored as an invented machine. The first
  Luna run, before this fix, showed 8/13, with all three honest-absence cases failing for
  this reason alone. `normalize()` now straightens ‘ ’ ʼ, and a unit test pins it.

**One case to look at, not fixed here.** `issue-report-calls-tool` failed on every run of
every model. The eval has no signed-in identity, so the maintenance capability's prompt
tells the model to ask for the student's name before filing. Every model did exactly that.
As written, the case cannot pass in a single turn. It needs either a signed-in identity in
its context or a second turn.

**Status.** Accepted pending Isaac's confirmation of open question 3. Re-run the gate on
Luna when the case set or the chat prompt changes. Switch chat back when a cheaper model
passes.

### 2026-09-23 — Review fixes: caps and SSRF (§3.2, §3.3, §3.4, §5.2, §8)

**What changed.**
- **§3.2 "Caps become ours": for research, the cap is advisory.** The research search
  step's only tool is the provider-executed `exa_search`. For that shape `generateText`
  makes exactly one request, because the SDK only starts another step for *client* tool
  calls. A `prepareStep` therefore runs once, before anything has been counted, and cannot
  withdraw the tool part-way. Neither the Gateway nor Exa takes a per-request call limit.
  What bounds research's searches is the prompt ("at most 4 times"), `numResults` per
  search (enforced by the Gateway, Phase 0), the step's 240-second deadline and the
  Gateway spend limit. The step now counts the searches afterwards and logs an overshoot
  (`[research] <request id>: the search ran exa_search N times, over its budget of 4`).
  It no longer claims a `prepareStep` cap. Chat keeps `prepareStep`, which does work there
  because its client tools make the SDK loop.
- **§3.3: `read_page`'s cap of 5 per turn is enforced inside the tool.** `prepareStep`
  runs only between steps. One step can hold any number of parallel `read_page` calls,
  and the SDK executes all of them. Each call now takes a slot from a per-turn budget,
  keyed on the turn's capability context, before it does anything else. Past the cap it
  refuses with `cap_reached` without fetching. `exa_search` inside one Gateway step has
  the same gap, and it cannot be closed from our side.
- **§5.2: Add unit releases the item's cleaned copy.** `approvePendingAsUnit` re-owned
  every attachment of the item to the existing tool. That included a private
  `research_image_cleaned` redraw that nobody chose, which then became a photo of a
  published tool. It is now released to the orphan sweep first, as approval already did
  for every unchosen copy.
- **§8 SSRF: two more server-side GETs go through `guardedFetch`.** They are the manual
  archiver (`manuals/archive.ts`: 25 MB, 30 s, up to 5 redirects each re-checked, and
  markup refused on its headers through a new `refuseTypes` option) and the chat's
  download of a manual from the resource's source link (`chat/fetch-manual-pdf.ts`:
  10 MB, streamed and cut off rather than buffered whole). Both now require the `%PDF-`
  magic bytes before the bytes are stored or given to the model as `application/pdf`.
  The app's own Blob copies (an archived manual or an uploaded file) are still fetched
  plainly. Nobody outside the app chose those URLs, and in local development they are
  `localhost` URLs that the guard would refuse. A manual link that research verified as
  public, and that later redirects inward, is now `blocked` at archive time
  (`reason: "blocked"`, not retried) and is not attached in chat.

**Status.** Accepted. §10's "The Exa call cap in `prepareStep`, for chat (5) and research
(4)" now reads: for chat (5), in `prepareStep`; for research (4), a pinned budget that is
logged when exceeded.

### 2026-09-23 — No generative redraw: deterministic cutout (§2, §3.1, §3.5, §4.1, §5.1, §6, §8, §10)

**What changed.** The cleaned copy of rank 1 is no longer made by an image model. It is a
deterministic, pixel-preserving cutout in code (`v5/src/lib/research/images/clean.ts`), and
only for a candidate on a plain light backdrop. The `imageClean` job is gone from
`MODEL_JOBS`, along with `imageModelFor` and `MODEL_IMAGE_CLEAN`. No call in the app uses an
image model now. Isaac's decision, 2026-09-23.

**Why: the live comparison.** The same product photos were cleaned live through the Gateway.
`openai/gpt-image-1-mini` redraws the product rather than cutting it out, and it corrupted
printed labels at both **medium and low quality**: "DREMEL 3000" came back as "DREMEL GOGO".
That is the §10 case "a cleaned image quietly changes a machine's control panel" happening
for real. It fails the tool at its one job, since a catalogue cover that misspells the brand
is worse than no cover. §8's safeguards (shown beside the original, never chosen silently)
make it catchable, not acceptable. The open-question-2 fallback,
`recraft/recraft-v4.1-utility`, **cannot take an input image through the Gateway**, so it
cannot edit a photo at all. With no generative option that keeps the product intact, the
redraw is dropped.

**The design, as built.**
- **Classify while probing** (`images/background.ts`). Each probed candidate is decoded by
  `sharp` at ≤512 px, and its border band (about 1% of the short edge, 2–6 px) decides its
  class. The class is recorded on the candidate as `background` (§4.1 below).
  - `transparent`: at least **85%** of the band has alpha < 16.
  - `plain`: the band's median colour has luma ≥ **190** (white, off-white or light grey),
    and at least **85%** of the band lies within RGB distance **48** of that median.
  - `busy`: anything else, including dark studio backdrops. The cutout removes light
    backdrops only.
  - Unknown (null, key absent) when `sharp` is missing or the bytes do not decode.
- **Ranking prefers clean shots.** Each image in the prompt is labelled
  `Image N (background: <class>)`, and the system prompt says to prefer transparent or
  plain over busy when the machine is shown equally well. In code, `preferCleanBackgrounds`
  moves a `busy` image **1.5 places** down the model's order (`BUSY_PENALTY`). A busy #1
  then loses to a clean #2 but keeps its place ahead of a clean #3. The model's judgement of
  *which machine* still dominates, and a clean shot wins a close call. Unclassified images
  are neither helped nor held back.
- **Clean rank 1 only when it is `plain`** (§3.5 step 4 now reads this way). The cutout
  works on the image at ≤1024 px:
  1. **Flood fill.** The fill starts from every pixel of the outer ring that is within
     **40** of the border's median colour. It spreads 4-connected into a neighbour that is
     either within 40 of the backdrop, or within **10** of the pixel it came from and no
     more than **72** from the backdrop. The second rule lets a soft gradient or shadow be
     followed while a product edge stops the fill. Only what connects to the frame becomes
     transparent, so a white panel enclosed by the product stays.
  2. **Specks.** Product islands smaller than 0.05% of the frame are treated as JPEG noise
     and join the backdrop.
  3. **Validation.** A failed check makes the cut `cleaned: null` with a `cleanNote`. It
     never throws.
     - `little_background`: under **15%** was removed, so there was nothing to remove.
     - `product_removed`: over **92%** was removed, so the cut ate the product. This is
       what a white machine on a white floor produces.
     - `product_too_small`: the product box covers under 4% of the frame, or under 10% of
       either side.
     - `fragmented`: more than **4** pieces each larger than 1% of the frame remain.
     - `busy_background`: the 1024 px copy is re-classified and is not plain.
     - `failed`: the image could not be decoded or encoded.
  4. **Feather and trim.** The product's outermost ring gets alpha ≤160 and the next ring
     ≤224. Both are lowered further where the pixel's colour is close to the backdrop,
     because that is what a halo is. RGB is untouched everywhere; transparent pixels take
     the backdrop colour so resampling does not darken the edge. The result is trimmed to
     the product box plus a margin of 2% (4–24 px) and saved as PNG with alpha.
- **Transparent means already clean.** A `transparent` rank 1 gets **no stored copy**
  (`cleaned: null`, no note). Its tile is the rank-1 "Option 1" tile, drawn on the
  checkerboard with the note *"Already on a clean background"*, and preselected as today
  (§5.2: rank 1 when there is no cleaned copy). Approving it is the ordinary `original`
  choice: the original is downloaded and stored with its alpha intact. Nothing new is
  stored before approval, and nothing new happens at approval.
- **Busy means no cut.** A `busy` rank 1 is recorded with `cleaned: null` and
  `cleanNote: "busy_background"`. The admin sees the originals, with one line saying why.
- **Storage, approval and release are unchanged.** It is the same private
  `research/cleaned/` blob, `origin: "research_image_cleaned"`, `copyToPublic` on choice,
  and released if not chosen. Without a Blob store nothing is cut, as before. The cut is
  now free, but there is nowhere to keep it.

**§4.1 gains two optional fields.** Rows written before this change parse unchanged, since
neither field has a default.

```ts
// ImageCandidate
background?: "transparent" | "plain" | "busy";   // absent: before this change, or unreadable
// ResearchImages
cleanNote?: "busy_background" | "little_background" | "product_removed"
          | "fragmented" | "product_too_small" | "failed" | null;
```

**§6 wording.** The cleaned tile's note no longer reads *"Redrawn by an image model —
compare it with the original before choosing."* It now reads *"Background removed
automatically: only the plain backdrop was cut away, the product is the original's own
pixels."* The tile is still labelled *"Background removed"* and is still shown beside the
original. There are two new strings:
- `alreadyClean`: *"Already on a clean background"*.
- `cleanNote.*`: one line per note, each beginning *"The background was not removed:"*.

**§8 "Generated images"** no longer applies to anything the app makes. The cutout is a
crop with an alpha channel, not a generated image. Showing it beside its original stays,
because the cut can still take too much or too little.

**§2 and §3.1.** "Image cleaning, which defaults to `openai/gpt-image-1-mini`" and the
`imageClean` row of the job table are withdrawn. `languageModelFor` covers every job.
`test/gateway/wire.ts` keeps its image-model builders, and one wire round-trip test still
checks them against a model built by id, for the Phase 0 fixtures.

**§10.** "Cleaned-image check: a PNG without alpha, or an undecodable result, is dropped"
becomes the cutout suite, all synthetic and built with `sharp` in the test with no network
(`background.test.ts`, `clean.test.ts`, `image-steps.test.ts`, `rank.test.ts`,
`approval-image.test.ts`, `ProductImage.test.tsx`):
- a product on white is cut with its interior pixels unchanged;
- an enclosed white panel survives;
- a white body filling the frame is rejected as `product_removed`, and a white base on a
  white floor never costs the product;
- a JPEG-noisy off-white gradient is classified plain and cut;
- a transparent PNG is `transparent` and gets no cut;
- noise, a dark-to-light gradient, a wood-grain table and a dark backdrop are `busy`;
- ranking puts a plain #2 over a busy #1;
- a transparent original approves with its alpha intact.

The intake E2E's stub now serves a product on plain white instead of answering
`/image-model`, and the scenario still preselects and publishes "Background removed".

**Cost.** Cleaning costs nothing now. The $0.05 per call from Phase 0, and the
not-live-verified 1024×1024/medium setting in the build notes, no longer apply.

**Status.** Accepted (Isaac, 2026-09-23). This supersedes the Phase 0 amendment's
`gpt-image-1-mini` finding *as a design choice*, though not as a record of what Phase 0
measured. It also supersedes the build notes' `CLEAN_SIZE` / `CLEAN_QUALITY` bullet. The
thresholds above are first settings, tuned only on synthetic images. Check them against the
first real research runs. If too many plain shots come back `product_removed` or
`little_background`, the fill tolerance (40) and the removed-share limits are the knobs.

### 2026-09-23 — Composites and product crop (§3.5, §4.1, §6, §10)

**What changed.** Rank 1 may now be **cropped to the product** before its backdrop is
cut. It is still never redrawn: a crop is a rectangle of the original's own pixels. This
reverses §2's non-goal "Editing or cropping images in the app" for the cleaned copy only;
the admin still only picks or rejects.

**Why: the Makera Carvera Air run.** All three candidates were makera.com store banners: a
price bar ("Carvera Air Standalone $2,199"), the machine in the middle, promotional tiles
below. The page's JSON-LD `ProductGroup.hasVariant[].image` lists six of these, while the
clean studio shots sit in its gallery `<img>`s, which the stage never read. The cutout
rejected the banner (`fragmented`), so the admin got only the banner.

**The design, as built.**
- **More candidates** (§3.5 step 1; `web/html-text.ts`, `images/candidates.ts`,
  `web/image-url.ts`).
  - Each read page's large `<img>` / `<picture><source>` pictures are collected as a new
    source, `gallery`: the largest `srcset` entry, lazy attributes included, at most 12
    per page. Only pictures inside `<main>`/`<article>` count when the page has one.
    Icons, logos, SVG/GIF, `data:` URIs and anything under 300 px by its attributes (or
    400 w by its `srcset`) are skipped.
  - JSON-LD `ProductGroup` (and `ProductModel`, `IndividualProduct`) counts as a product.
  - An `http` image on an `https` page is upgraded to `https`, as a browser would upgrade it.
  - Order: `og`, then `twitter`, then JSON-LD and gallery **interleaved**, so a JSON-LD
    list of banners cannot crowd out the gallery. Exa still only tops up.
  - De-duplication treats size variants as one picture: `width`/`w`/`h`/`crop`/`dpr`/`v`…
    query parameters and Shopify's `_640x` / `_2048x2048` / `_grande` / `@2x` suffixes.
  - `IMAGE_MAX_CANDIDATES` goes from 8 to **10**, and `IMAGE_MAX_RANKED` from 6 to **8**.
- **Ranking also judges each image** (`images/rank.ts`). The answer gains
  `images: [{ composite, productBox }]`, one per image in index order.
  - `composite` means a price, text or badge overlay, a banner, a collage, several
    products, or a scene with the machine small in it.
  - `productBox` is `[x0, y0, x1, y1]`, normalised 0–1.
  - The field is optional and read leniently: missing, or the wrong length, means "no
    composites, no boxes". The order stays strict.
  - A box is validated strictly (`crop.ts`'s `parseProductBox`): four finite numbers,
    `0 ≤ x0 < x1 ≤ 1`, `0 ≤ y0 < y1 ≤ 1`, and an area of at least **4%**. Anything else
    is no box.
  - In code, after the busy nudge, **every composite goes below every non-composite**
    (`demoteComposites`), so a clean gallery shot wins whenever one exists. A composite
    candidate is recorded with `composite: true`.
- **Crop, then cut** (`images/clean-copy.ts`, `images/crop.ts`). Rank 1 is cropped when it
  has a box, **and** it is a composite, or is `busy`, or the box covers under **80%** of
  the image. The padded crop must also leave out at least 10% of the picture.
  1. The original, EXIF-rotated and read at ≤2048 px, is cropped to the box padded
     **4%** per side, clamped, and saved as PNG at ≤1024 px.
  2. The crop is classified again. If it is `plain`, it is cut. The cut is told where the
     box is (`protect`): inside the box the fill only takes pixels within **12** of the
     backdrop and follows no gradient. A white base a shade off a white backdrop (240 on
     254) stays, where the unguided fill ate it along with the "C" of "CARVERA".
  3. If the crop's edge is not plain, or the cut fails its checks, padding is tried again
     at **2%**, then **1%**. A banner's price bar reaching into a 4% margin is the usual
     reason.
  4. If no cut passes, the crop is kept alone at 2% padding: `kind: "cropped"`, with
     `cleanNote` giving the reason the backdrop stayed. A transparent crop is kept as it is.
  5. With no box, or no reason to crop, the behaviour is as before. The one difference:
     a box that the crop did not use still guards the cut.
- **§4.1 gains two optional fields.** Old rows parse unchanged.

  ```ts
  // ImageCandidate
  source: "og" | "twitter" | "jsonld" | "gallery" | "exa";
  composite?: boolean;
  // ResearchImages.cleaned
  kind?: "cut" | "cropped" | "cropped_and_cut";   // absent = "cut"
  ```
- **§6.** The cleaned tile's label follows `kind`:
  - "Background removed" (a cut, as before; the E2E still finds it by this name);
  - "Cropped and background removed" (on the checkerboard);
  - "Cropped to the product" (no checkerboard, a note that the background stays).

  Composite candidates carry a small **"Banner"** tag beside their label, so each
  radio's name stays "Option N". The new strings are English only, under
  `admin.intake.image.*`.

**Live check** (throwaway script, real network, Luna through the Gateway, about 1¢ for
three ranking calls). `https://www.makera.com/products/carvera-air` now yields 10
candidates: the upgraded `og:image`, five JSON-LD banners and four gallery shots.
- Luna marked every banner `composite: true` with a sensible box. It ranked the gallery
  shot `air-3.jpg` first, and the crop-and-cut came out clean, base and lettering intact.
- Restricted to the six banners (the original failure), rank 1 was cropped. The 4% crop
  caught the price bar, so the 2% crop was used, and it was cut to the machine alone.
  Only a few faint floor-reflection pixels remain under one corner.

**§10.** New tests, all synthetic or HTML fixtures, with no network:
- gallery extraction (`srcset`, lazy attributes, furniture filtering, `<main>`
  preference, the Shopify variants, the http upgrade) and `imageIdentity`;
- interleaving and variant de-duplication in `collectCandidates`;
- `images` parsing, box validation, and composites ranked below clean shots;
- the crop maths (padding, clamping, pixel rounding) and `cropToBox`;
- crop → plain → cut; crop → busy → crop only; a failed cut → crop only with its note;
- the padding fallback, and the protected white base;
- a synthetic banner (price bar, product on white, tiles) cropped and cut to the product
  alone, including through `findImages`;
- the three tile labels and the Banner tag.

**Status.** Accepted. The thresholds (4% padding, then 2% and 1%; 80% box share; 10%
minimum gain; protected tolerance 12) are first settings, checked on one real product
page. Tune them against the next real runs.

### 2026-09-23 — Product-page first, front-facing images, reviewer notes (§3.3, §3.5, §4.1, §5.1, §6, §8, §10)

**What changed.** Research now aims for the manufacturer's own product page, the image
stage prefers front-facing pictures from that page, and a reviewer can correct research
from the preliminary page: **Research again** takes an optional note, and a new **Find a
different image** reruns the image stage alone, with its own optional note.

**Why: the Bambu Lab X2D run (Isaac).** Research read Bambu's wiki manual pages
(`wiki.bambulab.com/en/x2d/manual/first-print`) and a YouTube video instead of the X2D
product page on bambulab.com. The draft had a two-sentence description and "specs aren't
confirmed against a page that was read", its sources were youtube.com alone, and every
image candidate was a back or side view from the wiki. The chosen cover was the back of
the printer. The reviewer had no way to tell research what it got wrong except to rename
the item.

**The design, as built.**
- **Search aims at the product page** (`research/prompt.ts`). A new shared paragraph,
  "Which sources count", ranks sources. The manufacturer's official product or specs page
  on the brand's own domain comes first, then its manual. Wikis, forums, support
  articles, retailers and review sites are secondary. **A video is never the specs
  source.** The search pass is told to search for the official product page first and to
  list it first in `candidateLinks`. The read pass is told to take the description and
  specs from a product page when one was read, and to give every spec it states. The
  evidence paragraph says a video is neither a manufacturer page nor a specs source.
- **The read step always reads the product page when the search found one**
  (`research/source-pages.ts`, `read-pages.ts`'s `candidatePageUrls`, still ≤4 pages). A
  URL is classified from its address alone:
  - `product`: a host whose name carries the brand (the squashed brand, or a distinctive
    word of it, so `prusa3d.com` for "Prusa Research" but not `researchgate.net`) and a
    path that names a product or its specs. That means `/products/`, `/product/`, `/specs`
    or `/tech-specs`, or a path segment naming the model: a word of the name that has a
    digit, such as `/en/x2d`.
  - `manual`: any host whose first label is `wiki`, `support`, `forum`, `help`, `docs`
    and the like, a path segment such as `/manual`, `/wiki`, `/support`, `/forum`, `/faq`
    or `/download`, or a PDF.
  - `video`: youtube.com, youtu.be or vimeo.com.
  - `brand` or `other`: anything else.

  The first `product` link moves to the front, videos move behind every other page, and
  the model's order stands otherwise. Without a brand nothing is reordered except videos.
- **A video cannot satisfy `manufacturerPageFound` or `specsFromSource`** (`assemble.ts`).
  Both are held to "a page that is not a video was read", as `userStatedModel` is held to
  "something was read".
- **Front-facing images** (`images/rank.ts`). The ranking answer's per-image entry gains
  `view`: `front | three_quarter | side | back | top | detail | part | unknown`. It is
  parsed leniently: case and hyphens are forgiven, `rear` means `back`, `close-up` means
  `detail`, and anything else is `unknown`. In code, after the busy nudge and the
  composite demotion, `demotePoorViews` sorts stably by tier within each composite group:
  front and three-quarter first, then side, top and unknown, then back, detail and part.
  So a front view beats a back view the model ranked first, and a composite still never
  beats a plain photo. The system prompt asks for the view and says a back view, a detail
  or a part ranks below any whole-machine front view.
- **Source weighting** (`images/candidates.ts`). Given the item's brand and name, page
  hints are taken in three groups: the brand's product page, then any other page, then
  manual, wiki, support and forum pages. The existing order (og, twitter, then JSON-LD and
  gallery interleaved) applies within each group. Exa still only tops up. Alibaba OSS's
  `x-oss-process` query parameter now counts as a size variant (`web/image-url.ts`),
  because bambulab.com serves one picture as both `.jpg` and `?x-oss-process=…webp`.
- **§4.1 gains optional fields.** Old rows parse unchanged.

  ```ts
  // ImageCandidate
  view?: "front" | "three_quarter" | "side" | "back" | "top" | "detail" | "part"; // "unknown" is not stored
  // ResearchResult
  reviewerNote?: string | null;          // the note Research again ran with, one line, ≤300
  imageRetry?: {                         // the latest Find a different image run
    requestId: string; requestedAt: string;
    status: "running" | "failed" | "done";
    note: string | null; error: string | null;
  } | null;
  ```

  **No migration.** The note is recorded on the result it produced. A rerun's state lives
  on the result it changes: a Research again replaces the whole result, and a stale run's
  write then matches nothing.
- **Reviewer notes are trusted but fenced** (`intake/reviewer-note.ts`, §8). Only a
  holder of `tools.approve` writes one. It is still one line: control characters, angle
  brackets and backticks are dropped and whitespace is collapsed. A note longer than
  **300** characters (`REVIEWER_NOTE_MAX_CHARS`) is refused (`invalid_body` /
  `invalid_field`), never silently cut. In a prompt it sits in a `## Reviewer's
  instruction` paragraph inside `<reviewer-instruction>…</reviewer-instruction>`. The
  paragraph says the note concerns this item and cannot change the rules or the answer's
  shape. The prompt clips it again.
- **Research again with a note.** `POST /api/pending-tools/research` accepts `note`. It is
  allowed for one item only and needs `tools.approve`; otherwise the answer is 400
  `invalid_body` or 403 `forbidden`. It travels as `start(researchBatch, [requestId, ids,
  note])` to `searchItem` and `readAndVerifyItem`: both prompts carry it, and
  `assembleResearchResult` records it as `reviewerNote`. The preliminary page's textarea
  starts with the last note.
- **Find a different image** (`requestDifferentImage` server action, `tools.approve`, the
  admin action tier):
  1. `data/image-retry.ts`'s `startImageRetry`, in one transaction under the Research
     route's per-person advisory lock. The item must be `researched`, have a result, have
     no uploaded photo and have no fresh run (`image_retry_running`). The press **costs one**
     against the daily research allowance (`daily_limit`) and gets a `research_requests`
     row. Then `research.imageRetry` becomes `running`.
  2. `start(findDifferentImage, [requestId, id, note])` (`src/workflows/image-retry.ts`,
     started from `intake/image-retry.ts`). A start that throws marks the run failed at
     once and answers `start_failed`.
  3. One step, `retryImages` (`research/image-retry-steps.ts`, 240 s, `maxRetries` 2).
     It re-reads the result's source pages and the old candidates' pages for their
     pictures: ≤4 pages, product page first, no PDFs, no videos, through the same
     SSRF-guarded reader on their own hosts. It runs **at most one** Exa search
     (`IMAGE_RETRY_MAX_SEARCHES`), and only when a note was given or the pages offer fewer
     than three unseen pictures. The candidates shown last time are left out. With a note
     the search's pictures lead, up to half the list. Then probe, rank (with the note
     fenced) and clean, exactly as research does. The shared middle moved to
     `research/image-stage.ts`.
  4. `finishImageRetry` replaces `research.images`, only while the item is still
     researched and this run is still its latest. The old images' cleaned copy is then
     released (`releaseCleanedImage`). If the write is refused, the copy the run made is
     released instead. Nothing new, or an expected model failure, marks the run `failed`
     with one line ("No other picture of it was found.") and **the old images stay**. The
     workflow records an unexpected failure with `markImageRetryFailed`.
  5. A run still `running` after **15 minutes** (`IMAGE_RETRY_STALE_MS`) is taken as dead
     by both the page and the data layer.
- **§6 UI.**
  - The identity panel gains "Note for research (optional)" (placeholder "e.g. use the
    bambulab.com X2D product page").
  - The Product image section gains **Find a different image** with "What to look for
    (optional)" (placeholder "e.g. a front-facing photo of the whole printer"). It is also
    offered under "No product image was found".
  - Status reads "Starting…", then "Looking for another image…" (the page polls every
    `INTAKE_POLL_INTERVAL_MS` while a run is fresh), or the refusal, or "The search for
    another image did not work: <reason>".
  - When new pictures land, the image choice is re-derived from them. The cleaned tile's
    URL carries `?v=<attachment id>`, so the browser cannot show a replaced copy from
    memory. The intake E2E's src pattern allows it.
  - Tiles carry a small tag only for a poor view: "Back view", "Detail" or "Part".
  - All strings are English only, under `admin.intake.*` and `admin.errors.*`
    (`image_retry_running`, `daily_limit`, `start_failed`).
- **A step module exports only steps.** `image-steps.ts` briefly re-exported a pure helper
  from `image-stage.ts`. The workflow bundle kept that module, and so reached
  `guardedFetch`, Blob and the database, which broke `next dev`'s workflow build ("node:net
  … not available in workflow functions"). Helpers are imported from `image-stage.ts`
  directly, and a comment in `image-steps.ts` says why.

**Live check** (throwaway script in `v5/.livecheck/`, git-excluded, real network and
Gateway, "Bambu Lab X2D", search → read → image stages without the database; about $0.29
in all).

| Run | `researchSearch` | Pages read | Description | Specs | Evidence | Cover | Search cost |
|---|---|---|---|---|---|---|---|
| luna | `openai/gpt-6-luna` | `bambulab.com/en/x2d/specs`, YouTube (`/en-us/x2d` and the support doc answered 403) | 209 chars, 2 sentences | 20 | manufacturer ✓, specs ✓ | three-quarter front, from `store.bambulab.com/products/x2d`, cropped and cut | $0.031 |
| sonnet-search | `anthropic/claude-sonnet-5` | the support doc only (`/en/x2d`, `/en/x2d/specs` and `/en-us/x2d/specs` all 403) | 148 chars | 0 | manufacturer ✓, specs ✗ | the same three-quarter store shot, cropped and cut | $0.222 |
| luna-2 | `openai/gpt-6-luna` | YouTube only (both bambulab.com pages 403) | 281 chars | 0 | manufacturer ✗, specs ✗ (the video grounding working) | front, from the store page | $0.024 |

Both models now put the product page first in `candidateLinks`; Sonnet 5 listed
`/en/x2d` and `/en/x2d/specs` explicitly. **The model is no longer the bottleneck.**
bambulab.com answers **403 to our server-side reader** most of the time, and does so
with a browser user agent too (a bot challenge). Whether the product page is read is
therefore luck, and a product page that cannot be read leaves the read model with a
video or a support page. **`researchSearch` stays on Luna**: Sonnet 5 cost 7× as much for
the same links. The cover is fixed in every run: a front or three-quarter store shot,
never the wiki's back view.

**Open, not built:**
- When the product page answers 403, the read step could fall back to the text Exa
  already fetched for that URL (`contents.text` rather than highlights).
- `scoreConfidence` graded luna-2 **high** on `userStatedModel` + `manualFound` alone,
  although only a video was read.
- Luna still writes a two-sentence description when it has the page. The prompt's "one
  short paragraph" may be too literal.

**§10.** New tests, all with no network:
- `source-pages.test.ts`: classification, brand matching, the X2D order (product page
  first, video last) and image tiers.
- `candidatePageUrls` with wiki vs product fixtures.
- A YouTube-only source cannot satisfy `manufacturerPageFound` / `specsFromSource`.
- The reviewer note fenced in both research prompts and in the ranking request. It cannot
  close its fence, it is capped, and there is none without a note.
- `reviewer-note.test.ts`: cleaning and the 300 cap.
- View parsing, and a front view beating a back view the model ranked first.
- Schema: old candidates without `view`, and results without a note or rerun, parse to
  themselves.
- Product-page pictures before wiki pictures in `collectCandidates`.
- `image-retry-steps.test.ts`: the rerun replaces the images with unseen ones, releases
  the old cleaned copy and sends the note to search and ranking. Nothing new means failed,
  with the old images kept. A superseded run writes nothing. Also the allowance, the
  running refusal, staleness and a non-researched item.
- The server action: anonymous and adjacent-permission refusals, marking and starting,
  the note cap, `start_failed` and `daily_limit`.
- The route: a note forwarded, a blank note omitted, and refused over the cap, on several
  items, or without `tools.approve`.
- UI: both note boxes, the running, failed and refusal states, polling, the choice reset
  and the view tags.

**Status.** Built on `v5/gateway-images` (uncommitted). The URL heuristics and the view
tiers are first settings from one real product (the X2D). Check them against the next
real runs.

### 2026-09-23 — Search text fallback and confidence cap (§3.2, §3.3, §4.1, §5.1, §6, §10)

**What changed.** The three items the previous amendment left open are built. Research's
Exa search now returns each result's page text, and the read step uses that text for a
page our server cannot open. A result that read no page other than a video can no
longer grade high. The read prompt asks for a real paragraph.

**Why: the live X2D runs.** bambulab.com answers our server-side reader with a bot
challenge (403), so the product page was read only by luck. The runs it refused gave a
two-sentence description and no specs. The luna-2 run read one YouTube video and still
graded **high**, on the typed model name plus a support-page link that passed link
checking.

**The design, as built.**
- **Exa returns page text** (§3.2, `ai/exa.ts`). Research's config is now `numResults:
  6`, `contents: { text: { maxCharacters: 12000 }, highlights: true, extras: {
  imageLinks: 3 } }` (`RESEARCH_EXA_TEXT_MAX_CHARS`). Chat's config is unchanged.
  `exaPageTexts(steps)` reads `{ url, title, text }` off the provider-executed tool
  results, the same place `exaImageHints` reads images.
- **Only the texts the read step may use are carried** (`research/search-text.ts`).
  `searchItem` keeps the texts whose page is one of the search's candidate links or
  sources, at most 8 (`MAX_SEARCH_TEXTS_CARRIED`). They travel as
  `SearchStepResult.searchTexts` (optional, so an older run still replays) and as a
  fifth argument to `readAndVerifyItem`.
- **Matching a page.** A URL matches a captured text with the same URL, or with the same
  page: host without `www.`, path without a leading locale segment (`/en/`, `/en-us/`,
  `/pt_BR/`), trailing slash, query or fragment (`pageKey`). A text under 200 characters
  (`SEARCH_TEXT_MIN_CHARS`) is a cookie banner or a title, not a page, and is ignored.
- **When the copy is used** (§3.3, `read-pages.ts`). The copy replaces the server's own
  read when that read `failed` (any HTTP error, including 403 and 429, a timeout or a
  network error), was `too_large`, or came back `ok` with no text. It does **not**
  replace a `blocked` result: that is our SSRF guard's decision, and the fallback does
  not second-guess it. Nor does it replace a PDF or an `unsupported` type. No request is
  added, because the failed attempt already spent its place among the four. One copy is
  used once, however many variants of its page failed. The page is marked `via:
  "search"`, it is not listed as a failure, and it is among `sourceUrls`, because the
  model had its text.
- **Labelled and fenced** (§8). The page's fence label is `<url> (text captured by
  search)`, and the body starts with a line saying the server could not open the page
  and this is the search engine's copy (`SEARCH_TEXT_LABEL`). It is fenced with
  `fenceUntrusted` like any page. The read system prompt says such a page is the same
  page, just as untrusted, and may be incomplete.
- **Evidence** (`assemble.ts`). `manufacturerPageFound` and `specsFromSource` are held to
  "a page that is not a video was read". A page read through the search's copy counts
  toward that only when `classifyPage` calls it the brand's `product` page (the item's
  brand, and the settled name). A copy of a wiki, support or retailer page is still read,
  but it cannot earn either flag. `ResearchResult` gains `searchTextSources?: string[]`
  (§4.1): the source pages read through the copy. It is optional and absent when there
  were none, so old rows parse unchanged.
- **The confidence cap** (`capabilities/confidence.ts`). `scoreConfidence`,
  `confidenceLevel` and `confidenceLines` take an optional `{ sourceUrls }`. With it,
  `readCap` is `videoOnly` when every page read is a video, `nothingRead` when none was,
  and otherwise null. A capped result is **at most medium**: a high grade drops one
  step, and nothing else moves. Its unknowns lead with why: "Only a video was read — no
  product page, manual or spec sheet, so this cannot be high confidence", or "No page
  could be read, so nothing was checked against a source", which replaces the redundant
  no-source line. `assembleResearchResult` passes the result's `sourceUrls`. The chat's
  identification card passes nothing, so it is never capped: its sources are not reads.
- **§6.** `ConfidenceStrip` takes `sourcesAreReads`, and the preliminary page sets it, so
  the strip shows the same localized reason: `intake.unknownVideoOnly` and
  `intake.unknownNothingRead`, in all 12 locales.
- **Description depth** (`prompt.ts`). The description line now asks for "a real
  paragraph of 3–5 sentences": what the machine is, what it is for in a makerspace, and
  its key capabilities as the pages state them. It adds "when the pages say little,
  write less … never fill a gap from memory". `FETCH_SHAPE`'s description placeholder
  says the same. Specs are still the list.

**Live check** (the `v5/.livecheck/x2d.ts` script, adapted; real Gateway and network;
"Bambu Lab X2D"; search and read only, no image stage; both runs on
`openai/gpt-6-luna`; outputs `.livecheck/out/fallback-1.json` and `fallback-2.json`).

| Run | Pages read | Via search text | Description | Specs | Evidence | Confidence | Cost |
|---|---|---|---|---|---|---|---|
| fallback-1 | `bambulab.com/en/x2d`, `/en/x2d/specs`, YouTube, the X2D manual PDF | both bambulab.com pages (403 to our reader) | 605 chars, 4 sentences | 27 | manufacturer ✓, specs ✓, manual ✓ | high | search $0.029, read $0.106 |
| fallback-2 (`--no-pdf`) | `bambulab.com/en/x2d/specs`, YouTube | the specs page (403) | 476 chars, 4 sentences | 23 | manufacturer ✓, specs ✓, manual ✓ | high | search $0.029, read $0.001 |

- **Exa cost is unchanged.** Every call reported `costDollars.total` = **$0.007** with
  text, the same as Phase 0 measured with highlights only. Each run made 3 searches.
- **The search call's cost is unchanged too:** $0.029 in both runs, against $0.024–$0.031
  before. The page text raises the search model's input to about 128k tokens a call,
  but most of it was a cache read (72k of 129k in fallback-1).
- **The PDF is the expensive part, and this change did not add it.** fallback-1's read
  pass attached the X2D manual PDF (up to two PDFs, as before) and cost $0.106. The same
  read without it cost $0.001. The earlier runs never read a PDF, so they never showed
  this. The second run was made with PDFs off only to stay under the $0.20 budget.
  Production still attaches up to two.
- Total spend for the two runs: about **$0.17**.

**Open, not built:**
- A manual PDF attached as a file part costs about 10¢ a read. Exa also returned 12k
  characters of text for that same PDF URL. Whether a large PDF should be read from its
  text rather than attached is a cost question for Isaac.
- The locale-stripping rule in `pageKey` is a first setting from one site
  (bambulab.com). Check it against the next real runs.

**§10.** New tests, all with no network:
- `search-text.test.ts`: `pageKey`; exact vs variant matching; a copy too short to use;
  what crosses the step boundary and its cap; which outcomes the copy replaces.
- `read-pages.test.ts`: the copy replaces a 403 and a timeout, labelled `via: "search"`,
  counted as a source and not as a failure. It is used for a page with no text, keeping
  that page's images. It is never used for a page that read, and makes no extra request.
  A `blocked` page stays a failure. One copy is used once.
- `prompt.test.ts`: the copy's fence label and body line; a page the server read carries
  no label; the system prompt's paragraph on search copies; the 3–5 sentence paragraph
  and "write less" pinned.
- `assemble.test.ts`: a copy of the brand's product page earns manufacturer page and
  specs, and a copy of a wiki or retailer page does not; `searchTextSources`; the
  video-only X2D case graded medium with its reason first.
- `confidence.test.ts`: `readCap`; for every evidence combination, video-only or
  nothing-read is never high and is lowered only from high; a non-video page changes
  nothing; the lines.
- `ConfidenceStrip.test.tsx`: both reasons shown with `sourcesAreReads`, and neither
  without it.
- `exa.test.ts`, `gateway-wire.test.ts`: the config pins `text.maxCharacters`, and
  `exaPageTexts` reads text off the wire.
- `steps.test.ts`: a product page answering 403 is read from Exa's text end to end
  (labelled in the read prompt, `searchTextSources`, high); a page that reads never
  uses the copy.
- `research-batch.test.ts`: the search's texts reach the read step.

**Status.** Built on `v5/gateway-images` (uncommitted).

### 2026-09-23 — Luna research tuning (§3.1, §3.3, §10)

**Question.** Is `openai/gpt-6-luna` worse than `anthropic/claude-sonnet-5` at the research
read, or is the prompt the problem? **It is the prompt.** Both models were given the same
page texts. Luna got the facts right as often as Sonnet did, but it wrote less. The read
prompt now asks for the missing parts. `researchSearch` and `researchRead` stay on Luna,
and `reasoningEffort` stays unset.

**Method.** The script is `v5/.livecheck/compare/` (git-excluded). The report is
`.livecheck/out/model-compare.html`, and the raw data is in `model-compare.json`.
- **Six tools**, named as the inventory names them: Bambu Lab X2D, Makera Carvera Air,
  Formlabs Form 4, WEN DC3401, "RYOBI PCL235 ONE+ 18V Drill/ Driver" (it is an impact
  driver), and the SUIZAN Dozuki saw.
- **Search**: one real Luna search per tool, then `readCandidatePages` (at most 4 pages,
  `maxPdfs: 0`). The inputs were then frozen.
- **Read**: the real read call was replayed on those frozen inputs for each variant.
- **Scoring**: code checks whether each spec value, or every number in it, appears in
  the page text. A person checked the output for invented facts.

| Read variant (6 tools) | Specs | In page text | Avg description | PPE given | Cost | Avg latency |
|---|---|---|---|---|---|---|
| Luna, production prompt (2 runs) | 95 / 80 | 99% / 96% | 391 / 472 chars | 0 / 6 | $0.009 | 12 s |
| Luna, `reasoningEffort` medium / high | 93 / 94 | 96% / 96% | 400 / 460 | 0 / 6 | $0.009 / $0.013 | 14 / 21 s |
| **Luna, tuned prompt (3 runs)** | **144 / 137 / 136** | **100%** | **510 / 496 / 543** | **5 / 6** | **$0.010–0.011** | **20–23 s** |
| Sonnet 5, production prompt | 101 | 94% (the misses are paraphrases) | 718 | 4 / 6 | $0.282 | 30 s |

- **Facts.** No model invented a fact. Every run got the WEN at 660 CFM with a 5-micron
  bag; the inventory's old text says 750 CFM and 1-micron. Every run named the RYOBI an
  impact driver.
- **What Luna lacked.**
  - Shorter descriptions, often with no sentence on what the tool is for in a makerspace.
  - No PPE on any tool.
  - On SUIZAN, a sentence about the request inside the description ("the supplied item
    name does not confirm a size"). One run dropped every spec for that reason.
- **Reasoning effort reaches the model through the Gateway.** Set it with
  `providerOptions.openai.reasoningEffort`. Average reasoning tokens were 654 at the
  default, 888 at medium and 1,909 at high. It added latency and nothing else, so it is
  not set.
- **Three prompt variants were tried:**
  1. Field-by-field guidance.
  2. The same guidance plus a worked example.
  3. The same guidance with reasoning set to high.

  The guidance alone captured almost all of the gain; the example and high reasoning
  added nothing clear. The guidance was moved into `prompt.ts`. A first draft said "copy
  exactly", which produced multi-line values full of footnote marks (64 specs on the
  X2D), so the spec line was rewritten.
- **Search, Luna against Sonnet** (RYOBI and WEN). Sonnet's search found more pages for
  the WEN (manuals.plus and Home Depot). Tuned Luna read them and got 13 specs, against 10
  from Luna's own pages. But Sonnet's search cost $0.24–0.28, against $0.017–0.025 for
  Luna's, and took 33–46 s against 22 s. Not worth it.

**What changed** (`research/prompt.ts`, read pass only unless noted):
- **The description** has an order: (1) what it is, taking its type from the product page;
  (2) what it is for in a makerspace; (3–4) its key capabilities, with the pages' own
  numbers; (5) optionally, something a student must know first. It aims for 450–800
  characters when the pages support that. The existing "write less" rule still applies.
- **The description is for students**, not about the research. When the pages describe
  one size or variant of a product line, the listing still gives that variant's specs
  and names it in `canonicalName`.
- **Specs** means every row of a spec table that a student would care about, usually
  10–30. Numbers and units are kept exactly, one short value per line, with no footnote
  marks, test conditions or marketing claims.
- **`ppeRequired`** lists what a page states first, then the standard PPE for that type
  of machine. This is the same basis `trainingRequired` already uses.
- **`manufacturerPageFound`** counts a shop page on the brand's own site. This change is
  in the shared evidence paragraph, so both passes get it.

**Open (Isaac):**
- PPE is now inferred from the machine's type, so it has no page quote to cite. The
  refresh-research spec asks for a quote behind every proposal, so PPE needs a decision
  there.
- `candidatePageUrls` does not remove a URL that differs only by its query
  (`?Title=Default+Title`). One Sonnet search spent a read slot on such a duplicate.

**§10.** `prompt.test.ts` pins the description order and its length target, the
"for students" rule and the variant rule, the specs rule, the PPE rule, and the shop-page
evidence line in both passes. It also checks that the search pass gains none of the
read-pass rules.

**Spend.** $1.38 across 16 read variants, 8 searches and their Exa calls ($0.15 of it
Exa).

**Status.** Built on `v5/gateway-images` (uncommitted).

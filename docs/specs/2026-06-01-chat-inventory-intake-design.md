# Chat Inventory Intake — Design Spec

**Date:** 2026-06-01
**Status:** Approved for planning
**Target:** v5 (`v5/`, Notion-backed)
**Branch:** `philosophercode/chat-inventory-intake`

## 1. Summary

Add a low-barrier way to contribute inventory through the existing chat: a person
describes equipment in free text, dictated audio, photos, and/or pasted product
URLs (Amazon, store pages, manuals), and an **intake agent** parses the hint,
researches it, shows an **identification card** to confirm, and — on confirmation —
creates a draft catalog listing in Notion (tool + units + category/location +
manuals/videos).

The feature is delivered on top of a small architecture change: capabilities
(catalog reads, units, maintenance, intake) are defined **once** and exposed through
**both** the chat and the MCP endpoint. This is the first step toward a single,
extensible chat where every future feature is "just another capability."

## 2. Goals / Non-goals

### Goals
- One unified chat that catalogs equipment from messy multimodal input.
- Smart agent: asks clarifying questions, enriches via web search/fetch, confirms
  via an interactive card before writing.
- Draft-by-default writes (`published = false`) — nothing reaches the live catalog
  without a staff member publishing in Notion.
- Scope C: create the Tool **and** its Units, and find-or-create Category/Location;
  attach manuals/videos as Resource rows; attach the uploaded photo.
- Batch: handle many items in one turn (multiple photos or a long free-text list),
  one independently-confirmable card per item.
- Every capability (chat query, maintenance, intake) is also MCP-accessible.

### Non-goals (this iteration)
- No authentication / accounts. Protection is draft-by-default + human confirmation.
- No server-side transcription of uploaded audio files. Audio = browser dictation.
- No editing/deleting existing tools via chat (create-only for now).
- No Notion → live-catalog auto-publish. Publishing stays a manual staff action.
- Not migrating capabilities to MCP-as-transport for the chat (Approach 3); chat
  consumes capabilities in-process. MCP is a second adapter, not the chat's backend.

## 3. Architecture: capability registry + two adapters

A **capability** is a module grouping related tools plus a shared system-prompt
fragment. Each tool is defined once as plain data + a `run()` function. Two thin
adapters expose the registry through the chat and through MCP.

### 3.1 CapabilityTool shape

```ts
type CapabilityCtx = {
  // Surface-agnostic services the tool may use.
  // Chat adapter populates writer/attachments/locale/focusedToolId.
  // MCP adapter populates only what it can (no writer, no attachments).
  writer?: UIMessageStreamWriter;      // chat only — for emitting card data parts
  attachments?: UploadedImage[];       // chat only — uploaded photos for this turn
  locale?: string;
  focusedToolId?: string;
};

type CapabilityTool<I, R> = {
  name: string;                        // "search_tools" | "report_issue" | "create_tool" ...
  description: string;
  inputSchema: z.ZodType<I>;
  kind: "read" | "write";              // write tools: MCP-gated by MCP_TOKEN
  run: (input: I, ctx: CapabilityCtx) => Promise<R>;   // pure-ish data in, data out
  card?: (result: R) => CardPayload;   // optional: how the chat renders the result
};

type Capability = {
  id: string;                          // "catalog" | "units" | "maintenance" | "intake"
  promptFragment: (env: PromptEnv) => string;  // instructions added to system prompt
  tools: CapabilityTool<any, any>[];
};
```

### 3.2 Registry

`v5/src/lib/capabilities/index.ts` exports an ordered array of capabilities:

```ts
export const CAPABILITIES = [catalog, units, maintenance, intake];
```

### 3.3 Adapters

- **Chat adapter** (`v5/src/lib/capabilities/chat-adapter.ts`): `toAiTools(caps, ctx)`
  → `Record<string, AiTool>`. Wraps each `run()` in the AI SDK `tool()` shape. For
  tools with `card`, after `run()` returns it calls `ctx.writer.write({ type:
  "data-card", data: card(result), ... })` so the client renders a widget, and
  returns a compact text result to the model. Composes the system prompt by joining
  each capability's `promptFragment`.
- **MCP adapter** (`v5/src/lib/capabilities/mcp-adapter.ts`): `registerAll(server,
  caps)` → calls `server.registerTool(name, { description, inputSchema },
  handler)`; the handler runs `run()` and returns `{ content: [{ type: "text", text:
  JSON.stringify(result) }] }`. **Rule for `write` tools:** they are registered over
  MCP **only when `MCP_TOKEN` is configured** (the endpoint is then token-gated end to
  end, as today). If no `MCP_TOKEN` is set, the MCP surface is read-only — `write`
  capabilities are omitted entirely. See §8.

### 3.4 What moves where (refactor, no behavior change)

| Current location | New capability |
|---|---|
| `route.ts` `get_tool_details` + MCP `list/search/get_tool_details` | `catalog` |
| `route.ts` `get_unit_details` + MCP `get_unit_details`/`get_maintenance_history` | `units` |
| `route.ts` `report_issue` | `maintenance` |
| (new) | `intake` |

`web_fetch` / `web_search` stay as provider-native tools added by the chat adapter
(they are Anthropic tools, not capabilities). The intake capability's prompt tells
the agent to use them.

The existing duplicated unit-lookup / tool-summary helpers in `route.ts` and
`mcp/route.ts` collapse into shared helpers used by the capabilities.

## 4. Intake agent flow

The `intake` capability adds three tools and a prompt fragment.

### 4.1 Tools

1. **`research_tool`** (`read`) — input: a free-text description and/or product
   URL(s) and/or a note that photos are attached. The agent is instructed to call
   `web_search`/`web_fetch` (native) to gather canonical name, manufacturer, specs,
   materials, manual PDF URL, and a setup video URL. `research_tool` itself
   normalizes/returns a structured candidate (it may also call catalog
   `search_tools` first to detect duplicates). Returns a `ToolCandidate`.
2. **`propose_listing`** (`read`, has `card`) — input: one or more `ToolCandidate`s.
   Returns the candidates and emits an **identification card** per candidate
   (widget with photo, name, category, location, specs, found manual/video, and the
   "also creating" list with `(new)` tags for taxonomy). No writes. This is the
   "is this the tool you described?" gate.
3. **`create_tool`** (`write`) — input: a confirmed `ToolCandidate`. Performs the
   Notion writes (§5) and returns `{ tool_id, unit_ids, draft_url, created: {...} }`.
   Card flips to a success state: "Saved as a draft — staff will publish it."

### 4.2 ToolCandidate (shared type)

```ts
type ToolCandidate = {
  name: string;
  description: string;
  category?: { name: string; group: string; isNew: boolean };
  location?: { room: string; zone: string; isNew: boolean };
  materials: string[];
  ppe_required: string[];
  tags: string[];
  training_required?: boolean;
  use_restrictions?: string;
  units: { label: string; status?: string; condition?: string; serial?: string }[];
  resources: { title: string; url: string; type: "Manual" | "Video" | "Other" }[];
  image_upload_ids: string[];          // Notion file_upload ids from /api/upload-notion
  source_urls: string[];               // provenance: what the agent read
  duplicate_of?: { id: string; name: string } | null;  // catalog match, if any
};
```

### 4.3 Confirmation & batch

- The agent **never** calls `create_tool` without a prior `propose_listing` and an
  explicit user confirmation (click or typed "yes / add it").
- Confirmation is delivered by the card's **"Looks right — add it"** button, which
  seeds a follow-up user message (e.g. `confirm add: <candidateId>`) that the agent
  resolves to a `create_tool` call. "Edit" lets the user type a correction; the
  agent re-runs `propose_listing`. "✕" discards.
- **Batch:** when multiple items are present, the agent emits multiple cards (one
  `propose_listing` call with N candidates, or N calls). Each card confirms and
  writes independently. "Add all" seeds a confirm-all message.

### 4.4 Duplicate handling

`research_tool`/`propose_listing` run a catalog `search_tools` on the candidate
name. If a strong match exists, the card shows "Already in catalog" and offers
**Add a unit to the existing tool** instead of creating a new tool.

## 5. Notion write layer

New functions in `v5/src/lib/notion.ts`, following the existing
`createMaintenanceLog` pattern (`/pages` POST, write-prop helpers already present:
`titleProp`, `richTextProp`, `selectProp`, `relationProp`, `dateProp`,
`fileUploadsProp`). Add `multiSelectProp`, `checkboxProp`, `urlProp` as needed.

- `createTool(fields: Partial<ToolFields>): Promise<ToolRecord>` — sets
  `published = false` always. Maps category/location relation ids, materials/ppe/tags
  multi-selects, attaches images via `image_attachments` file_upload prop.
- `createUnit(fields: Partial<UnitFields>): Promise<UnitRecord>` — links `tool`
  relation; default `status = "Available"`.
- `findOrCreateCategory(name, group): Promise<{ id; isNew }>` — query
  `categories` for a case-insensitive name match; create if absent.
- `findOrCreateLocation(room, zone): Promise<{ id; isNew }>` — query `locations`;
  create if absent.
- `createResource(fields: Partial<ResourceFields>): Promise<ResourceRecord>` —
  manuals/videos linked to the new tool (`published = false`).

**Write order in `create_tool.run`:** resolve/create category + location → create
tool (with image uploads + relations, `published=false`) → create units (link to
tool) → create resources (link to tool). Each step is best-effort logged; a failure
after the tool is created returns a partial-success result naming what landed so the
user/staff can finish in Notion (no silent failures).

**Image path:** photos are uploaded client-side to the existing
`/api/upload-notion` (returns `file_upload_id`); ids ride on the candidate as
`image_upload_ids` and are attached to the tool page's image field at create time.
`/api/upload-notion` is image-only today — unchanged.

## 6. Input handling (chat client)

### 6.1 Vision (model must see photos) — change
Today `ChatFab` uploads photos to Notion and passes only a `[Attached photos:
file_upload_id=…]` text hint; the model never sees the image. For identification we
must send the image bytes to the model.

- On image attach, in addition to the existing Notion upload, include the image as a
  **file/image part** on the outgoing user message so Claude can see it.
- Keep the `file_upload_id` hint so `create_tool` can attach the *same* photo to the
  Notion page without re-uploading.
- Apply existing size/type guards; respect the request size ceiling.

### 6.2 Audio (browser dictation) — additive
- Add a mic button to the chat input that uses the browser **Web Speech API**
  (`SpeechRecognition`) to transcribe speech into the draft text box.
- Feature-detect; hide/disable the button where unsupported (graceful degradation).
- No new dependency, no API key, no server route. Server-side file transcription is
  explicitly out of scope (see Non-goals).

### 6.3 Identification card rendering — new
- The chat client renders `type: "data-card"` parts as an `<IdentificationCard>`
  widget (photo, fields, found resources, "also creating" with `(new)` badges,
  action buttons). Success and "already in catalog" are card states.
- Buttons seed follow-up messages via the existing send path (and the PR #25
  `ChatLauncherProvider` seed mechanism where a launcher is involved).

### 6.4 Entry point (front door) — reuses PR #25
- Add an "Add equipment" entry (nav button and/or FAB action) that calls
  `useChatLauncher().open("I'd like to add new equipment to the inventory.")`.
- Add `nav.add` / `nav.addAria` / `nav.addSeed` to all 12 locale files
  (`v5/messages/*.json`), mirroring the `nav.report*` keys PR #25 added.

## 7. Relationship to PR #25 (merged)

PR #25 (merged to `main`, squash `f0b8643`) added the **front-door layer**:
`ChatLauncherProvider` (open + seed the chat from anywhere) and a "Report" nav
button driving the existing `report_issue` flow. It changed no server/tool logic.

This design adopts it directly:
- `report_issue` becomes the `maintenance` capability (now MCP-accessible too).
- The intake "Add equipment" front door is just another caller of
  `ChatLauncherProvider` — no new launcher infrastructure.

```
Front doors:  "Report" btn · "Add equipment" btn · tool-page deep links
                 │ open(seedText)            (PR #25 launcher)
                 ▼
            ChatFab ─► chat route ─► capability registry ─► catalog · units · maintenance · intake
            MCP route ───────────────────────►┘  (same registry, token-gated)
```

## 8. Security & safety

- **Draft-by-default:** every created tool/unit/resource is `published = false`.
  The catalog read path (`fetchAllTools`) already filters to published.
- **Human confirmation:** `create_tool` only runs after `propose_listing` + explicit
  confirm. The agent prompt forbids writing without confirmation.
- **Taxonomy guardrail:** new Category/Location creation is surfaced on the card with
  a `(new)` badge before the user confirms.
- **MCP writes:** `write` capabilities are exposed over MCP **only when `MCP_TOKEN`
  is configured** (which token-gates the whole endpoint). With no token set, MCP is
  read-only and write tools are not registered. Read tools stay open (as today). Rate
  limits already exist on chat/upload/MCP routes.
- **No silent failures:** partial write failures return a structured report of what
  landed; nothing is swallowed.

## 9. Phased build order

Each phase is independently shippable.

1. **Phase 1 — Capability registry + adapters (refactor, no behavior change).**
   Build the registry, chat adapter, MCP adapter; port `catalog`, `units`,
   `maintenance`. Chat and MCP behavior unchanged; `report_issue` now MCP-callable.
   Verify: existing chat flows + MCP tools still work; `build`/`lint`/tests green.
2. **Phase 2 — Notion write layer + intake tools + vision.**
   Add `createTool`/`createUnit`/`findOrCreate*`/`createResource`; add `research_tool`,
   `propose_listing`, `create_tool` (data only); send images to the model. Drive it
   text-first (cards can be plain text initially).
3. **Phase 3 — Identification card UI + batch + front door.**
   `<IdentificationCard>` widget + `data-card` parts; confirm/edit/discard buttons;
   batch stacks; "Add equipment" launcher entry + locale keys.
4. **Phase 4 — Audio dictation.**
   Mic button via Web Speech API with feature detection.

## 10. Testing

- **Unit:** `findOrCreate*` (match vs create), `create_tool` write order + partial
  failure reporting, ToolCandidate normalization, adapter wrapping (capability →
  AI tool and → MCP tool shapes).
- **Integration:** intake happy path (text-only → propose → confirm → draft created),
  duplicate detection → "add unit" path, batch with one bad item.
- **Manual:** photo identification end-to-end; audio dictation on Chrome/Safari;
  draft visibility (not in catalog until published).
- Match the existing v5 test setup; run `build` + `lint` in `v5/` before each phase
  lands (per PR #25's verification bar).

## 11. Open questions / future

- Server-side transcription of recorded audio files (deferred provider add-on).
- Edit/delete of existing tools via chat (create-only for now).
- Promoting the registry so the chat consumes capabilities *over* MCP (Approach 3),
  once capabilities stabilize.
- Optional light gate on the intake front door if draft spam becomes a problem.

# Architecture Guide — MakerLab Tools v5

> For whoever inherits this codebase. It explains **how the app works and why it is shaped
> this way**, which is the part that is expensive to reconstruct from reading files.
>
> Operational concerns — keys, accounts, what to do at 2am — are in
> [`handover.md`](handover.md). The rules any change must respect are in
> [`constitution.md`](constitution.md).

---

## 1. The shape of it, in one page

A Next.js App Router application. Three things matter:

1. **Notion is the database and the admin UI.** There is no admin dashboard in the app,
   deliberately — staff edit records in Notion, which they already use daily. This is why
   the app can stay small.
2. **The assistant reads live data through tool calls**, not from a catalogue pasted into a
   prompt. Add a machine in Notion and the assistant knows about it within minutes, with no
   deploy.
3. **Agent abilities are declared once** in a capability registry and exposed through two
   surfaces — the chat UI and the MCP endpoint. Adding an ability to one gives it to both.

```
Browser ──► Next.js ──► catalog.ts ──► notion.ts ──► Notion API
                 │           │
                 │      (cached, tagged)
                 │
                 └──► /api/chat ──► capabilities ──► Claude
                      /api/mcp  ──┘
```

---

## 2. Data layer

**Seven Notion databases**, IDs supplied via `NOTION_DB_*` environment variables: Tools,
Categories, Locations, Units, Resources, Maintenance_Logs, Flags.

**`src/lib/notion.ts`** is the only module that talks to Notion. It handles pagination, 429
retries, and parsing pages into typed records. One thing to know: **it tolerates both
`snake_case` and `Title Case` property names**, because Notion databases get edited by hand
and property names drift. If a field mysteriously reads as empty, check the property name
in Notion first.

**`src/lib/catalog.ts`** orchestrates: it fetches tools, categories, locations, units, and
resources in parallel, joins them in memory, and derives the view types the UI renders. It
is cached with `cacheTag("catalog")` and a short `cacheLife`, so a Notion edit appears
within minutes — or immediately, if someone hits the admin revalidate endpoint.

### The mock-catalogue fallback — read this before debugging an empty catalogue

`getCatalogTools()` returns built-in mock data whenever **any** Notion environment variable
is missing, **or** a fetch throws. This is load-bearing: it is why `npm run dev` works with
no credentials and why the entire test suite needs no network.

It is also the single most confusing behaviour in the app. **A misconfigured production
deploy does not error — it serves plausible fake equipment and looks perfectly healthy.**
If the catalogue shows machines the lab does not own, the cause is almost always a missing
or misspelled env var. Check the server logs for `Falling back to mock catalog`.

Constitution Article 4 requires making this loud and visible in the UI. If that has not been
done yet, it is the highest-value small fix in the codebase.

---

## 3. The capability registry

*(Lands with the `chat-inventory-intake` branch. If `src/lib/capabilities/` does not exist
yet, that branch has not been merged.)*

An **ability** the assistant has — searching the catalogue, looking up a unit, filing a
ticket — is declared once as data plus a function:

```ts
interface CapabilityTool<I, R> {
  name: string;
  description: string;        // the model reads this to decide when to call it
  inputSchema: z.ZodType<I>;  // zod; validated before run() sees it
  kind: "read" | "write";
  run: (input: I, ctx: CapabilityCtx) => Promise<R>;
}
```

Related tools are grouped into a **capability** with a fragment of the system prompt.
`CAPABILITIES` in `src/lib/capabilities/index.ts` is the ordered list.

Two **adapters** consume that list:

- `chat-adapter.ts` → AI SDK tools, streaming, interactive cards
- `mcp-adapter.ts` → MCP tool registration over JSON-RPC

**The rule that keeps this working: adapters translate, they never decide.** No domain logic
in an adapter, and no ability defined in a route handler. An ability added to a route works
in exactly one place and is invisible to the other surface — which is the failure this
design exists to prevent.

`CapabilityCtx` carries what the surface can provide — a stream writer, uploaded photos, the
locale, the tool the user is currently viewing. **Every field is optional**, and tools must
degrade rather than assume: MCP has no stream writer, so a tool that would render a card
returns plain data instead.

---

## 4. The chat route

`src/app/api/chat/route.ts`. In order:

1. **Rate limit by IP**, before anything expensive. Non-negotiable — this endpoint spends
   money.
2. **Build context from the page the user is on.** This is the interesting part: on the
   gallery the assistant gets a lightweight index of every tool; opened from a tool page it
   gets that machine's full detail *and its linked manuals*, becoming a specialist on the
   machine in front of you.
3. **Attach documents.** Linked PDFs are fetched server-side and passed to Claude as
   document blocks — read in full, not summarised. This is what makes manual-grounded
   troubleshooting work, and it is why answers cite real procedures.
4. **Stream** the response, with tool calls resolved through the registry.

Two behaviours are deliberate and easy to break by accident:

- **The assistant troubleshoots before filing a ticket.** It walks a student through likely
  fixes first and only then offers to log the issue. A ticket-filing machine that skips
  diagnosis floods staff with resolvable problems.
- **Tickets are always written in English**, even when the reply is in another language, so
  staff can read them.

---

## 5. Caching and revalidation

Reads are cached with `"use cache"`, tagged `catalog` (and `projects`, once that lands),
with a short `cacheLife`. `POST /api/admin/revalidate` with the `x-admin-secret` header
busts a tag immediately — that is how staff make a Notion edit appear now rather than in a
few minutes.

**Gotcha:** because `cacheComponents` is enabled in `next.config.ts`, API routes **cannot
set `runtime`**. They use the default Node runtime. Adding `export const runtime = "edge"`
breaks the build in a way whose error message does not obviously point here.

---

## 6. Internationalisation

`next-intl`, twelve locales, cookie-based (`NEXT_LOCALE`) with no URL prefix — so
`/tools/abc` is the same URL in every language.

Messages live in `v5/messages/*.json`. **All twelve files are updated together**; a missing
key falls back to English silently, which means a half-translated feature looks fine in
development and wrong in production.

The assistant's language is independent of the UI locale — it replies in whatever language
the student writes in.

---

## 7. Testing

Four layers, all offline. See [`v5/TESTING.md`](../v5/TESTING.md) for the runbook.

| Layer | Tool | Covers |
|---|---|---|
| Unit | Vitest | `src/lib`, `src/i18n` — parsing, mapping, rate limiting |
| Integration | Vitest + MSW | API routes with Notion and Anthropic mocked |
| Component | RTL | Rendering, states, interaction |
| E2E | Playwright | Real browser against the mock catalogue |

Two things worth knowing:

- **E2E boots its own server on port 3100** with `NOTION_*` unset and intercepts
  `/api/chat`. It never touches your dev server or any real service.
- **The suite mocks at the `streamText` boundary**, so tests assert on what the route asked
  the model to do rather than on model output. That is why the suite is deterministic — and
  why it cannot catch the assistant getting *worse*. That is what the eval harness
  (`docs/specs/2026-07-29-agent-eval-harness-design.md`) is for.

---

## 8. Decisions worth knowing before you change something

**Notion rather than a real database.** Staff already live in Notion, and using it means the
app needs no admin UI at all — which is most of why v5 is small enough for one person to
maintain. The cost is real: no joins, no aggregates, no transactions, and every read is a
paginated API call. Analytics are effectively impossible. This is the main constraint the
successor project removes.

**No authentication, historically.** The catalogue is public and writes are protected by
being drafts-by-default rather than by identity. Sign-in is specced
(`docs/specs/2026-07-29-auth-and-rate-limiting-design.md`) primarily to bound API cost and
give tickets a verified reporter — not to lock the front door, which stays open.

**Drafts by default.** Anything the assistant or a student creates is written unpublished
and needs a human to publish it in Notion. This is the entire security model for writes.
Do not add a path around it.

**No image generation.** v4 generated illustrations; v5 removed it. It produced
inconsistent results for no clear purpose.

---

## 9. Where the bodies are buried

- **The mock-catalogue fallback** (§2). Silent, and the most likely cause of anything
  looking wrong in production.
- **Notion property-name drift.** Someone renames a property in the Notion UI and a field
  goes quietly empty. The parser tolerates two casings; it cannot tolerate a rename.
- **Notion file URLs expire.** Manual and image URLs are signed and time-limited, which is
  fine within the cache window and a real problem for anything that stores them long-term.
- **The in-memory rate limiter is per-process** and resets on cold start. Upstash backs it
  only when **both** `UPSTASH_REDIS_REST_*` variables are set — one alone silently does
  nothing.
- **Two apps in one repo.** Root `src/` is v4. Almost every "why doesn't my change appear"
  question traces to editing the wrong tree.

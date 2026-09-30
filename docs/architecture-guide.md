# Architecture Guide — MakerLab Tools v5

> For whoever inherits this codebase. It explains **how the app works and why it is shaped
> this way**, which is the part that is expensive to reconstruct from reading files.
>
> Operational concerns — keys, accounts, what to do at 2am — are in
> [`handover.md`](handover.md). The rules any change must respect are in
> [`constitution.md`](constitution.md). File-level detail (key modules, gotchas, every
> subsystem's as-built notes) is in [`AGENTS.md`](../AGENTS.md) and [`architecture/`](architecture/).

---

## 1. The shape of it, in one page

A Next.js App Router application on Vercel. Four things matter:

1. **Postgres is the source of truth, and the app is the admin UI.** Staff edit the
   inventory, work tickets, moderate projects and assign roles on `/admin`. Notion, which
   held the data until September 2026, is read only by the one-time import and can receive
   a one-way copy (the mirror) — it is never read back.
2. **The assistant reads live data through tool calls**, not from a catalogue pasted into
   a prompt. Publish a machine and the assistant knows about it as soon as the catalogue
   cache is invalidated, with no deploy.
3. **Agent abilities are declared once** in a capability registry and exposed through two
   surfaces — the chat UI and the MCP endpoint. Adding an ability to one gives it to both.
4. **Slow AI work runs as durable workflows.** Researching a new tool, finding its product
   photo, archiving and indexing its manuals, and pushing the mirror are Workflow SDK runs
   (`src/workflows/`), so a page request never waits on them.

```
Browser ──► Next.js ──► catalog.ts ──► lib/data/* ──► Drizzle ──► Postgres (Neon)
                 │           │                                    PGlite locally / in tests
                 │      (cached, tagged)
                 │
                 ├──► /api/chat ──► capabilities ──► AI Gateway ──► models
                 │    /api/mcp  ──┘
                 ├──► /admin (server actions) ──► lib/data/* + audit_events
                 └──► /api/uploads ──► Vercel Blob (public store / private store)

workflows: research-batch · refresh-batch · archive-manuals · image-retry · mirror-push
cron:      /api/cron/daily — Postgres backup to private Blob, orphaned-upload sweep
```

---

## 2. Data layer

**Postgres through Drizzle ORM.** `src/lib/db/client.ts` is the one entry point
(`getDb()`); the schema is `src/lib/db/schema/`, migrations are SQL files applied by
`npm run db:migrate` (the production `build` runs it first). The query modules are
`src/lib/data/*.ts`; `src/lib/catalog.ts` orchestrates them into the `MakerLabTool`
view the pages render.

**Which database** is decided by environment, in this order:

| Setting | Database | Used for |
|---|---|---|
| `DATABASE_URL` | Neon Postgres | Every deployment |
| `PGLITE_DATA_DIR` (no `DATABASE_URL`) | A persistent PGlite folder, never demo-seeded | Reviewing the real inventory on a laptop; refused on Vercel |
| neither | In-process PGlite with a two-tool demo seed | A fresh clone, the whole test suite, E2E |

**Files live in Vercel Blob**, one row per file in `attachments`. A Blob store is either
all-public or all-private, so a deployment links two: the default store for public files
(tool photos, manuals, project photos) and a store connected with the prefix
`BLOB_PRIVATE` for private ones (maintenance photos, the nightly backup, research's
private copies). `blobCredentials(access)` in `src/lib/blob-mode.ts` picks the store;
every `@vercel/blob` call goes through it. On a laptop with no token, files go to
`.blob-data/` instead.

**Manuals are text too.** Each stored manual PDF is extracted page by page
(`manual_documents`, `manual_pages`), split into passages and embedded (`manual_chunks`,
pgvector, 512 dimensions), so the assistant searches a manual and cites the page instead
of attaching the whole PDF.

### Failing toward stale, not toward wrong

The old Notion app fell back to a built-in mock catalogue whenever a fetch failed, and a
misconfigured deploy looked perfectly healthy. That is gone:

- **`DATABASE_URL` unset** serves the demo seed, **with a banner saying so**
  (`DemoDataBanner`), and `/api/health` reports `"catalog": "demo"`.
- **`DATABASE_URL` set but unreachable** never falls back to demo data. Cached pages keep
  serving; an uncached read renders an error state; `/api/health` answers 503.

---

## 3. The capability registry

An **ability** the assistant has — searching the catalogue, looking up a unit, searching a
manual, filing a ticket — is declared once as data plus a function:

```ts
interface CapabilityTool<I, R> {
  name: string;
  description: string;        // the model reads this to decide when to call it
  inputSchema: z.ZodType<I>;  // zod; validated before run() sees it
  kind: "read" | "write";
  requiredPermission?: Permission;
  run: (input: I, ctx: CapabilityCtx) => Promise<R>;
}
```

Related tools are grouped into a **capability** with a fragment of the system prompt.
`CAPABILITIES` in `src/lib/capabilities/index.ts` is the ordered list. Access is decided
once, by `capabilitiesForIdentity` (`capabilities/access.ts`) from `requiredPermission` —
never inside a tool's `run()`.

Two **adapters** consume that list:

- `chat-adapter.ts` → AI SDK tools, streaming, interactive cards
- `mcp-adapter.ts` → MCP tool registration over JSON-RPC (`/api/mcp`, anonymous or with a
  personal token; `/api/mcp/signed-in` for OAuth clients)

**The rule that keeps this working: adapters translate, they never decide.** An ability
added to a route works in exactly one place and is invisible to the other surface — the
failure this design exists to prevent.

`CapabilityCtx` carries what the surface can provide — the identity, a stream writer,
uploaded photos, the locale, the tool the user is viewing. **Every field is optional**, and
tools degrade rather than assume: MCP has no stream writer, so a tool that would render a
card returns plain data instead.

---

## 4. The chat route

`src/app/api/chat/route.ts`. In order:

1. **Rate limit**, by user when signed in and by IP otherwise, before anything expensive.
2. **Build context from the page the user is on.** On the gallery the assistant gets a
   lightweight index of every tool; opened from a tool page it gets that machine's full
   detail and its manuals, becoming a specialist on the machine in front of you.
3. **Manuals.** A processed manual is searched with `search_manual`, which returns the
   relevant passages with page numbers; the answer cites `p. N` and links the lab's stored
   PDF. Only manuals not yet processed are attached whole.
4. **Stream** the response through the **Vercel AI Gateway**, with tool calls resolved
   through the registry. Every model call names a *job* (`chat`, `researchSearch`,
   `researchRead`, `imageRank`, `embed`, …) that `src/lib/ai/models.ts` maps to a model
   and a service tier; `MODEL_<JOB>` overrides one. There is no direct provider key.

Two behaviours are deliberate and easy to break by accident:

- **The assistant troubleshoots before filing a ticket.** A ticket-filing machine that
  skips diagnosis floods staff with resolvable problems.
- **Tickets are always written in English**, even when the reply is in another language, so
  staff can read them.

---

## 5. Accounts, roles and the admin surface

**Better Auth** with Google sign-in, on the same database (`user`, `session`, `account`,
`verification`). Sessions are rows, so a role change or a block lands on the person's next
request. Sign-in is restricted to `AUTH_ALLOWED_EMAIL_DOMAIN` (`cornell.edu` in
production) plus any addresses named in `AUTH_ALLOWED_EMAILS`. **Sign-in unlocks; it never
gates the front door** — the catalogue and chat work anonymously.

Roles are `user` (shown as Student), `admin` (Supermaker) and `super_admin` (Super Admin),
stored in `user.role`. What each may do is declared once in
`src/lib/auth/permissions.ts`; every route, server action and capability calls
`can(identity, …)`. `AUTH_SUPER_ADMIN_EMAILS` is a floor, not a roster: those addresses are
always super admins, which is how the first one exists and why the lab cannot lock itself
out. A person's title (People page) is display only.

`/admin` is one list of surfaces (`src/lib/admin/surfaces.ts`) rendered three ways —
the tile home, the section bar and the ⌘K palette. Every admin write is defined once in the
**action layer** (below); the page's server action is a one-line wrapper over it.

### The action layer: one path for people, the assistant and MCP

`src/lib/actions/` (assistant–GUI parity spec, `docs/specs/2026-09-27-…`). Each GUI write
is a **definition** — input schema, permission, risk, `check`, `preview`, `run`,
`afterCommit` — registered in `registry.ts`, and every surface runs it through
`performAction(def, input, identity, { surface })`: gate (limiter, sign-in, permission via
`authorizeAdminAction`) → parse → the action's own refusals → run → audit (`audit_events`
carries `surface` and `proposal_id`) → revalidate.

- **The GUI** calls it from a thin server action with the cookie's identity.
- **The chat assistant** gets one generated tool per definition
  (`capabilities/actions.ts`), and that tool only **proposes**: it stores an
  `action_proposals` row and draws a card from it. The change happens when the person
  clicks **Confirm** (`POST /api/action-proposals`, cookie only), which runs the stored
  input through `performAction` again, permission and all.
- **MCP clients** get the same proposing tools for queue and catalogue work only; their
  proposals wait 7 days in the creator's **Assistant proposals** inbox
  (`/admin/proposals`). People, destructive and spending actions are never exposed over
  MCP; `update_ticket` is the one direct MCP write, kept for existing clients.
- **The parity guard** (`actions/parity.test.ts`) fails CI when a new server action or
  mutation route is neither a wrapper nor an exemption with a reason, and
  `actions/spec-drift.test.ts` fails when the registry and the spec's §4.9 disagree.

Adding a write means adding a definition, not a server action with logic in it.

---

## 6. Adding equipment: intake, research, refresh

1. **Identify.** Staff paste a list, a link or photos (chat's `identify_tools`, or
   **Import a list** on `/admin/intake`). Each item becomes a `pending_tools` row.
2. **Research** runs as a workflow: web search (Exa through the Gateway), reading the
   official pages and manuals, a short description, the official and display names,
   English-only resources, and a product photo — found, ranked by a model, and cut out by a
   deterministic background removal (no generative redraw; it altered product labels).
3. **Approve.** A person reviews the preliminary page and approves; the tool is created
   **unpublished** until someone publishes it (Article 5).

**Refresh** re-runs research for tools already in the inventory and shows a per-field
diff to accept or reject (`tool_refreshes`, `/admin/refresh`). Bulk imports and research
spend are bounded by allowances a super admin grants.

---

## 7. Caching and revalidation

Catalogue reads are cached with `"use cache"`, tagged `catalog`, with a long lifetime
(`CATALOG_CACHE` in `src/lib/cache.ts`: background refresh daily). Freshness comes from
**invalidation**, not polling: every admin write revalidates the tags it touched, the
header's Refresh control and `POST /api/admin/revalidate` (with `x-admin-secret`) bust a
tag on demand.

**Gotcha:** because `cacheComponents` is enabled in `next.config.ts`, API routes **cannot
set `runtime`**. They use the default Node runtime. Adding `export const runtime = "edge"`
breaks the build in a way whose error message does not obviously point here.

---

## 8. Internationalisation

`next-intl`, twelve locales, cookie-based (`NEXT_LOCALE`) with no URL prefix — so
`/tools/abc` is the same URL in every language.

Messages live in `messages/*.json`. New strings go into `en.json` in the same PR; the
other locales fall back to English until the translation pass (data platform spec, phase
9 — scheduled for after launch). The assistant's language is independent of the UI
locale — it replies in whatever language the student writes in.

---

## 9. Testing

Four layers, all offline. See [`TESTING.md`](../TESTING.md) for the runbook.

| Layer | Tool | Covers |
|---|---|---|
| Unit | Vitest | `src/lib`, `src/i18n` — parsing, mapping, permissions, rate limiting |
| Integration | Vitest + PGlite + MSW | API routes and server actions against a real in-process Postgres |
| Component | RTL | Rendering, states, interaction |
| E2E | Playwright | Real browser against the PGlite demo database, with the Gateway stubbed |

- **E2E boots its own servers** (port 3100, plus a second for the intake flow). It never
  touches your dev server or any real service.
- **Model calls are stubbed** at the AI SDK boundary, so tests assert on what the route
  asked the model to do rather than on model output. That is why the suite is
  deterministic — and why it cannot catch the assistant getting *worse*. The agent eval
  harness (`npm run eval`, real and paid) is for that.

---

## 10. Decisions worth knowing before you change something

**Postgres rather than Notion.** Notion kept the app small while staff edited records
there, but it cost joins, aggregates, transactions and analytics, and every read was a
paginated API call. The data platform spec
([`2026-09-14-v5-data-platform-design.md`](specs/2026-09-14-v5-data-platform-design.md))
moved the data into Postgres and built the admin surface to edit it; the Notion mirror
exists for people who still want to read the inventory there.

**Sign-in unlocks, never gates.** The catalogue is public. Identity exists to bound API
cost, attribute tickets to a verified reporter, and gate staff abilities.

**Drafts by default.** Anything the assistant or a student creates is written unpublished
and needs a person holding the permission to publish it. This is the entire security model
for writes. Do not add a path around it.

**One model path.** Every model call goes through the AI Gateway: one invoice, a
platform-enforced spend limit, and per-job model choice without a code change.

**No generated images.** Product photos are found and cut out, never redrawn — a
generative model altered the labels on the products it cleaned.

---

## 11. Where the bodies are buried

- **Agent worktrees sit inside the app.** `.claude/worktrees/` holds full checkouts of
  this repo. `tsconfig`, ESLint, the unit tests and the build ignore `.claude/`, but the
  workflow test tier (`@workflow/vitest`) scans them: prune finished worktrees.
- **`.pglite-data` is single-process.** A second process gets `PgliteLockedError`; stop
  `npm run dev` before an import, a migration, `manuals:index` or `data:push`.
- **Two Blob stores.** A private file written without `blobCredentials("private")` lands
  in the public store (or is refused by it). Scripts run from a laptop need the private
  store's read-write token; a store id alone needs an OIDC token a laptop does not have.
- **Env changes need a redeploy.** Vercel bakes variables into a deployment at build time.
- **The in-memory rate limiter is per-process** and resets on cold start. Upstash backs it
  only when **both** `UPSTASH_REDIS_REST_*` variables are set — one alone silently does
  nothing.
- **Workflow steps are bundled separately.** `vi.mock` does not reach inside a workflow
  under `@workflow/vitest`; see `docs/architecture/testing.md` before testing one.

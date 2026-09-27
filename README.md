# MakerLab Tools

The equipment inventory and AI assistant for the **Cornell Tech MakerLAB**. Students
find a machine, read how to use it, and ask an assistant that answers from the lab's own
records and manuals. Staff keep the inventory, work maintenance tickets and add new
equipment in the same app.

**Live:** <https://makerlab-ai.vercel.app>

Deployed across the lab's ~100 machines, and the subject of an accepted demo paper at
ISAM 2026.

---

## What it does

**Tool pages.** Fuzzy search and facets (category, material, training, location) across
the catalogue; each tool has specs, location, required training and PPE, its manuals and
SOPs, and a live table of individual units with status and condition. QR labels on the
machines open the right page.

**An assistant on every page.** It answers from the live catalogue through tool calls,
not from a prompt baked in at build time. Opened from a tool page it becomes a specialist
on that machine: it **searches the machine's manuals** and cites the page it read, sees
photos of error screens, replies in the language it is asked in, troubleshoots first and
then files a maintenance ticket when something is genuinely broken.

**Research and intake.** Staff add equipment by pasting a list or a product link, or by
photographing a label. The app identifies each item, researches it in the background
(official name, description, manuals, a clean product photo) and leaves a draft for a
person to approve. Existing tools can be re-researched the same way.

**Admin.** `/admin` holds the inventory editor, the maintenance and corrections queues,
project moderation, intake and research, user roles and titles, and an optional one-way
mirror into Notion. Everything created by the assistant or a student starts unpublished.

**MCP access.** The catalogue is a Model Context Protocol server at `/api/mcp`, so anyone
can query the lab from Claude, ChatGPT or another client — read-only without an account,
or as themselves after signing in. See [`docs/mcp.md`](docs/mcp.md).

**Twelve languages, white-label.** The interface is translated through `next-intl`;
branding, colours, institution and assistant name come from environment variables.

---

## Stack

Next.js 16 (App Router, React Server Components, `cacheComponents`), React 19,
TypeScript, Tailwind CSS 4 with shadcn/ui. **Postgres** (Neon) through Drizzle ORM, with
pgvector for manual search; **Vercel Blob** for files (one public store, one private).
Better Auth with Google sign-in, restricted to Cornell addresses. Models through the
**Vercel AI Gateway** via the AI SDK. MCP via `@modelcontextprotocol/sdk`. Vitest, React
Testing Library, MSW and Playwright. Hosted on Vercel.

Notion is no longer the data layer: it is read once by the import script, and optionally
receives a one-way copy of the inventory.

---

## Quick start

```bash
git clone https://github.com/philosophercode/makerlab-tools.git
cd makerlab-tools
npm install
npm run dev                  # http://localhost:3000
```

**It runs with no configuration.** With `DATABASE_URL` unset the app uses an in-process
Postgres (PGlite) seeded with two demo tools, shows a **demo data** banner, and stores
uploads in `.blob-data/`. Add `AI_GATEWAY_API_KEY` to `.env.local` to turn the
assistant on. `.env.example` documents every variable.

**Working against the real inventory locally** uses a persistent PGlite database:

```bash
PGLITE_DATA_DIR=.pglite-data npm run dev -- -p 3001     # set AUTH_BASE_URL=http://localhost:3001
```

`.pglite-data/` is single-process: stop the dev server before running an import,
`db:migrate`, `manuals:index` or `data:push` against it. How the local database is
filled from Notion and later copied to the hosted site is in
[`docs/deploy.md`](docs/deploy.md).

### Commands

Run from the repo root:

```bash
npm run dev            # dev server
npm run build          # db:migrate, then next build
npm run lint           # eslint
npm run typecheck      # tsc --noEmit
npm test               # vitest: unit + integration + component
npm run test:e2e       # playwright (once: npx playwright install chromium)
npm run test:all       # all of the above; must pass before a merge
npm run spec:coverage  # every route, tool, script and env var is documented
npm run eval           # agent eval harness — real, paid model calls; never in CI
```

The test suite needs **no credentials and makes no network calls**.

### Layout

The app is the repository root.

```
src/app          pages, /admin, API routes (incl. /api/mcp, /api/cron/daily)
src/lib          data (Drizzle + Postgres), capabilities, AI jobs, research, auth
src/components   UI (shadcn/ui + the MakerLab design system)
src/workflows    durable background jobs (research, imports, mirror push)
messages/        12 locales
scripts/         import, migration and maintenance tools (node --experimental-strip-types)
e2e/  test/      Playwright specs; the shared Vitest harness
evals/           agent eval harness
docs/            deploy, handover, architecture, constitution, specs
```

The earlier v4 app (AirTable) is not in the tree; it is kept at the tag `v4-final`.

---

## Documentation

| Document | For |
|---|---|
| [`docs/deploy.md`](docs/deploy.md) | **Setting it up.** Local stages, then a Vercel deployment step by step. |
| [`docs/handover.md`](docs/handover.md) | **Running it.** Accounts, routine tasks, backups, what to do when it breaks. |
| [`docs/operations.md`](docs/operations.md) | Monitoring, backups and restore once the site is live. |
| [`docs/architecture-guide.md`](docs/architecture-guide.md) | **How it works.** Start here if you are inheriting the code. |
| [`docs/mcp.md`](docs/mcp.md) | Connecting Claude, ChatGPT, Codex and other MCP clients. |
| [`docs/constitution.md`](docs/constitution.md) | The rules every change must respect. |
| [`docs/specs/`](docs/specs/README.md) | Design specs and what is built against each. |
| [`docs/MakerLab_design/DESIGN.md`](docs/MakerLab_design/DESIGN.md) | The design system. |
| [`AGENTS.md`](AGENTS.md) | Stack, data layer, auth, admin, intake, MCP, key files and gotchas, for people and AI assistants alike. `CLAUDE.md` points here. |
| [`TESTING.md`](TESTING.md), [`test/README.md`](test/README.md) | Test suite runbook and harness internals. |
| [`evals/README.md`](evals/README.md) | The agent eval harness (real, paid model calls). |
| [`.env.example`](.env.example) | Every environment variable, with what it does. |
| [`docs/isam-2026-demo/`](docs/isam-2026-demo/) | The ISAM 2026 demo paper and figures. |

## Contributing

Every feature starts with a spec that merges **before** the implementation
([`docs/constitution.md`](docs/constitution.md), Article 1). Use
[`docs/specs/TEMPLATE.md`](docs/specs/TEMPLATE.md), or `/spec` in Claude Code.
`npm run test:all` must pass before any merge.

## Who owns it

The **Cornell Tech MakerLAB**:

- **Niti Parikh** — Director
- **Luis Rodrigo Navarro** — Assistant Director
- **Isaac Steinberg** — Tech Lead


# MakerLab Tools — the app

This directory is the MakerLab Tools application. The project overview, quick start and
documentation index are in the [root README](../README.md); this file only orients you
inside `v5/`.

| Read | For |
|---|---|
| [`AGENTS.md`](AGENTS.md) | Stack, data layer, auth, admin, intake, MCP, key files, gotchas |
| [`TESTING.md`](TESTING.md) | Running and writing tests |
| [`.env.example`](.env.example) | Every environment variable, with what it does |
| [`evals/README.md`](evals/README.md) | The agent eval harness (real, paid model calls) |
| [`../docs/deploy.md`](../docs/deploy.md) | Local setup in stages, then Vercel |

```bash
npm install
npm run dev          # demo data, no configuration needed
npm run test:all     # lint + typecheck + vitest + playwright
```

Layout: `src/app` (pages, `/admin`, API routes), `src/lib` (data, capabilities, AI jobs,
research, auth), `src/components`, `messages/` (12 locales), `scripts/` (import,
migration and maintenance tools run with `node --experimental-strip-types`), `e2e/`,
`test/` (shared test harness).

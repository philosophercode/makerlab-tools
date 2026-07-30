# MakerLab Tools

A digital inventory and discovery system for makerspaces. Students browse the equipment
catalogue, ask an AI assistant about any machine in any language, and file maintenance
tickets from the same conversation. Staff keep the data in Notion, which they already use.

Deployed at the **Cornell Tech MakerLAB** across ~100 machines. Subject of an accepted demo
paper at ISAM 2026.

> [!IMPORTANT]
> **The live application is `v5/`.** The root `src/` directory is v4 — an older
> AirTable-backed version, kept for reference and receiving no changes. Everything below
> refers to v5 unless it says otherwise.

---

## What it does

**Browse and search.** Fuzzy ranked search across the catalogue, with facets for category,
material, training level, and location.

**Tool detail.** Specs, location, required training, PPE, emergency-stop guidance, linked
manuals and SOPs, and a live table of individual units with status, condition, and serial.

**An assistant on every page.** It answers from the live catalogue rather than a prompt
baked in at build time, reads the machine's actual manual to walk through a setup or a fix,
sees photos of error screens, replies in whatever language it is asked, and files a
maintenance ticket when something is genuinely broken.

**An MCP endpoint.** The catalogue is exposed as a Model Context Protocol server, so anyone
can query the lab from Claude, ChatGPT, or another client.

**Twelve languages.** The UI is translated and the assistant answers in whatever language
you write in. Maintenance tickets are always written in English so staff can read them.

**White-label.** Branding, colours, institution name, and assistant name all come from
environment variables. Nothing about Cornell is hardcoded.

---

## Quick start

```bash
cd v5
npm install
npm run dev          # http://localhost:3000
```

**It runs with no configuration.** Without Notion credentials the app serves a built-in mock
catalogue — enough to develop against, and what the entire test suite uses. To point it at
real data, copy `v5/.env.example` to `v5/.env.local` and fill in the Notion and Anthropic
keys.

```bash
npm run test:all     # lint + typecheck + unit/integration/component + E2E
```

The full suite needs **no credentials and makes no network calls.**

---

## Documentation

| Document | For |
|---|---|
| [`docs/deploy.md`](docs/deploy.md) | **Setting it up.** Run it locally in stages, then host it on Vercel. |
| [`docs/architecture-guide.md`](docs/architecture-guide.md) | **How it works.** Start here if you're inheriting the code. |
| [`docs/handover.md`](docs/handover.md) | **Running it.** Accounts, keys, routine operations, what to do when it breaks. |
| [`docs/constitution.md`](docs/constitution.md) | The rules any change must respect. |
| [`docs/specs/`](docs/specs/) | Design specs. Every feature has one, written before it was built. |
| [`docs/v5-plan.md`](docs/v5-plan.md) | The original architecture plan; §9 is the long-term vision. |
| [`v5/TESTING.md`](v5/TESTING.md) | Test suite runbook. |
| [`AGENTS.md`](AGENTS.md) | Conventions and repo map, for humans and AI assistants alike. |

---

## Tech stack

Next.js 16 (App Router, React Server Components), React 19, TypeScript, Tailwind CSS 4.
Claude via the Vercel AI SDK. Notion as the data layer, across seven databases. `next-intl`
for translation. Vitest, React Testing Library, MSW, and Playwright for tests. Deployed on
Vercel.

## Commands

Run from `v5/`:

```bash
npm run dev          # dev server
npm run build        # production build
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
npm test             # vitest: unit + integration + component
npm run test:e2e     # playwright (once: npx playwright install chromium)
npm run test:all     # everything
```

## Contributing

Every feature starts with a spec that merges **before** the implementation
([`docs/constitution.md`](docs/constitution.md), Article 1). Use
[`docs/specs/TEMPLATE.md`](docs/specs/TEMPLATE.md), or `/spec` if you're working with Claude
Code. `npm run test:all` must pass before any merge.

## License

MIT

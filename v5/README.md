# MakerLab Tools v5

Greenfield v5 implementation for the Notion-backed catalog described in
`../docs/v5-plan.md`.

## Scope

- `/` gallery for published tools
- `/tools/[id]` tool detail with inline units
- Global Technical Schematic chrome
- Read-only chat FAB overlay
- Notion as the catalog source of truth

Operational v4 surfaces such as QR scanning, maintenance reporting, flags,
standalone chat, and unit pages are intentionally out of scope for the first
v5 pass.

## Environment

```bash
NOTION_API_KEY=secret_...
NOTION_DB_TOOLS=...
NOTION_DB_CATEGORIES=...
NOTION_DB_LOCATIONS=...
NOTION_DB_UNITS=...
NOTION_DB_RESOURCES=...
NOTION_DB_MAINTENANCE_LOGS=...
NOTION_DB_FLAGS=...
```

## Local Commands

From this directory:

```bash
npm run dev
npm run build
npm run lint
```

The app uses root workspace dependencies for now. Split package boundaries only
when v5 needs a materially different runtime from v4.

# CLAUDE.md — MakerLab Tools v4

## Project Overview

MakerLab Tools is a digital inventory and discovery system for makerspace
equipment. It lets students browse tools, chat with an AI assistant, scan QR
codes, and report maintenance issues. The data layer is a normalized 6-table
AirTable schema; the frontend is Next.js on Vercel.

## Tech Stack

- **Frontend:** Next.js 16 (App Router), React 19, Tailwind CSS 4, TypeScript
- **AI:** Claude API via Vercel AI SDK, Gemini for image generation
- **Data:** AirTable REST API (6 tables)
- **Testing:** Vitest, React Testing Library, jsdom
- **Deploy:** Vercel

## AirTable Schema

6 tables — IDs set via env vars (`AIRTABLE_TABLE_*`):

| Table | Env Var | Description |
|-------|---------|-------------|
| Tools | `AIRTABLE_TABLE_TOOLS` | Equipment catalog |
| Categories | `AIRTABLE_TABLE_CATEGORIES` | Groups + subcategories |
| Locations | `AIRTABLE_TABLE_LOCATIONS` | Rooms + zones |
| Units | `AIRTABLE_TABLE_UNITS` | Individual physical units |
| Maintenance_Logs | `AIRTABLE_TABLE_MAINTENANCE_LOGS` | Issue reports & repairs |
| Flags | `AIRTABLE_TABLE_FLAGS` | Content corrections |

## Key Files

- `src/lib/site-config.ts` — branding, colors, institution name (white-label)
- `src/lib/airtable.ts` — all AirTable API calls (server-only)
- `src/lib/types.ts` — TypeScript interfaces for all records
- `src/app/api/chat/route.ts` — Claude chat with tool context + web search

## Conventions

- Use `@/` path alias for imports (maps to `src/`)
- Server components by default; add `"use client"` only when needed
- CSS variables for theming: `--primary`, `--primary-dark` (not hardcoded colors)
- Use `siteConfig` from `@/lib/site-config` for all branding strings
- Python scripts use only stdlib (urllib, json, os) — no requests/aiohttp

## Commands

```bash
npm run dev          # Start dev server
npm run build        # Production build
npm test             # Run tests
npm run test:watch   # Watch mode
npm run lint         # ESLint
```

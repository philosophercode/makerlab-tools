# Student Projects Gallery — Design Spec

**Date:** 2026-05-29
**App:** MakerLab Tools v5 (`v5/`), Next.js 16 App Router, Notion-backed, deployed on Vercel.
**Scope:** One PR. Read side (gallery + bidirectional tool links) is independently reviewable from the submit side.

## Goal

A gallery of student project write-ups (blog-style markdown), backed by a new Notion **Projects** database, with **bidirectional linking** between projects and the tools used to build them. Students submit via a **form** (no AI). Submissions land in Notion unpublished; a staff/admin flips `published` in Notion to make them public.

## Non-goals (explicitly out of scope)

- No AI authoring / assistant involvement. The MakerBot chat is untouched.
- No in-app auth or accounts.
- No automatic translation of project content (separate parked feature). Project body stays in whatever language the student wrote.
- Editing/deleting existing projects from the app (admins manage in Notion).

## Notion schema — new `Projects` database

Operator creates the DB in Notion, shares it with the integration, and sets `NOTION_DB_PROJECTS`.

| Field | Type | Notes |
|-------|------|-------|
| `title` | title | Project name |
| `author` | rich_text | Student name/handle (free text; no account) |
| `body` | rich_text | Markdown write-up |
| `photos` | files | Uploaded images (first = cover) |
| `tools_used` | relation → Tools DB | **Bidirectional link.** Auto-creates a back-relation on Tools. |
| `link` | url | Optional — repo / video / external |
| `materials` | multi_select | Optional |
| `published` | checkbox | Default false. Staff gate. |
| `date` | created_time | Submission timestamp |

Notion relations are inherently two-way, so `tools_used` yields a "Projects" back-relation on each Tool with no extra schema work.

## Data layer (`v5/src/lib/`)

- **`notion.ts`**: add `projects` to the DB env map (`NOTION_DB_PROJECTS`), a `ProjectRecord` type + `pageToProject()` parser, `fetchAllProjects()` (published-only filter option), `fetchProject(id)`, and `createProject(fields)` (writes page with `published=false`, photo `file_upload` attachments reusing the pattern from the maintenance photo flow, and `tools_used` relation IDs). Tolerate lower/Title-cased property names like the existing parsers.
- **`catalog.ts`** (or a new `projects.ts`): `getPublishedProjects()` and `getProject(id)` behind `"use cache"` with a new `cacheTag("projects")` + `cacheLife("minutes")`. Add a helper to map a tool id → its linked published projects for the "Built with this" section (derive from the back-relation, or by scanning projects' `tools_used`).
- **`types.ts` / `catalog-types.ts`**: `MakerLabProject` view type (id, title, author, body, photos[], tools[{id,name,slug}], link, materials[], date).

## Routes & UI

- **`/projects`** — replace the current "coming soon" stub with a gallery grid of published projects: cover photo, title, author, tool chips. Reuse card/grid styling and (optionally) the search pattern from the tool gallery (#17) if cheap; otherwise a simple grid.
- **`/projects/[id]`** — detail: cover + photo gallery, `react-markdown` + `remark-gfm` rendered `body` (already used in ChatFab), author, date, `materials`, optional `link`, and **tool chips** linking to `/tools/[id]`.
- **`/projects/new`** — submission form (client component):
  - Fields: title, author, markdown `body` (textarea + small live preview via react-markdown), photo upload (reuse `/api/upload-notion` from PR #12 → collect `file_upload` ids), **tool multiselect** populated from `getCatalogTools()`, optional `link`, optional `materials`.
  - Submits to `POST /api/projects`. On success: "Thanks — your project is pending review" confirmation; on error: inline message.
- **`/tools/[id]`** (DetailShell): add a **"Built with this"** section listing published projects that reference the tool → link to `/projects/[id]`. Hidden when none.

## API

- **`POST /api/projects`** — validates payload (title, author, body required; photos/tools/link/materials optional), rate-limited via the existing `rate-limit.ts` (`projects:${ip}`, e.g. 10/min), calls `createProject()` with `published=false`. Returns the new page id. Node default runtime (no `runtime` export — cacheComponents).
- Extend **`POST /api/admin/revalidate`** to also bust the `projects` cache tag (so a freshly-published project appears without waiting for `cacheLife`).

## Cross-cutting

- **Moderation:** `published=false` by default; admin flips in Notion. Gallery + detail + "Built with this" only ever show published projects. `/projects/new` is always reachable.
- **i18n:** all new UI strings (gallery, detail labels, form labels, confirmation/errors, nav) into all 12 `v5/messages/*.json` files; English authoritative, others machine-translated (flag for native QC). Project *content* is not translated.
- **Rate limiting:** the submit endpoint uses the existing limiter.
- **Caching:** `projects` tag; revalidate endpoint busts it.
- **Nav:** the existing `/projects` nav entry stays; add a visible "Submit a project" affordance on `/projects`.

## Build structure (one PR, two logical halves)

1. **Read side:** schema wiring + data layer + `/projects` + `/projects/[id]` + "Built with this" on tool detail. Reviewable against a Notion DB that has a couple of manually-published rows.
2. **Submit side:** `/projects/new` form + `POST /api/projects` + photo/tool wiring + revalidate-tag extension.

## Operator follow-up (after merge)

1. Create the `Projects` Notion DB with the schema above; add the `tools_used` relation to the Tools DB.
2. Share the DB with the integration; set `NOTION_DB_PROJECTS` in Vercel (all environments).
3. Redeploy / purge the `projects` (and `catalog`) cache tag.
4. Submit a test project; flip `published` in Notion; confirm it appears in `/projects` and under "Built with this" on each linked tool.

## Test plan

- [ ] `cd v5 && npm run typecheck && npm run lint && npm run build` pass.
- [ ] With no `NOTION_DB_PROJECTS` set, `/projects` renders an empty state (no crash) and `/projects/new` still loads.
- [ ] Submitting the form creates a Notion page with `published=false`, photos attached, tool relations set.
- [ ] An unpublished project does NOT appear in `/projects`, `/projects/[id]` (404/!published), or "Built with this".
- [ ] After flipping `published=true` + cache bust, the project appears in the gallery, its detail renders markdown + photos, tool chips link to tools, and the tool pages show it under "Built with this".
- [ ] Submit endpoint returns 429 past the rate limit.

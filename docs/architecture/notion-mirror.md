# The Notion mirror

> Moved verbatim from `AGENTS.md` on 2026-09-29, when `AGENTS.md` became an
> index. Paths are relative to the repository root.

## The Notion mirror (`notion_mirrors`, Phase 8)

A one-way copy of the inventory into an admin's own Notion workspace (spec
§3.8, §5.8). Postgres stays the source of truth; nothing is ever read back.

- **One mirror per admin, found from the session.** `/admin/mirror`
  (`mirror.manage`) shows only the caller's own row; no server action in
  `src/app/admin/mirror/actions.ts` takes a mirror id. The four setup actions
  (test, connect, create databases, save mapping) also pass
  `MIRROR_SETUP_TIER` (10/min). Connect and disconnect audit
  `mirror.connected` / `mirror.disconnected`.
- **The token is validated by one read, then stored encrypted.** AES-256-GCM
  under a key HKDF-derived from `AUTH_SECRET` with a fixed info string
  (`src/lib/mirror/token-crypto.ts`). Rotating `AUTH_SECRET` makes every stored
  token unreadable; the page then asks for it again. The nightly backup blanks
  the ciphertext. **Never log a token, `AUTH_SECRET` or an email** — error
  text goes through `scrubSecrets`, and `last_error.detail` is generic English
  built in code, never Notion's message.
- **Seven databases, fixed schemas** (`database-schemas.ts`), in dependency
  order: categories, locations, tools, units, resources, maintenance,
  projects. **Create databases** makes the missing ones under the shared page;
  pasted ids are validated against the schema before anything is saved.
- **The push** (`push.ts`, run by `mirrorPush` in
  `src/workflows/mirror-push.ts`): an overlap guard (`running_since`, 15 min),
  rows newer than `last_synced_at` or than their `mirror_pages.source_updated_at`,
  upsert by `mirror_pages`, archive pages of archived tools, unpublished
  projects and deleted rows. 3 requests/s, 429 honoured via `Retry-After`,
  45-second budget per push (then up to six rounds, 5 s apart). The budget
  stops new requests only; one already started runs to Notion's answer or a
  30 s ceiling, never cut short (an aborted create would duplicate a page).
  Only a clean, complete push advances `last_synced_at`; a 401 pauses the
  mirror. A round skipped because another push holds the mirror waits 30 s
  and tries again (up to ten times).
- **Mapping changes and running pushes.** `setMirrorMapping` (when the
  mapping changes) and `resetMirrorEntities` bump `mapping_generation`; a push
  records pages and advances `last_synced_at` only while the mirror is still
  at the generation it claimed, and otherwise stops as `incomplete` for
  another round. `resetMirrorEntities` also marks the pages of every entity
  with a relation into the reset ones (`relationDependents`) as not mirrored,
  so their links are rewritten to the new pages.
- **Only a current admin's mirror pushes.** Every claim except Sync now (whose
  server action already checked `mirror.manage`) requires the owner's `user`
  row to hold a role in `MIRROR_OWNER_ROLES` and not be banned; demoting or
  banning an admin stops their mirror. Sync now is refused (`sync_running`)
  while another push holds the mirror, without spending the 15 minutes.
- **What it carries.** Every tool (with a Published checkbox), units,
  resources, categories, locations, maintenance logs and published projects;
  public attachments as external files, never private ones. **Reporter,
  assignee and author names and emails are carried** (open question 4,
  answered 2026-09-23) — the mirror's workspace holds personal data. Emails
  still never enter a model prompt or a log line.
- **Three triggers.** (1) `requestMirrorPush()` (`src/lib/mirror/trigger.ts`)
  after a committed write — approving a tool, every tool-editor write
  (`tool-write-context.ts`), publishing a project, working a maintenance
  ticket. It never throws, costs one query when nobody has a mirror, and
  starts `mirrorPushAfterChange`, which sleeps two minutes so a burst
  coalesces. (2) **Sync now**, once per mirror per 15 minutes. (3) The daily
  cron's `mirror` stage (`src/lib/cron/mirror-backstop.ts`), for any mirror
  whose data is newer than its last sync.
- **Notion is called with raw `fetch`** (`notion-client.ts`, API version
  `2022-06-28`) — no SDK. `NOTION_API_BASE_URL` overrides the base URL for the
  E2E stub only; production never sets it.

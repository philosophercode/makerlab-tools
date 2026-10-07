# Usage insight

> Moved verbatim from `AGENTS.md` on 2026-09-29, when `AGENTS.md` became an
> index. Paths are relative to the repository root.

## Usage insight (`usage_*`; usage insight spec, migration `0022`)

Anonymous counts of what the lab asks about, on **`/admin/insights`**
(`insights.view`: admin and super admin). `docs/specs/2026-09-27-usage-insight-design.md`
and its 2026-09-28 amendment are the detail.

- **No per-person data, by schema.** `usage_events` / `usage_rollups` have no
  user, session, chat, token, IP, email or user-agent column; the only thing
  recorded about who caused an event is `audience` (`anonymous` | `member` |
  `staff`, from the role — `lib/usage/events.ts`). A test asserts the column
  names. Do not add one; do not pass an identity or a chat id into `lib/usage/`.
- **`demo` is a fourth audience** (demo pass spec 2026-10-07 §5.5, migration
  `0032`): a visitor's chat turns while they hold a demo pass. `usageSource`
  leaves it out **always** — Insights, the value report and `get_usage_summary`
  count the lab only, with or without staff — and the Insights facts line says
  "Demo passes left out". A demo turn's unanswered question is counted (a
  `gap` event) but never upserted into the Unanswered queue.
- **What is counted** (`USAGE_KINDS`): `tool_view` (beacon; `source` `qr` |
  `direct`), `kiosk_view` (`screen` from `/kiosk`'s render, `qr` from an
  arrival with `?src=kiosk`), `chat_turn` (with `question_kind` operate /
  debug / create / other — a keyword heuristic, `question-kind.ts`, no model),
  `tool_asked` (focused tool, `get_tool_details` found, `search_manual` scope;
  chat and MCP), `manual_cited` (a passage the answer linked to, with page;
  `source = 'cross_tool'` when the passage is another machine's document
  than the one the answer was about, `lib/manuals/citation-scope.ts`,
  manual text spec amendment 2026-10-06 — shown as "Citations of another
  machine's document" and as `cross_tool_citations` in `get_usage_summary`),
  `gap`, `mcp_call` (the tool name).
- **Recording never costs a student anything.** The chat route's `onFinish`
  calls `recordChatTurnUsage` (`lib/usage/chat-turn.ts`), MCP's
  `registerAll` has an `afterCall` hook (`handler.ts` → `mcpCallUsage`); both
  schedule `recordUsage` with `after()` (`schedule.ts`). `recordUsage` never
  throws — a failed insert is one `[usage]` warning. `USAGE_INSIGHT=off`
  records nothing. `search_manual` logs the passages it returned on the turn's
  `TurnState` (`turn-log.ts`), each with its `ref` — that is how a citation
  link becomes a document id and page. A citation is a link to the passage's
  `#cite-<ref>` (what the prompt asks for) or its exact URL, matched by the
  same `linkPosition` the chat's Sources use (`lib/manuals/citation-ref.ts`;
  spec amendment 2026-09-30). A page of a manual attached whole is not a
  `manual_cited`.
- **The beacon** (`POST /api/usage`, `components/usage/UsageBeacon.tsx`): tool
  pages are cached, so the browser says it was seen, once per tool per tab
  (`sessionStorage`), with `sendBeacon`. Tier `usage` 60/min; `Sec-GPC`, `DNT`,
  bots → nothing; a published tool only; always 204. `EXEMPT` in the parity
  guard (not a user action).
- **Unanswered** (`usage_gaps`): a turn that could not answer — `get_tool_details`
  found nothing, every `search_tools` empty, `search_manual` `no_results` and
  nothing cited, or the answer saying so (`absence.ts`, English phrases) — is
  upserted by `gap-key.ts` (normalised question + tool). The text is scrubbed
  (`scrub.ts`), the **latest** wording kept, and the row deleted **30 days after
  it was last asked**. Decisions: `insights.dismiss_gap` (three more askings
  reopen it) and `insights.file_correction` (a `feedback` row, no reporter,
  lands on `/admin/corrections`) — GUI only (`assistant: "never"` until the
  spec's phase 4).
- **Retention.** The daily cron's `usage` stage (`rollup.ts`, after cleanup)
  recounts every complete hour still held raw into `usage_rollups` (replacing,
  so a re-run is idempotent), deletes raw events older than 30 days and gaps
  past theirs. Rollups are kept and name nobody. `usage_events` and
  `usage_gaps` are `RETENTION_BOUND` (`cron/backup-policy.ts`): never in the
  backup file, never copied by `data:push`.
- **Reads** (`queries.ts`): rollups for rolled hours plus raw events after the
  watermark (last rolled hour + 1h), so nothing is counted twice before or after
  the cron; days and the 7 × 24 grid in `LAB_TIMEZONE`; staff left out unless
  `?staff=1`. The home tile counts open gaps (`countOpenGaps`).
- **Demo seed** writes a synthetic week (`demo-usage.ts`) so the page has
  something to show locally and in E2E.
- **Value report** (`/admin/insights/value`, the Insights page's second tab;
  spec amendment "Value report", migration `0024_lab_settings`): per term or
  custom range, questions answered (app + MCP lookups ÷ lookups per question),
  share handled without staff, **estimated** staff hours and dollars, after-hours
  share in lab time, top tools, question kinds, follow-up counts, beside the
  previous period, with the formulas in words. Pure arithmetic in
  `lib/usage/value/` (`assumptions`, `lab-clock`, `periods`, `report`, `csv`,
  `format`); reads in `value-queries.ts` (staff always left out) and one
  loader, `load.ts`, shared by the page and the chat read `get_value_report`
  (`insights.view`, chat; over MCP only as the super-admin twin below). Words for page, print and CSV come
  from one model (`components/admin/insights/value/value-report-model.ts`).
  **Assumptions** (minutes per question 4, $40/h, staffed hours from
  `siteConfig.labHours`, contiguous term windows, all gap kinds unhandled, MCP
  at 2 lookups a question) live in `lab_settings` (`data/lab-settings.ts`, key
  `value_report`, JSON re-validated on read) and change only through
  `insights.set_value_assumptions` (`insights.configure`, admin and super
  admin; `assistant: "never"`). Print is the browser's, over
  `styles/value-report-print.css` (`:has([data-value-report])`, one Letter
  page); CSV is built on the server and saved by the island — no export route.
  Staffed hours are whole hours because rollups are hourly.
- **Over MCP, super admins only** (spec amendment 2026-09-30): two reads on
  **`insights.export`** (held by `super_admin` alone), both `mcpOnly`, in the
  `insights` capability (`capabilities/insights.ts`, last in the registry). `get_value_report` is an MCP twin of the chat
  tool (`getValueReportMcpTool`: same name, input, loader and summary).
  `get_usage_summary` (`capabilities/usage-summary.ts`) is the Usage tab for
  `days` 7 / 30 / 90 (default 30) and `include_staff` (default false): it calls
  `loadInsights` with the page's `insightsTimeZone()` and `answeredPercent`
  (`usage/answered.ts`), so its numbers are the page's — totals, the Unanswered
  queue's **counts**, top ten tools, never-asked count and 25 names, question
  kinds, the five busiest cells, the five most-cited manuals. **No question
  text ever** (it never reads `data.gaps`), nothing about a person, read-only.
  No custom range: the page has none.

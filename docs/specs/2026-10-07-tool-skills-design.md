# Tool Skills: a Cited Operating Guide per Machine — Design Spec

**Date:** 2026-10-07
**Status:** Implemented (awaiting the owner's review)
**Target:** the app (repository root)
**Branch:** agent worktree branch (`worktree-agent-acb2a7ebbf29040ad`)
**Spec PR:** with the implementation (owner's instruction, 2026-10-07) · **Implementation PR:** #NNN

## 1. Summary

The owner asked (Isaac, 2026-10-07): "Make an option for a skill writing agent to make a pass after
research for tools, and run it, and save it to the db, and pass over MCP." He had asked whether to
write a skill per tool instead of retrieval over the manuals. The answer was both: retrieval over
the manuals stays for questions (`search_manual`), and each tool also gets a **tool skill**, a
cited operating guide in the shape of a Claude Code `SKILL.md`, written by an agent after research
and read by any connected AI (MakerLAB AI in the chat, Claude or ChatGPT over MCP) when someone
wants to operate, debug or plan a build with that machine. A second request the same day: "Also
assistant should load it in chat if on tool."

What this adds:

- A new table, `tool_skills` (migration `0031`): every skill a tool has had, versioned, with its
  markdown, its structured form, the sources it cites, a hash of everything it was written from,
  the model and the Gateway's cost. A tool's **current skill** is its latest `ready` row.
- A new model job, **`skillWrite`** (Luna, flex), that turns one tool's sources (its catalogue
  record, research, lab notes, lab-wide notes, linked documents and manual passages) into a
  structured guide. Code validates it (zod), drops any bullet that states a number without a
  citation (**the numbers guard**), puts the lab's own rules first, and renders the markdown
  deterministically.
- A lab setting, **"Write a tool skill after research"**, off by default, on Settings › AI agents
  (directors turn it on). When on, a skill is written after a researched tool is approved and
  refreshed when its manuals are indexed, in a durable workflow, skipped when nothing it reads
  changed, and capped at 50 a day for the lab.
- **Write skill / Rewrite skill** on a new admin page per tool, `/admin/inventory/<slug>/skill`,
  linked from the tool editor, showing the current skill, its sources, model, cost, date and status.
- A backfill script, `npm run tools:skills`, a dry run by default.
- A read capability, **`get_tool_skill`**, for everybody, in the chat and over MCP; and on a tool's
  page the chat puts that tool's skill into its prompt by itself.

No architecture change. The skill follows patterns already in the tree: the eval questions step in
the archive workflow, `lab_settings` for a lab-level option, the action layer for the two GUI
writes, and the capability registry for the read.

## 2. Goals / Non-goals

### Goals

- Any connected AI can fetch one machine's operating guide in one call, and every number, setting,
  limit and safety claim in it points at a source the lab holds: a manual page, a research page, a
  lab note or the catalogue record.
- The lab's own knowledge wins: its notes, rules, training, PPE, restrictions and emergency stop are
  printed first in every skill, by code, and the prompt says they override the manufacturer.
- Nothing the sources do not say is invented: the guide says "not in the lab's sources" instead.
- Writing is opt-in for the lab (default off), bounded (a daily cap), cheap (flex, skipped when
  unchanged) and visible (cost and status per skill on the admin page).
- On a tool's page, MakerLAB AI follows that tool's skill without having to call a tool.
- No test calls a model; every model call in the suite is stubbed.

### Non-goals (this iteration)

- **No skill on the public tool page.** Staff read it on the admin page first; showing it to
  students is a later decision (§11).
- **No editing a skill by hand.** A wrong skill is fixed at its sources (the catalogue record, lab
  notes, a manual) and rewritten. A hand edit would be overwritten by the next refresh.
- **No translation.** A skill is written in English, like a maintenance ticket, and read by models.
- **The assistant never proposes writing a skill.** The skill is instructions the assistant reads,
  like the lab-wide notes, so writing one is staff's click (`assistant: "never"`).
- **Not a replacement for `search_manual`.** Questions about a manual still search it and cite the
  passage; the skill is a guide, not the manual.
- **No refresh after accepted refresh-research changes**, only after intake approval and manual
  indexing (§11, question 2).

## 3. Architecture

### 3.1 Where things live

```
src/lib/db/schema/tool-skills.ts            NEW  the table
src/lib/db/migrations/0031_tool_skills.sql  NEW  migration (+ meta snapshot, journal)
src/lib/data/tool-skills.ts                 NEW  reads and writes of tool_skills
src/lib/skills/format.ts                    NEW  zod schemas, section keys, types (pure)
src/lib/skills/parse.ts                     NEW  the model's JSON → a draft (pure)
src/lib/skills/numbers-guard.ts             NEW  the numbers guard and safety checks (pure)
src/lib/skills/compose.ts                   NEW  the lab's facts first, the cited sources (pure)
src/lib/skills/render.ts                    NEW  sections → markdown; the compact prompt form (pure)
src/lib/skills/inputs.ts                    NEW  assemble one tool's sources from the database
src/lib/skills/hash.ts                      NEW  the input hash
src/lib/skills/prompt.ts                    NEW  the system prompt and the user prompt
src/lib/skills/write.ts                     NEW  writeToolSkill: assemble → hash → model → guard → store
src/lib/skills/read.ts                      NEW  the current skill, validated, for readers
src/lib/skills/setting.ts                   NEW  the lab setting (key tool_skills)
src/lib/skills/limits.ts                    NEW  cap, budgets, cost estimate (client-safe)
src/lib/skills/targets.ts                   NEW  the tools of the documents an archive run built
src/lib/skills/steps.ts                     NEW  workflow steps
src/lib/skills/trigger.ts, start.ts         NEW  requestToolSkills → start(writeToolSkills)
src/workflows/tool-skills.ts                NEW  writeToolSkills(toolIds, trigger, force)
src/workflows/archive-manuals.ts            CHANGED a tail: skills for tools just approved or re-indexed
src/lib/manuals/steps.ts, trigger.ts, start.ts  CHANGED counts; afterResearch tool ids passed through
src/lib/intake/approve.ts                   CHANGED approval asks for the skill
src/lib/ai/models.ts                        CHANGED job skillWrite
src/lib/manuals/search.ts                   CHANGED option publicFilesOnly
src/lib/actions/skills.ts                   NEW  skills.write, skills.set_after_research
src/lib/capabilities/skills.ts              NEW  get_tool_skill (capability "skills")
src/lib/capabilities/catalog.ts             CHANGED get_tool_details points to the skill
src/lib/capabilities/chat-adapter.ts, types.ts  CHANGED the "Tool skill" prompt section
src/lib/chat/tool-skill.ts                  NEW  the chat's read of the focused tool's skill
src/app/api/chat/route.ts                   CHANGED loads it on a tool page
src/app/admin/inventory/[tool]/skill/       NEW  the admin page, its server action, loading states
src/app/admin/settings/ai-agents/           CHANGED the "Skill writer" block and its server action
src/components/admin/skills/*               NEW  the page's islands
src/components/admin/ToolEditorPanel.tsx    CHANGED a "Tool skill" link
scripts/tool-skills.ts                      NEW  npm run tools:skills
```

`src/lib/skills/*`, `src/lib/data/tool-skills.ts` and the steps are plain Node (relative `.ts`
imports, no `"server-only"`): the workflow step bundle and the script load them.

### 3.2 Surfaces

- **Chat and MCP:** `get_tool_skill`, a read for everybody (capability `skills`, no permission),
  the same audience as `get_tool_details`: the published catalogue for everyone, drafts and
  archived tools too for staff (`tools.edit`). On a tool page the chat's prompt carries the skill
  (§5.6), so the model calls the tool only off a tool page.
- **GUI only:** writing (`skills.write`) and the setting (`skills.set_after_research`). Neither is
  offered to the assistant or over MCP.

### 3.3 Data implications

One new table, no change to any other. The Notion mirror does not carry skills (it mirrors the
catalogue, and a skill is derived). Backups and `data:push`: §4.3.

## 4. Data model

### 4.1 `tool_skills` (migration `0031_tool_skills`)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `tool_id` | uuid not null → `tools.id` **on delete cascade** | a skill means nothing without its tool |
| `version` | integer not null | 1, 2, 3… per tool, over every row; `unique (tool_id, version)` |
| `status` | text not null | `ready` \| `failed` (check constraint) |
| `content` | text not null | the rendered markdown; `''` for a failed row |
| `sections` | jsonb not null | the structured skill (§4.2); `{}` for a failed row |
| `sources` | jsonb not null | the sources the skill cites (§4.2); `[]` for a failed row |
| `input_hash` | text not null | `sha256:` of everything fed in (§5.3) |
| `model` | text not null | the Gateway model id, e.g. `openai/gpt-6-luna` |
| `cost_usd` | double precision not null default 0 | the Gateway's reported cost, 0 when none |
| `trigger` | text not null | `research` \| `manual` \| `backfill` (check constraint) |
| `error` | text null | a failed row's reason, one line, never a prompt |
| `created_at` | timestamptz not null default now() | |

Indexes: `(tool_id, version)` unique, `(tool_id, status, version)` for "the latest ready row",
`(created_at)` for the daily cap. Rows written before this change: none.

### 4.2 Shared types (`lib/skills/format.ts`)

```ts
type SkillSectionKey = "quickFacts" | "beforeYouStart" | "operatingProcedure" | "settingsAndLimits"
  | "materials" | "safety" | "whenToGetStaff";
interface SkillBullet { text: string; cites: string[]; origin: "lab" | "model" }
interface SkillTrouble { symptom: string; check: string; fix: string; cites: string[] }
interface SkillSections {
  format: 1;
  quickFacts: SkillBullet[]; beforeYouStart: SkillBullet[]; operatingProcedure: SkillBullet[];
  settingsAndLimits: SkillBullet[]; materials: SkillBullet[]; troubleshooting: SkillTrouble[];
  safety: SkillBullet[]; whenToGetStaff: SkillBullet[]; notInSources: string[];
  removed: { section: string; text: string; reason: RemovedReason }[];   // what the guard took out
  unknownCites: string[];                                                // ids the model made up
}
type SkillSource =
  | { id: "T1"; kind: "catalog"; toolName: string }
  | { id: string; kind: "lab_note"; scope: "tool" | "lab"; text: string }
  | { id: string; kind: "manual"; documentId: string; title: string; pageStart: number; pageEnd: number; section: string[] }
  | { id: "R1"; kind: "research"; urls: string[]; researchedAt: string | null }
  | { id: string; kind: "link"; title: string; type: string | null; url: string | null };
```

Source ids: `T1` the catalogue record; `N1…` the tool's lab notes; `L1…` lab-wide notes; `M1…`
manual passages; `R1` the research summary; `K1…` linked documents (title only, never read). Stored
`sources` hold only the ids the skill cites. A manual source names its document id and pages, never
a file URL, so a row is the same on every deployment.

### 4.3 Backup and `data:push`

`tool_skills` is **backed up and pushed**, the default, like `manual_eval_questions` and unlike
`starter_answers` and `chat_illustrations` (`DEPLOYMENT_BOUND`). The reason is the one those two
fail: a skill names no blob and no deployment-local address. Its manual sources are document ids
and pages (`data:push` keeps ids), its links are the manufacturer's URLs (a stored file's link is
kept as its title only), and its hash covers the same rows on both sides. So a skill written on a
local copy (the owner's "local first, then Vercel") is valid on the hosted one, and a restore keeps
what was paid for. `backup-policy.test.ts` asserts it.

### 4.4 The lab setting

`lab_settings` key `tool_skills`, value `{ afterResearch: boolean }`, validated on every read; no
row, or one that no longer parses, is **off**. No migration (`lab_settings` takes new keys).

## 5. Behavior / flow

### 5.1 Inputs (`lib/skills/inputs.ts`)

For one tool, not archived (a draft is fine):

1. **The catalogue record** (`T1`): display and official name, category, location, item kind,
   training (required or not), PPE, materials, use restrictions, emergency stop, description.
2. **The tool's lab notes** (`N1…`, `labNoteLines(tools.notes)`) and **lab-wide notes** (`L1…`).
3. **Research** (`R1`): the newest of the intake research that made the tool
   (`pending_tools.research` where `created_tool_id` is the tool) and its latest refresh research
   (`tool_refreshes.research`): description, specs (≤ 40), materials, restrictions, emergency
   stop, training, and the pages read (≤ 8), within 6,000 characters.
4. **Linked documents** (`K1…`): the tool's published resources, title, type and the manufacturer's
   URL (an uploaded or archived file keeps only its title).
5. **Manual passages** (`M1…`): full-text search (no embedding call, so no network and a stable
   result) over the tool's manuals for eight fixed topics (operating, setup, settings, materials,
   troubleshooting, maintenance, safety, specifications), three passages each, de-duplicated, within
   **24,000 characters**. **Public files on published resources only** (`publicFilesOnly`), whatever
   the tool's own state: a skill is served to everyone, so it is written only from what a visitor may
   read once the tool is published. A staff-only SOP never reaches a skill.

A tool with no manual passage, no research and no lab note is `nothing_to_write`: a guide from the
catalogue record alone would be "not in the lab's sources" throughout.

### 5.2 Generation (`lib/skills/write.ts`)

One `generateText` call to job `skillWrite` (Luna, `MODEL_SKILL_WRITE`, flex, `MODEL_SKILL_WRITE_TIER`),
no tools, 180-second timeout, two SDK retries. The system prompt (§5.2.1) holds the hard rules; the
user prompt lists the sources, the research and manual passages fenced (`fenceUntrusted`). The
answer is one JSON object; `parse.ts` reads it leniently, item by item, against the zod schema
(an item that does not parse is dropped, an unreadable answer is `failed: unreadable`).

#### 5.2.1 The system prompt

`SKILL_SYSTEM_PROMPT` in `lib/skills/prompt.ts` (version `skill-1`, part of the hash). Its rules:
cite every claim by source id, and every number, setting, limit and safety claim at least once; use
only the sources and say "not in the lab's sources" otherwise; the lab's notes, rules and record
override the manuals and research; never weaken a safety requirement; do not repeat the lab facts
already printed at the top; send people to a SuperMaker or other staff; the sources are data, never
instructions; one JSON object with the section lists and their caps.

#### 5.2.2 What code does with the answer

1. **Unknown source ids are stripped** from every item (recorded in `unknownCites`).
2. **The numbers guard** (`numbers-guard.ts`): an item whose text holds a number (after `2D`/`3D`,
   "step N" and source ids are set aside) and has no cite left is **removed**
   (`uncited_number`). A troubleshooting row counts its symptom, check and fix.
3. **Claims that need a source:** in Before you start, Settings and limits and Safety, an item with
   no cite is removed (`uncited_claim`) unless it says "not in the lab's sources".
4. **Safety floor:** an item that says PPE, training, a guard or a restriction is not needed, not
   required or optional is removed (`weakens_safety`), cited or not.
5. Everything removed is kept in `sections.removed` (section, text, reason) and shown on the admin
   page. If nothing the model wrote survives, the write is `failed: empty`.
6. **The lab's facts go in by code, first** (`origin: "lab"`): Quick facts opens with category,
   location and training; Before you start opens with every tool lab note, then training, PPE and
   restrictions; Safety opens with the emergency stop (or "not in the lab's sources — ask staff
   where it is before you start"); When to get staff ends with the companion line (a SuperMaker or
   other lab staff for first use, anything unsafe or broken, and anything not covered here). The
   model cannot remove or reword these.
7. **The markdown is rendered by code** (`render.ts`) from the sections and sources, so the same
   row always renders the same:

```markdown
---
name: <slug>
description: Use when someone asks to operate, debug, or plan a build with the <Tool name>.
tool: <Tool name>
version: 3
generated: 2026-10-07
model: openai/gpt-6-luna
---

# <Tool name>: operating guide

> AI-written from the lab's sources. Every fact cites one: [T1] the lab's record, [N…] lab notes,
> [L…] lab rules, [M…] manual pages, [R1] research, [K…] linked documents. Check the manual and lab
> staff for anything safety-related.

## Quick facts · ## Before you start · ## Operating procedure (numbered) · ## Settings and limits
## Materials · ## Troubleshooting (symptom → check → fix) · ## Safety and emergency stop
## When to get staff · ## Not in the lab's sources · ## Sources
```

8. The row is stored `ready` with the next version, the cited sources, the hash, the model and the
   Gateway's cost (`gatewayCallReport`), in one transaction under an advisory lock on the tool.

### 5.3 Skipping, failing and the cap

- **The hash** (`hash.ts`): SHA-256 of the canonical JSON of every input in §5.1 (manual passages by
  document, pages and text), the prompt version and the model id. Not the time, not the version.
- **Skip:** without `force`, a tool whose latest `ready` row has this hash is `up_to_date`. An
  automatic write also skips a tool whose latest row `failed` on this hash (`failed_before`), so a
  machine the model cannot write for is not retried every night; Rewrite and the backfill retry it.
- **Fail:** a non-transient failure (an unreadable answer, nothing left after the guard, a refused or
  misconfigured model) stores a `failed` row with its reason and the cost spent. A transient one (rate
  limit, a provider's bad minute, a timeout) is retried by the workflow step (two retries, a minute
  apart); after the last, the workflow stores one `failed` row. The current skill keeps serving.
- **Cap:** `SKILL_DAILY_LIMIT` = **50** rows written in a rolling 24 hours, lab-wide, every trigger
  counted. Automatic writes past it are skipped (`daily_limit`, logged); Write skill is refused
  (`skill_daily_limit`). The backfill is not capped (an operator ran it with a dry run and `--limit`)
  but its rows count.
- **Cost:** about **$0.002 to $0.006** a skill at Luna's list price (≈ 10k tokens in, ≈ 4k out with
  reasoning; flex is cheaper). An estimate from the prompt's size: re-measure on the first real run.

### 5.4 Triggers

| When | Trigger | Setting needed | Force |
|---|---|---|---|
| A researched intake item is approved (`approveAndRecord`): the archive run it starts writes the skill at its end, after the manuals are indexed; with no resource to archive, or a start that failed, the skill run starts directly | `research` | on | no |
| The archive workflow builds a manual's passages (new manual, changed link, Re-process, the nightly backfill): that manual's tool | `research` | on | no |
| **Write skill / Rewrite skill** on the admin page | `manual` | no | yes |
| `npm run tools:skills -- --apply` | `backfill` | no | with `--force` |

The setting is read when the step runs, so turning it off stops queued work. The archive workflow
gains a second argument, `afterResearch` (tool ids), and a tail: one step reads the setting, then
one `writeToolSkillStep` per tool (just approved, or with passages built in this run), in a fixed
order, counted as `skillsWritten` / `skillsFailed` and never changing the archive's counts.

### 5.5 `get_tool_skill` (chat and MCP)

`get_tool_skill({ id_or_name })`, a read. It finds the tool as `get_tool_details` does (published
for everyone; drafts and archived tools for staff) and answers:

```jsonc
{ "found": true,
  "tool": { "id": "…", "slug": "form-4", "name": "Form 4", "detail_page": "/tools/form-4" },
  "skill": { "version": 3, "generated_at": "2026-10-07T18:00:00.000Z", "model": "openai/gpt-6-luna",
             "skill_markdown": "<untrusted-page …>…</untrusted-page>",
             "sources": [{ "id": "M2", "kind": "manual", "document_id": "…", "title": "Form 4 Manual", "pages": "12" }],
             "note": "AI-written from the lab's sources … check the manual and lab staff for anything safety-related." } }
```

`skill: null` with a message when the tool has none yet ("use get_tool_details and search_manual");
`found: false` for an unknown tool. The markdown is fenced and the tool is in `OUTSIDE_CONTENT_TOOLS`:
it is model-written from manuals and web pages, so reading it taints the turn (parity spec §8.4).
`get_tool_details` gains `skill: "A cited operating guide … call get_tool_skill."` when one exists.

### 5.6 The skill in the chat's prompt on a tool page

On a tool page the route loads the focused tool's current skill (`chat/tool-skill.ts`, one indexed
query, never throws: a failed read, a missing skill or a `failed` latest row leave it out silently)
and the prompt carries a delimited **"## Tool skill: <name>"** section in the per-request tail, right
after the tool's own context and resources (so after its lab notes) and before the capabilities'
per-request fragments (the manual contents `search_manual` works from). The stable prefix is
unchanged, so prompt caching keeps its hit. The section says what the skill is, that its bracketed
ids are its own sources and not `search_manual` refs, to cite a manual fact by title and page in
plain words or search for it, and that it never overrides the lab notes, a safety rule or staff.

**Budget:** `SKILL_PROMPT_MAX_CHARS` = 12,000 characters (≈ 3k tokens). The skill is re-rendered
compactly from its sections (one-line sources, no URLs); past the budget, sections are dropped in
a fixed order (Materials, then the Sources line, then Quick facts, then Troubleshooting past its
first three rows, then Settings and limits past its first six, then Not in the lab's sources) and a
last line says the rest is in `get_tool_skill`; still over, it is cut at a line. Safety, Before you
start, the procedure and When to get staff are never dropped.

The turn starts tainted when the skill is in the prompt, as it does for attached manuals.

**Starter answers** keep their behaviour: `starters:refresh` runs the real chat route, so answers it
makes from now on include the skill; their hash does not include the skill's version yet (§11).

### 5.7 Unhappy paths

| What happens | What people see | What is stored |
|---|---|---|
| The setting is off | Nothing changes after research | Nothing |
| Model down or slow | The admin page still shows the last ready skill and "Last attempt failed" | One `failed` row after the step's retries |
| The model invents a figure | — | The bullet is removed and listed under "Removed by the checks" |
| The model cites a source id it was not given | — | The id is stripped; an item left with a number and no cite is removed |
| Nothing to write from | Write skill answers that there is nothing to write from yet | Nothing (`nothing_to_write`) |
| The cap is reached | Write skill: "The lab has written today's limit of tool skills" | Nothing |
| The workflow cannot start | Write skill: the existing `start_failed` sentence | Nothing |
| Chat on a tool page, skill read fails | The answer, without the skill | Nothing (a log line) |
| The tool is archived | Rewrite is refused (`not_found`); its skills stay, and `get_tool_skill` serves it to staff only | — |

## 6. UI

- **`/admin/inventory/<slug>/skill`** (`tools.edit`): the Inventory crumb, the tool's name, facts
  ("Version 3 · Written 2026-10-07 · openai/gpt-6-luna · $0.0031 · Up to date"), **Write skill** or
  **Rewrite skill** (an `AsyncButton`; the page then polls every 5 s for up to three minutes until a
  new row appears), "Last attempt failed: <reason>" when the latest row failed, the rendered skill
  (`system/Markdown`), its sources with links to the tool's public page and the manufacturer's
  pages, and "Removed by the checks" (a collapsed list). Empty state: "No skill yet." Freshness says
  "Out of date: something it was written from has changed" when the hash differs.
- **The tool editor** gets a small "Tool skill" section with a link to that page.
- **Settings › AI agents:** a "Skill writer" block: what it does, "Up to 50 skills a day for the
  lab, at about $0.002 to $0.006 a skill", the setting's state, and **Turn on / Turn off** for a
  director (`users.manage`); a SuperMaker reads "Directors turn this on or off."
- Strings: `admin.skills.*`, `admin.agents.skills*`, `admin.errors.skill_daily_limit`,
  `admin.errors.nothing_to_write`, `chat.readingToolSkill`, `assistantPage.*` rows, in English;
  the other locales fall back to English until the translation pass (Article 6).
- Light and dark through the theme tokens; the page is one column at phone width.

## 7. Relationship to existing work

- **Manual text spec** amendment 2026-10-07 (eval questions) is the model for a step after the
  archive's main work; this adds a second tail after it.
- **Assistant–GUI parity spec**: an amendment registers `skills.write` and
  `skills.set_after_research` (GUI only) and the new read; the counts change (§10).
- **Gateway spec**: an amendment adds job `skillWrite`.
- **Admin sections spec**: the Skill writer block sits on Settings › AI agents beside the research
  budget.
- **Identity spec**, "Lab notes" and "Companion, not a replacement": the skill puts lab notes first
  and points to people, by code.

## 8. Security and safety

- **Authorization:** `get_tool_skill` is open to everyone, gated like `get_tool_details` (published
  tools only for anyone without `tools.edit`, in `run()`'s catalogue choice, as `get_tool_details`
  does). Write skill needs `tools.edit`; the setting needs `users.manage`. Both through
  `performAction`; refusals are values.
- **What a skill may contain:** only public manual files, the published catalogue record, lab notes
  (public on the tool page already), linked documents' titles and the manufacturer's URLs, and
  research summaries. No private SOP, no staff-only field, no unit serials, no names.
- **Rate limiting:** the chat and MCP routes' existing limiters cover the read; the actions go
  through `authorizeAdminAction`'s limiter; the daily cap bounds spending.
- **Prompt injection:** research and manual text reach the writer fenced, with no tools; the answer
  passes zod, the numbers guard and the safety checks; the lab's facts are inserted by code. The
  finished skill is fenced again wherever a model reads it, and taints the turn.
- **Safety:** the lab's rules first, by code; "not in the lab's sources" over guessing; weakening
  language removed; every reader is told to check the manual and staff for anything safety-related.
- **PII:** none. Logs carry tool ids, counts, tokens and cost, never the prompt or the skill.
- **Write safety (Article 5):** a skill publishes nothing in the catalogue and changes no record.

## 9. Phased build order

One phase, one PR: table, job, writer, workflow and triggers, the setting, the admin page, the read
capability and the chat section, the script, docs and tests.

## 10. Testing

- **Unit:** `skills/parse.test.ts` (the zod shapes, lenient item-by-item reading, an unreadable
  answer); `numbers-guard.test.ts` (uncited numbers removed, 2D/3D and step numbers allowed, unknown
  ids stripped, uncited claims in safety sections, weakening language, negations kept);
  `render.test.ts` (the lab's facts first, header, numbered steps, troubleshooting, sources,
  flattened links, compact form within budget, never dropping Safety); `write.test.ts` (PGlite, a
  stub model: writes, the hash, skips unchanged, rewrites on a changed note, `force`, failed rows,
  `failed_before`, the cap, `nothing_to_write`, research as `R1`, public files only, drafts, the dry
  run); `steps.test.ts` (the setting read when the step runs, retries, the failure row);
  `targets.test.ts`.
- **Workflow:** `workflows/tool-skills.workflow.test.ts` under `@workflow/vitest` with the Gateway
  stubbed at its wire: off → no call; on → one call on flex and a stored row; a second run → skipped;
  forced → written again. `archive-manuals.workflow.test.ts`: the setting off, no skill call;
  `archive-manuals.test.ts`: the tail's order and counts; `intake/approve.test.ts`: the approval hook.
- **Actions and pages:** `app/admin/inventory/[tool]/skill/actions.test.ts` (permission, cap,
  nothing to write, start) and `page.test.tsx`; `app/admin/settings/ai-agents/actions.test.ts`
  (`users.manage` only, off by default) and `page.test.tsx`; `components/admin/skills/*.test.tsx`.
- **Capability:** `capabilities/skills.test.ts` (access, drafts hidden from students, output shape,
  fenced markdown, no skill yet); `mcp/route.test.ts`, `mcp-catalog.test.ts`,
  `capabilities/actions.test.ts` counts; the chat route test (a tool page with a skill puts it in the
  prompt; without one, or off a tool page, it does not).
- **Script:** `scripts/tool-skills.test.ts` (arguments; the dry run calls no model and writes
  nothing; `--apply` writes).
- **Migration:** `db/schema/tool-skills-migration.test.ts` (journal order, columns, cascade, checks).
- **Existing:** backup policy, `data:push` plan, parity guard, spec drift, `/assistant` page.

Embarrassing in production, and covered: a skill that invents a laser power; a skill that tells a
student goggles are optional; a staff-only SOP quoted to a visitor; the cap ignored.

## 11. Open questions

| # | Question | Who |
|---|---|---|
| 1 | **Show the skill on the public tool page?** Staff review it on the admin page first. | Isaac + Niti |
| 2 | **Refresh after refresh research.** Accepted refresh changes alter `T1`; the hash sees it, but no trigger runs. Add one, or leave it to Rewrite and the backfill? | Isaac |
| 3 | **Starter answers and skills.** Add the skill's version to the starter answers' hash, so a new skill refreshes them? | Isaac |
| 4 | **Taint on tool pages.** A tool page with a skill starts every staff turn tainted, so destructive and people proposals are refused there (as with an attached manual). The editor on the same page does them. Keep, or treat the skill as the lab's own text once staff review it? | Isaac |
| 5 | **The cost estimate.** Re-measure on the first real run and adjust `SKILL_ESTIMATED_USD`. | Isaac |
| 6 | **Migration number.** `0031` is the next free number on `main` today; a branch that lands first takes it and this one renumbers. | whoever merges |

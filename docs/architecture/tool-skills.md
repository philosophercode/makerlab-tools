# Tool skills

> Tool skills spec: [`docs/specs/2026-10-07-tool-skills-design.md`](../specs/2026-10-07-tool-skills-design.md).
> Paths are relative to the repository root.

## What a tool skill is (`tool_skills`, migration `0031`)

A **tool skill** is one machine's cited operating guide, in the shape of a Claude Code
`SKILL.md`: a header (`name`, `description`: "Use when someone asks to operate, debug, or plan a
build with the <tool>") and the sections Quick facts · Before you start · Operating procedure ·
Settings and limits · Materials · Troubleshooting · Safety and emergency stop · When to get staff ·
Not in the lab's sources · Sources. Retrieval over the manuals stays the way questions are answered
(`search_manual`); the skill is the guide any connected AI reads to help someone use the machine.

- **The table.** `tool_skills` (`src/lib/db/schema/tool-skills.ts`): every attempt a tool has had,
  `ready` or `failed`, versioned per tool (`unique (tool_id, version)`), with the rendered markdown
  (`content`), the structured form (`sections`), the cited sources (`sources`: a manual by document id
  and pages, never a file URL), `input_hash`, `model`, `cost_usd`, `trigger` (`research` | `manual` |
  `backfill`), `error`. A tool's **current skill** is its latest `ready` row. Cascades with its tool.
  Backed up and pushed by `data:push` (the default): it names no blob and no local address
  (`backup-policy.ts` says why it is not `DEPLOYMENT_BOUND`).
- **Reads and the write:** `src/lib/data/tool-skills.ts` (`currentToolSkill`, `latestToolSkill`,
  `insertToolSkill` under an advisory lock on the tool, `countToolSkillsSince` for the cap,
  `listToolsForSkills`); `src/lib/skills/read.ts` validates the stored JSON for readers.

## Writing one (`src/lib/skills/*`, plain Node)

1. **Inputs** (`inputs.ts`): `T1` the catalogue record (drafts included, archived tools never);
   `N…` the tool's lab notes and `L…` the lab-wide notes; `R1` the newest research (the intake
   research that created the tool, or its latest refresh), summarised within 6,000 characters with
   the pages it read; `K…` its published links (the manufacturer's URL; a stored file keeps its title
   only); `M…` manual passages from **full-text** search (`mode: "fts"`, no embedding call) for eight
   fixed topics, three each, within 24,000 characters, from **public files on published resources
   only** (`searchManuals({ publicFilesOnly: true })`), so no staff-only SOP reaches a skill served to
   everyone. A tool with no passage, no research and no lab note is `nothing_to_write`.
2. **Hash** (`hash.ts`): SHA-256 of the canonical JSON of every input, the prompt version
   (`SKILL_PROMPT_VERSION`) and the model id. Without `force`, a tool whose current skill has this
   hash is skipped; the automatic pass also skips a tool whose latest attempt failed on it.
3. **The model** (`write.ts`, `prompt.ts`): one `generateText` to job **`skillWrite`** (Luna, flex,
   `MODEL_SKILL_WRITE`), no tools, the research and passages fenced. The system prompt's hard rules:
   cite every claim by source id; every number, setting, limit and safety claim cited; only the
   sources, else "not in the lab's sources"; the lab's notes, rules and record override the manual;
   never weaken a safety requirement; people for first use and anything unsafe. JSON out.
4. **Checks** (`parse.ts`, `numbers-guard.ts`): read item by item against zod (`format.ts`); unknown
   source ids stripped; **the numbers guard** removes any item stating a number with no cite left;
   Before you start, Settings and limits and Safety need a cite (or "not in the lab's sources");
   weakening language ("goggles are optional", "bypass the interlock") is removed whatever it cites.
   Everything removed is kept in `sections.removed`. Nothing left is `failed: empty`.
5. **Compose and render** (`compose.ts`, `render.ts`): the lab's facts go in by code, first
   (`origin: "lab"`): the tool's lab notes, training, PPE (never "none needed"), restrictions, the
   emergency stop (or "not in the lab's sources"), the companion line. The markdown is rendered by
   code; links a model wrote are flattened to their text.
6. **Store:** the next version, the cited sources, the hash, the model and the Gateway's cost.
   Failures are values: transient ones (rate limit, timeout) are retried by the workflow step and
   stored as one failed row after the last try; the rest are stored as failed rows with their reason.
   The current skill keeps serving.

**Cap and cost** (`limits.ts`): 50 rows a rolling day, lab-wide, every trigger counted; the automatic
pass and Write skill stop at it, the backfill does not. About $0.002–$0.006 a skill at Luna's list
price (an estimate; re-measure).

## When it runs

- **The setting** "Write a tool skill after research" (`lab_settings` key `tool_skills`,
  `{ afterResearch }`, `src/lib/skills/setting.ts`): **off** by default; a director turns it on on
  Settings › AI agents (`skills.set_after_research`, `users.manage`). Read when a step runs.
- **After an intake approval** (`intake/approve.ts`), when on: the archive run it starts gets the new
  tool as `afterResearch` and writes its skill at its end, after the manuals are indexed
  (`src/workflows/archive-manuals.ts`'s tail: `toolSkillTargetsStep`, then `writeToolSkillStep` per
  tool). With nothing to archive, or no run started, the approval starts `writeToolSkills` itself.
- **After a manual's passages are built** (new manual, changed link, Re-process, the nightly
  backfill): the same tail refreshes that manual's tool, skipped when nothing changed.
- **Write skill / Rewrite skill** on `/admin/inventory/<slug>/skill` (`skills.write`, `tools.edit`,
  spend, GUI only): starts `src/workflows/tool-skills.ts` (`writeToolSkills`), forced, capped.
- **`npm run tools:skills -- [--apply] [--tool <slug>] [--limit N] [--force]`**
  (`scripts/tool-skills.ts`): a dry run by default (each tool's plan or skip, the estimate at Luna's
  list price); `--apply` writes with trigger `backfill`. Same target order as `manuals:index`.

## Reading one

- **`get_tool_skill`** (`src/lib/capabilities/skills.ts`, capability `skills`): a read for everybody
  in the chat and over MCP, the same audience as `get_tool_details` (published tools for everyone;
  drafts and archived tools for `tools.edit`). Fenced markdown, sources, version, date, model and the
  note "check the manual and lab staff for anything safety-related". In `OUTSIDE_CONTENT_TOOLS`: it
  taints the turn. `get_tool_details` adds a `skill` pointer when one exists.
- **The chat on a tool page** (`src/lib/chat/tool-skill.ts`, the chat route): the current skill,
  re-rendered compactly within 12,000 characters (`renderSkillCompact`: Materials, the Sources line,
  Quick facts, Troubleshooting past three rows, Settings past six and Not in the lab's sources are
  dropped in that order; Safety, Before you start, the procedure and When to get staff never), is put
  in the prompt's per-request tail as "## Tool skill: <name>", fenced, after the tool's own context
  and resources and before the capabilities' per-request fragments. The stable prefix is unchanged.
  A missing skill, a failed latest attempt or a failed read leaves it out silently. The turn starts
  tainted with it, as with an attached manual.
- **The admin page** (`src/app/admin/inventory/[tool]/skill/`, `components/admin/skills/*`): facts
  (version, date, model, cost, trigger, up to date or not), Write / Rewrite (polls until the new
  attempt shows), a failed later attempt, the rendered skill and its `SKILL.md`, sources, and what the
  checks removed. The tool editor links to it.

## Tests

`src/lib/skills/*.test.ts` (schema, parser, guard, renderer, writer against PGlite with a stub model,
steps, targets), `scripts/tool-skills.test.ts`, `src/workflows/tool-skills.workflow.test.ts` (the
Gateway stubbed at its wire), the archive workflow's tail (`archive-manuals.test.ts`), the approval
hook (`intake/approve.test.ts`), the actions and pages, `capabilities/skills.test.ts`, the chat route's
prompt section, and `db/schema/tool-skills-migration.test.ts`.

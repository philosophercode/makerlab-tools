# Official and Display Names for Tools — Design Spec

**Date:** 2026-09-24
**Status:** Approved for planning (owner's decision, 2026-09-24)
**Target:** `v5/`
**Branch:** `v5/display-names`
**Spec PR:** #TBD · **Implementation PR:** #TBD

## 1. Summary

A tool has **two names**. Today it has one, and it is doing two jobs badly: the imported
inventory carries names like "STANLEY 20-221 10-Inch 12 Points Per Inch SharpTooth Mini
Utility Saw" and "Shopbot Buddy BT48[L36” x W76” x H67”]", which are precise enough to
find a manual by but unreadable on a gallery card, a chat chip or a QR label; and refresh
research keeps proposing longer, more exact names for tools people already call something
short.

- **Official name** — the full product name with brand and model or part number, e.g.
  "Makita 196094-2 Compact Router Plunge Base", "DRILL MASTER 1500 Watt Dual-Temperature
  Heat Gun (Model 96289)". Shown on the tool page under the title; used for search,
  manuals, research and MCP.
- **Display name** — short, what people say: brand plus what it is, or the well-known
  model name when that is how people refer to it ("Makita Plunge Base", "Drill Master Heat
  Gun", "Formlabs Form 4", "Bambu Lab X2D", "Trotec Speedy 400", "Othermill Pro"). No part
  numbers, about 30 characters, **hard cap 40**. Shown everywhere a tool is named in
  passing: gallery cards and tables, chat starter chips and answers, the tool page title
  and breadcrumb, admin tables, the Notion mirror's title.

No architecture change. One nullable column, one prompt change, one proposal field, one
backfill script.

## 2. Goals / Non-goals

### Goals

- Every tool has a display name ≤ 40 characters with no part number, and may have an
  official name; the tool page shows both when they differ.
- Research (intake and refresh) returns both names in the read call it already makes; code
  enforces the display rules, so a model that ignores them cannot put a part number on a
  card.
- Search — the gallery, the admin inventory filter and the assistant's `search_tools` /
  `get_tool_details` — matches either name.
- Existing names are fixed by a backfill that never invents an official name and never
  overwrites one.
- Lab-set display names are kept: research proposes a display name only when the current
  one is missing or breaks the rules, never for style (the same stance as lab rules,
  refresh amendment 2026-09-24).

### Non-goals (this iteration)

- **Changing slugs.** A slug is derived from the name once, at creation, and never
  changes (data platform §4.4). Renames here move no URL and no printed QR label.
- **Inventing official names in the backfill.** It only moves the long form it already
  has; official names for the rest come from refresh research proposals, with quotes.
- **A Notion mirror property for the official name.** A new property puts every existing
  mirror in `schema_mismatch` (the same reason starter questions are not mirrored). The
  mirror's title is the display name, as it is the `name` column today.
- **Localised names.** Names are data, English as written.

## 3. Architecture

- **Data layer.** `tools.name` stays and **is the display name**; `tools.official_name`
  (text, nullable) is added. Everything that names a tool today — the gallery, the tool
  page, breadcrumbs, admin tables, the chat's catalogue prompt, QR labels, unit labels
  ("Form 4 #1"), the mirror's title, the duplicate check's trigram index, the slug — already
  reads `name`, and every one of them wants the short name. Adding `display_name` instead
  would mean touching all of them and leaving `name` meaning "official" behind a word that
  says neither. The official name is additive: null means "not recorded", and every reader
  falls back to `name`.
- **One rule module.** `src/lib/tool-names.ts` (pure, plain Node, client-safe):
  `DISPLAY_NAME_MAX = 40`, `DISPLAY_NAME_TARGET = 30`, `OFFICIAL_NAME_MAX = 200`,
  `looksLikePartNumber(token)`, `displayNameProblems(name)`,
  `cleanDisplayName(raw)` (the guard) and `officialNameShown(tool)` (the subtitle rule).
- **Model jobs.** Research is unchanged in models and tiers (Luna, flex). The backfill adds
  one job, **`displayName`** (`openai/gpt-6-luna`, flex, `MODEL_DISPLAY_NAME`,
  `MODEL_DISPLAY_NAME_TIER`): one small call per tool that needs shortening, no tools, the
  name fenced as untrusted data.
- **Surfaces.** Chat and MCP both carry both names (§5.6). No new capability tool.

## 4. Data model

Migration **`0015_tool_official_name`**:

```sql
ALTER TABLE "tools" ADD COLUMN "official_name" text;
```

Nullable, no default, no backfill in SQL. Existing rows keep `name` as their display name
until the backfill or a person changes it.

**`pending_tools` gets no column.** A pending item's `name` is what somebody typed or what
Suggest names settled — the thing research searches by — and research's two names live in
`pending_tools.research` (jsonb):

```ts
interface ResearchResult {
  /** The official name — the full make and model, as the pages name it. Key kept so stored rows parse. */
  canonicalName: string;
  /** Short name per the display rules; absent on rows researched before this spec. */
  displayName?: string;
  // …unchanged
}
```

`canonicalName` keeps its key because every stored research row, the E2E Gateway stub and
the citation map use it; it is documented as the official name. The model is asked for
`officialName` and `displayName`; the parser accepts `officialName` or the old
`canonicalName` into `canonicalName`.

**Bulk intake's `NameSuggestion`** (jsonb on `pending_tools.name_suggestion`) gains
optional `displayName`.

**View types.** `MakerLabTool.officialName?: string | null`, `EditableTool.officialName`,
`ToolPatch.officialName`, `NewToolRecord.officialName`, `ApprovalFields.officialName`.

**Proposal fields.** `PROPOSAL_FIELDS` gains **`official_name`**. `name` now means the
display name. The research quote for the name (`citations.name`, key unchanged) backs both.

## 5. Behavior / flow

### 5.1 The display rules (in code)

A display name is refused as-is (`displayNameProblems`) when it is empty, longer than 40,
or contains any of:

- a **part-number-like token**: four or more digits (`575267`, `196094-2`, `20-221`), or
  letters and digits mixed with three or more digits (`DCB107`, `P593`, `MR7F2LL`), or a
  `#123` / `No. 123` code — but **not** a short model name (`Form 4`, `X2D`, `MK4`, `MK4S`,
  `Speedy 400`, `X1-Carbon`, `S5`, `BT48`);
- **bracketed noise**: anything in `[…]`, or a `(…)` holding a part number or "Model …";
- a **spec run**: `10-Inch`, `12V/20V`, `18-Volt`, `1500 Watt`, `16 Piece`, `3/8"`.

`cleanDisplayName(raw)` is the guard applied to every model answer: drop bracketed noise
and part-number tokens and spec runs, collapse spaces and dangling punctuation, and cut at
a word boundary to ≤ 40. It never adds anything, and it leaves a clean name unchanged. When
the guard leaves nothing, the caller falls back (research: to the official name cut to 40
at a word boundary; the backfill: skip the tool).

### 5.2 Research (intake and refresh)

The read prompt asks for `officialName` ("the full product name as the manufacturer
writes it: brand, product line, model and part or model number when the pages give one")
and `displayName` (the rules above, with the owner's examples). `assembleResearchResult`
stores `canonicalName` = official (fallback: the item's name) and `displayName` =
`cleanDisplayName(draft.displayName)` or, when that is empty, the guard applied to the
official name. A **Description** redo that keeps the old `canonicalName` keeps the old
`displayName` too (`focus-merge.ts`).

### 5.3 Intake approval

The preliminary page's **Name** box starts from `research.displayName` (else the item's
name), `maxLength` 40, with the rule as a hint; a new **Official name** box starts from
`research.canonicalName`, optional, ≤ 200. Approval writes `name` and `official_name`
(null when blank or equal to the display name). `approvePendingTool` refuses a display
name over 40 (`invalid_field`). Unit labels keep using the display name.

### 5.4 Bulk intake — Suggest names

The `nameSuggest` answer adds `displayName`. **Accept** still sets the pending item's
`name` to the official (`canonicalName`) — it is what research searches by — and research
then proposes the display name. The import table shows both ("Makita 196094-2 Compact
Router Plunge Base · shows as Makita Plunge Base").

### 5.5 Refresh research

- Blind input names the tool by its **official name when it has one**, else its name.
- **`official_name`** is proposed (*new* when empty, *differs* when the normalized names
  differ) only when research's name has a **verified quote** — the existing rule for the
  name, moved to the field it belongs to.
- **`name`** (display) is proposed **only when the current display name breaks the rules**
  (`displayNameProblems` non-empty) **and** research's name has a verified quote. A lab's
  short name that follows the rules is never proposed away, however research would have
  styled it. The proposed value is research's cleaned `displayName`.
- A published tool's display rename still needs `tools.publish`; an official-name change
  does not (it does not change what the catalogue calls the tool).
- The assistant's `get_record` shows both; `propose_change` accepts `official_name`, and
  refuses a `name` proposal that breaks the rules (`invalid_field`) — the same guard.

### 5.6 Chat, MCP and search

- The chat's catalogue prompt lists `**Form 4** (official: Formlabs Form 4 …)` only when
  the official name differs; links and answers use the display name.
- `search_tools` and `get_tool_details` match either name; both return `official_name`.
  `list_tools` entries carry `official_name` when set.
- MCP `create_tool` accepts optional `official_name`; a `name` that breaks the rules with
  no official name becomes the official name, and the display name is its cleaned form
  (the create result says so in `warnings`).
- Gallery (`GalleryShell`) and admin inventory search keys add the official name directly
  after the name.
- Intake's duplicate check (`data/duplicates.ts`) matches a tool's official name as well as
  its display name — an identified "Makita 196094-2 …" finds "Makita Plunge Base".
- The bundled fallback photos in `public/tool-images/` are named after the imported long
  names, which the backfill moves to `official_name`; `toolImageSrc` picks whichever of
  the two names has a bundled photo (`data/bundled-tool-images.ts`, kept equal to the
  folder by a test).

### 5.7 Import from Notion

Unchanged: the Notion title becomes `name`, `official_name` stays null. The backfill is
the one place names are split.

### 5.8 Backfill

`npm run names:backfill -- [--dry-run] [--ids a,b] [--limit N]`
(`scripts/backfill-display-names.ts`), same target order as the import and the
starter-question backfill (stop the dev server for a local PGlite):

1. For each tool (archived included), if `displayNameProblems(name)` is empty — **keep
   it**, nothing written.
2. Otherwise ask the `displayName` job for a short name from the current name alone
   (fenced, no tools, flex), guard it with `cleanDisplayName`, and fall back to the guard
   applied to the current name when the model's answer is unusable.
3. Write `name` = the short name and, **only when `official_name` is empty**,
   `official_name` = the old name, through `updateTool` with the revision check (so the
   cache is invalidated and the mirror triggered by the normal path when run in-app; the
   script prints a reminder to revalidate).
4. `--dry-run` prints `before → after (official: …)` for every tool it would change, calls
   the model (so the preview is real), and writes nothing. Tokens and Gateway cost printed.

## 6. UI

- **Tool page** (`DetailShell`): `h1` = display name; directly under it, when
  `officialName` is set and differs (normalized), a muted line with the official name
  (`.td-official-name`). Breadcrumb = display name.
- **Gallery cards and table, admin inventory table, intake list, refresh list, chat chips,
  QR labels** — unchanged code, since they read `name`.
- **Tool editor** (`ToolFieldsForm`): **Display name** (required, `maxLength` 40, hint:
  "Short, what people call it — brand and what it is, or the model people know. No part
  numbers; about 30 characters.") and **Official name** (optional, ≤ 200, hint: "The full
  product name with model or part number, as the manufacturer writes it. Used for search,
  manuals and research."). Both take part in the conflict diff. A save refused because the
  display name breaks the cap is `invalid_field`, the existing message.
- **Refresh review**: an `official_name` card is labelled "Official name".
- Strings are English in `messages/en.json` (admin strings are English-first, like the
  other 2026-09 admin features; other locales fall back).

## 7. Relationship to existing work

Extends the data platform spec §4.4 (`tools`), the refresh research spec §3.2 (the name
rule moves to `official_name`; lab-set names kept, like the 2026-09-24 lab-rules
amendment), bulk intake §3.3 (Suggest names), the MCP access spec (tool details and
`propose_change`), and the gateway spec's job registry (one new flex job). Supersedes the
refresh spec's "73 names that aren't the manufacturer's" framing: those become
`official_name` proposals, not renames.

## 8. Security and safety

- **Authorization:** unchanged — editing is `tools.edit`; renaming a published tool's
  display name is `tools.publish`; the official name is an ordinary edit.
- **Untrusted input:** the display name a model returns is guarded in code before it is
  stored or shown; the backfill's model sees only the tool's current name, fenced.
- **Write safety:** research never writes a name — every change is a proposal or a
  reviewer's approval (Article 5). The backfill writes only through `updateTool`'s
  revision check and never overwrites a non-empty official name.
- **PII:** none. Names are equipment data.
- **Rate limiting / caching:** no new route. Writes invalidate the catalogue as today.

## 9. Phased build order

One phase: migration → rule module → research and parsing → approval, refresh, curation,
MCP → UI and search → backfill → tests. Each step leaves `main` deployable; the column is
nullable and every reader falls back.

## 10. Testing

Offline (Article 3):

- **Rule module:** the cap; part-number stripping keeps `Form 4`, `X2D`, `MK4`, `MK4S`,
  `Speedy 400`, `X1-Carbon`, `Othermill Pro`; strips `196094-2`, `DCB107`, `575267`,
  `[MR7F2LL./A]`, `(Model 96289)`, `20-221`; spec runs; never adds text.
- **Prompt / parse / assemble:** the read prompt asks for both; `officialName` and legacy
  `canonicalName` both parse; a display name with a part number is cleaned; an empty one
  falls back to the guarded official name; old rows without `displayName` parse.
- **Approval:** both names copied; over-40 display name refused; blank official → null.
- **Refresh:** `official_name` proposed with a verified quote only; a rule-following lab
  display name is **kept** (no `name` proposal) even when research's differs; a
  part-numbered display name gets a `name` proposal; blind input prefers the official name.
- **Suggest names:** both names parsed; Accept keeps the official as the pending name.
- **UI:** the tool page shows the subtitle only when it differs; the gallery searches the
  official name; the editor shows both fields and sends only what changed.
- **Search / MCP:** `search_tools` finds a tool by its official name; `get_tool_details`
  returns `official_name`.
- **Backfill:** dry run writes nothing; long names shortened with the old name moved to
  official; a non-empty official name is never overwritten; clean names untouched.

Embarrassing in production: a part number on a gallery card; a lab's name replaced by
research's styling; an official name overwritten by a backfill; a changed slug.

## 11. Open questions

None blocking. Whether the mirror should carry the official name as a property is left for
when a mirror schema migration exists.

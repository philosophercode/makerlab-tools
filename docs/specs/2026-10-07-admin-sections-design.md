# Admin Sections: Six Jobs Instead of Thirteen Links — Design Spec

**Date:** 2026-10-07
**Status:** Implemented
**Target:** the app (repository root)
**Branch:** `v5/admin-sections` (on top of `v5/tool-scoped-citations`)
**Spec PR:** with the implementation · **Implementation PR:** not opened yet

## 1. Summary

The admin area had a section bar of thirteen links plus the assistant, grouped
by the life of a piece of equipment (Add equipment, Keep data fresh, Queues,
People & settings). At 1440 px the bar already clipped, on a phone four links
fit, and SuperMakers met an intake queue before the maintenance they came in to
do. The design review of 2026-10-06 (`docs/MakerLab_design/review-2026-10-06/`)
proposed grouping the admin by the job a person came to do, and the owner
decided the names on 2026-10-07 (`decisions.md` there).

The bar now has six sections and the assistant: **Overview**, **Maintenance**,
**Inventory**, **People**, **Insights**, **Settings**, then **Ask MakerLAB AI**.
Each section opens on a real page. The other pages of a section are tabs under
the page header, so every page is still one click from the bar, and every page
is in the ⌘K palette. Overview replaces the tiles home: **Need to know** (the
urgent block), the **Shift checklist**, quick actions (Print QR labels first),
**Waiting for a decision** and **Inventory health**.

No route moved. Every admin address that worked before still opens its page,
so bookmarks, the MCP server's own instructions (`/admin/proposals`) and links
in tickets keep working. A few new names redirect to the page that holds them.

## 2. Goals / Non-goals

### Goals

- Six sections in the bar, named as the owner decided, in the order a shift
  meets them; Ask MakerLAB AI at the end.
- Every one of the 37 admin features the review mapped is reachable from the
  new structure (§5.3). Nothing is dropped.
- Every old admin URL still opens its page; new section names redirect.
- **Need to know** on the overview: urgent tickets, overdue recurring tasks,
  tickets that name no machine.
- **Shift checklist**: the recurring tasks due, with Done, Add a note and Mark
  resolved on an open issue of the same machine; on the overview and as a
  Maintenance tab.
- **MCP** (was "Assistant proposals"/"Connected assistants") and **AI agents**
  (the research and intake agents, and the research budget moved from People)
  under Settings.
- QR labels easy to find: an Inventory tab, the first quick action on the
  overview, a palette entry, and a button on All tools.
- Role differences kept: nothing is offered that the viewer's role would
  refuse, and a section with nothing open to the viewer is not shown.

### Non-goals (this iteration)

- **Moving routes.** Paths like `/admin/intake` and `/admin/refresh` keep their
  names. Renaming them to `/admin/inventory/add` and so on would touch every
  `revalidatePath`, every e2e spec and the MCP instructions, for no gain a
  person sees. The redirects cover the new names.
- **Splitting the roster page.** Blocked addresses stay on the roster page; the
  review suggested a tab of their own, the decisions did not.
- **The overview's "This week" band for directors, "Your first shift" and "Set
  up the lab" lists, "Mark a unit down", duplicate merging, and "units without
  a QR label"** (which needs a "label printed" field). Named in the review, not
  in the decisions; left for later specs.
- **Renaming the chat's "Intake page" wording** (public strings in twelve
  locales). The page is titled Add equipment; the chat's link text is a
  follow-up.
- **Translating admin strings.** Admin strings are English (Article 6 as
  amended); only `chat.askAssistant`, which only staff see, changed in the chat
  namespace.

## 3. Architecture

- **`src/lib/admin/surfaces.ts` stays the one list.** Each surface now carries a
  `section` instead of a `group`. `ADMIN_SECTIONS` is the bar's order.
  `sectionsFor(items)` gives the bar's links (Overview always, then each section
  with at least one open surface, linked to the first of them).
  `currentSection(pathname, items)` marks the bar. `count` became optional:
  pages with nothing to count (checklist, recurring tasks, QR labels, lab
  notes, settings, AI agents) have none.
- **The tabs come from the layout.** `app/admin/layout.tsx` already resolved
  the viewer's surfaces for the bar; it now also hands them to
  `AdminSurfacesProvider`. `AdminPageHeader` draws `SectionTabs` for its
  surface's section (not on an item's page). `SectionTabs` reads the provider,
  so no page resolves the identity again for its tabs. A section with one open
  surface draws no tabs.
- **New pages**, each with its own `loading.tsx` (DESIGN.md §8.12):
  `/admin/maintenance/checklist` (`maintenance.manage`), `/admin/settings`
  (any admin-surface permission), `/admin/settings/ai-agents` (`tools.edit`;
  the budget form needs `users.manage`), and `/admin/people`, which redirects to
  the first People page the viewer may open.
- **New read**: `lib/data/units-down.ts` `listUnitsDown()`: units out of
  service or under maintenance on unarchived tools, by name, bounded at 50.
- **No new actions.** The checklist's Mark resolved and the overview's Take it
  call `updateTicket` (`tickets.update`, `maintenance.manage`). Its
  `revalidate` list, `tickets.log_completed`'s and the `schedules.*` actions'
  gain `/admin` and `/admin/maintenance/checklist`. The research budget's
  `people.grant_allowance` now refreshes `/admin/settings/ai-agents`.
- **No migration**, no change to the Notion mirror, MCP or the assistant's
  tools.

## 4. Data model

Nothing stored changes. The client-safe types:

```ts
export const ADMIN_SECTIONS = ["overview", "maintenance", "inventory", "people", "insights", "settings"] as const;
export interface AdminSurface {
  key: SurfaceKey;
  href: string;
  section: Exclude<AdminSection, "overview">;
  permission: Permission | readonly Permission[];
  icon: LucideIcon;
  count?: CountLoader;
  alsoCounts?: readonly { loader: CountLoader; permission: Permission }[];
}
```

## 5. Behavior / flow

### 5.1 The bar and the tabs

| Section | Opens | Tabs (in order) |
|---|---|---|
| Overview | `/admin` | none |
| Maintenance | `/admin/maintenance` | Tickets · Shift checklist · Recurring tasks |
| Inventory | `/admin/inventory` | All tools · Add equipment · QR labels · Lab notes · Manuals · Check for updates · Categories · Page corrections |
| People | `/admin/users` (director) or `/admin/projects` (SuperMaker) | Roster · Student projects (director only; a SuperMaker has one page, so no tabs) |
| Insights | `/admin/insights` | none from the section; Insights keeps its own Usage · Value report tabs |
| Settings | `/admin/settings` | General · Notion mirror · MCP · AI agents |

Add equipment keeps its own Queue · Imports tabs and its Import a list action,
under the section tabs.

### 5.2 What each role sees

| Role | Bar | Differences inside |
|---|---|---|
| SuperMaker (`admin`) | all six | People opens Student projects; no Roster; AI agents shows the budget as "directors grant extra items"; Export CSV absent on All tools (as before) |
| Director (`super_admin`) | all six | Roster tab; the research budget form; Export CSV |
| Student, anonymous | none (refused in words, as before) | |

### 5.3 The 37 features, placed

The review's table (`critique.md` §2), as built. Paths in parentheses are
unchanged.

| # | Feature | Where now |
|---|---|---|
| 1 | Home tiles with counts | Overview: Need to know, Waiting for a decision, Inventory health |
| 2 | Add equipment (home header) | Overview quick action; Inventory › Add equipment |
| 3 | Refresh catalog | Settings › General; ⌘K |
| 4 | Ask the assistant | **Ask MakerLAB AI**, end of the bar |
| 5 | Intake queue | Inventory › Add equipment › Queue (`/admin/intake`) |
| 6 | Approve page | Same page; crumb Admin / Inventory / Add equipment |
| 7 | Imported lists | Add equipment › Imports |
| 8 | Import a list | Add equipment header action; AI agents › Intake agent |
| 9 | Import review | Same page; crumb Admin / Inventory / Add equipment |
| 10 | Review table | Inventory › All tools (`/admin/inventory`) |
| 11 | Tool editor | Unchanged; also from the tool page |
| 12 | Add inventory | Renamed **Add equipment** |
| 13 | Export CSV (directors) | All tools, unchanged |
| 14 | Units with no tool | All tools, unchanged |
| 15 | QR label studio | **Inventory › QR labels** (`/admin/inventory/qr`); overview quick action; ⌘K; All tools header button |
| 16 | Refresh research | Inventory › **Check for updates** (`/admin/refresh`) |
| 17 | Manual library | Inventory › **Manuals** (`/admin/research`) |
| 18 | Taxonomy | Inventory › **Categories** (`/admin/taxonomy`) |
| 19 | Corrections | Inventory › **Page corrections** (`/admin/corrections`); Waiting for a decision |
| 20 | Ticket queue | Maintenance › Tickets (`/admin/maintenance`); Need to know |
| 21 | Log completed maintenance | Tickets page; overview quick action "Log finished work" |
| 22 | Project moderation | People › **Student projects** (`/admin/projects`); Waiting for a decision |
| 23 | Assistant proposals inbox | Settings › **MCP** (`/admin/proposals`); Waiting for a decision |
| 24 | Roster | People › Roster (`/admin/users`, directors) |
| 25 | Blocked emails | Roster page, unchanged |
| 26 | Setup allowances | Settings › **AI agents** › Research budget (directors) |
| 27 | Notion mirror | Settings › Notion mirror (`/admin/mirror`) |
| 28 | Usage counts | Insights (`/admin/insights`) |
| 29 | Unanswered queue | Insights; Waiting for a decision |
| 30 | Most/never asked, kinds, busy times, manuals | Insights |
| 31 | Value report | Insights › Value report (`/admin/insights/value`) |
| 32 | Assumptions form | Value report, unchanged |
| 33 | Edit this tool (tool page) | Unchanged |
| 34 | QR dialog (tool page) | Unchanged |
| 35 | Personal access tokens | Profile menu; Settings › General; MCP header |
| 36 | Lab status screen | Settings › General › Lab screen |
| 37 | ⌘K admin pages and actions | Follows the list: every tab is a page entry, shortcut column names its section |

Lab notes (`/admin/inventory/lab-notes`), added after the review, is an
Inventory tab. Recurring tasks (`/admin/maintenance/schedules`) is a
Maintenance tab.

### 5.4 Old URLs and redirects

Every admin page kept its address. New names redirect (307, `next.config.ts`):
`/admin/overview` and `/admin/today` to `/admin`; `/admin/mcp` and
`/admin/settings/mcp` to `/admin/proposals`; `/admin/settings/notion` to
`/admin/mirror`; `/admin/inventory/add` to `/admin/intake`; `/admin/checklist`
to `/admin/maintenance/checklist`. `/admin/people` is a page that redirects by
role. The research budget left `/admin/users`; it has no address of its own to
redirect, and the roster page says nothing about it.

### 5.5 The overview

- **Need to know** (`maintenance.manage`): open or in-progress tickets at high
  or critical priority, nobody on it first, then critical first, at most six,
  then "N more urgent tickets in Maintenance". A ticket nobody is on has
  **Take it**: assigns it to the viewer and marks it in progress. Then "N
  recurring tasks are overdue" (opens the checklist) and "N open tickets name no
  machine" (opens Tickets). A queue read that failed is said; nothing urgent is
  said in words.
- **Shift checklist** (`maintenance.manage`): §5.6.
- **Quick actions**: Print QR labels (`tools.edit`), Log finished work
  (`maintenance.manage`), Add equipment (`tools.add`), All tools (`tools.edit`).
- **Waiting for a decision**: researched equipment, imported lists ready,
  updates to review, category proposals, page corrections, student projects,
  the viewer's MCP proposals, unanswered questions. Only the viewer's
  surfaces' loaders are read; a zero row is left out; a failed one says "Could
  not be read".
- **Inventory health** (`tools.edit`): units out of service and under
  maintenance (counts, with names), tools never reviewed, without a photo,
  without a manual (each linking to All tools filtered by that flag).
- The facts line: need to know, checks due (today and overdue), waiting.
- The backup and legacy-MCP-token warnings stay above the blocks.

### 5.6 The Shift checklist

The recurring tasks overdue, due today and due in the next 7 days (the v1 due
list, recurring maintenance spec amendment 2026-10-06). Each task has **Done**
and **Add a note** as before. New: when the task's machine has open tickets
(the task's unit, or the tool's tickets with no unit; every ticket on the tool
for a whole-tool task; none for general upkeep), they are listed under it with
**Mark resolved**, which sets the ticket to resolved. The list moved off the
Tickets page; the Tickets page's facts line still counts overdue and due-today
tasks.

## 6. UI

- Bar: six mono links, no dividers, the current section underlined; scrolls
  sideways on a phone. Not printed.
- Tabs: `LinkTabs` named "<Section> pages", under the header. Not printed.
- Overview: two columns from `lg` (2:1), one on a phone in the order Need to
  know, Shift checklist, Quick actions, Waiting, Health. Side blocks are plates.
- Page titles renamed in the lab's words: Add equipment, Check for updates,
  Categories, Page corrections, Student projects, MCP. Section landing pages
  keep the section's name as title (Maintenance, Inventory, People).
- All new strings are admin strings, English only. `chat.askAssistant` is
  "Ask MakerLAB AI" (English; only the admin bar shows it).

## 7. Relationship to existing work

- Amends UI system spec §5.2 and §8.1 (the admin IA) and DESIGN.md §8.1, §8.2
  and §8.12. The tiles home (`admin-tiles.ts`, `system/Tile`) has no callers
  and awaits deletion approval.
- Amends the recurring maintenance spec (amendment 2026-10-07: the Shift
  checklist and Mark resolved).
- Amends the bulk intake spec §4.2's placement of setup allowances.
- Builds on the seven-branch stack ending at `v5/tool-scoped-citations`
  (serial masking, lab notes, chat companion, unit QR labels, the official
  logo, recurring maintenance v1, tool-scoped citations).

## 8. Security and safety

- Showing is presentation; each page and action checks its own permission, as
  before. The tabs and the bar are built from `surfacesFor(identity)`, so they
  never link to a refusal.
- Take it and Mark resolved are `tickets.update`, which checks
  `maintenance.manage`, rate-limits and tells the mirror. Nothing new reaches a
  model or MCP.
- `/admin/people` redirects only to a page the viewer may open, and refuses in
  words otherwise.
- `listUnitsDown` selects no serial numbers or notes.

## 10. Testing

- `surfaces.test.ts`: sections, what each role is shown, section links (People
  by role), every old address kept, current section per path.
- `AdminNav.test.tsx`, `SectionTabs.test.tsx`: the bar and the tabs per role.
- `overview-model.test.ts`: Need to know ordering and caps, waiting rows,
  health rows, unreadable reads.
- `checklist-issues.test.ts`, `DueTasks.test.tsx`: which issues a task offers,
  Mark resolved and its refusal.
- `AdminActions.test.tsx`: the quick actions per role.
- E2E: `admin-navigation`, `admin-client-navigation` (walks sections and tabs),
  `admin-queues`, `taxonomy`, `mirror`, `assistant-actions` updated.

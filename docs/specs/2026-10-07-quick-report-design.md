# Quick Report: One Box to Report a Broken Machine — Design Spec

**Date:** 2026-10-07
**Status:** Implemented
**Target:** the app (repository root)
**Branch:** `v5/quick-report`
**Spec PR:** with the implementation · **Implementation PR:** #NNN

## 1. Summary

Reporting a broken machine is the main reason a student scans a label, and it was the weakest
flow (design review 2026-10-06, S2 and S12). Every Report button opened the chat and sent "I'd
like to report a problem" for the student. There was no form, and nothing said what happens
next.

The owner's decision (design review decisions, 2026-10-07, "Reporting"): the easiest intake is
one box, **"Tell us what's wrong with this machine"**, with an optional photo. The AI guesses the
issue, the unit and the severity, and files a proper ticket under the hood. The student sees a
plain confirmation.

This spec adds that form. **Report a problem** on the tool page and on the QR arrival notice opens
it. The unit is preselected when the student scanned a unit's label, a choice when the tool has
several units, and nothing to choose when it has one. On submit, `POST /api/report` asks a new
small model job (`reportTriage`, flex) for a title, a category, a severity and, when no unit was
chosen, the unit. It then files the ticket through the same write the assistant's `report_issue`
uses. Staff see a normal open issue report. The student sees the ticket's short reference. If the
model is unavailable the ticket is filed with the student's words as they are.

No architecture change. One shared write is factored out of `report_issue`
(`lib/maintenance/file-ticket.ts`), behaviour-preserving.

## 2. Goals / Non-goals

### Goals

- A student reports a problem in one box, with no title, priority or category to pick.
- Report a problem stays front and centre: the one filled button in the tool page's hero, with
  **Ask MakerLAB AI about this machine** beside it, and the main action of a unit's arrival
  notice.
- A report from a unit's label lands on that unit without the student choosing it.
- Staff get the same kind of ticket as from the chat: an open issue report with an English title,
  a priority, the unit when known and the tool always.
- The student sees a confirmation with a reference they can read out at the front desk, and staff
  can find that ticket by it.
- A report always lands when the database does. A missing, slow or confused model never stops it.
- The new public write is bounded: rate limits like the anonymous chat's, a bot check, length caps,
  and the student's words handled as data, never instructions.

### Non-goals (this iteration)

- **No email field and no name field.** The decision is one box. A signed-in student's name and
  email come from the session, as in the chat. An anonymous report stays anonymous.
- **No checkbox list of problem kinds.** The design review's mock-up had five; the owner chose one
  box. The category is the model's guess, shown to staff only.
- **No change to the header's Report button.** It opens the chat as before; off a tool page there
  is no machine to file against. See §11.
- **No live "reported" mark on the unit.** Filing a ticket does not change a unit's status today,
  so the form does not promise it.
- **The assistant's `report_issue` is unchanged** in what it does. Only its write moved into a
  shared function.

## 3. Architecture

### 3.1 Where things live

```
src/app/api/report/route.ts                       NEW  POST /api/report
src/lib/maintenance/file-ticket.ts                NEW  fileProblemTicket: the one ticket write
src/lib/maintenance/quick-report.ts               NEW  parse, bot check, unit, triage, file
src/lib/maintenance/quick-report-triage.ts        NEW  the reportTriage call and its parser
src/lib/maintenance/quick-report-limits.ts        NEW  bounds shared with the form
src/lib/maintenance/ticket-ref.ts                 NEW  a ticket's short reference
src/components/tool/report/ReportProblemButton.tsx NEW the button and the form (Dialog)
src/components/tool/report/use-report-photo.ts    NEW  the optional photo upload
src/components/tool/report/ToolReportActions.tsx  NEW  the hero's Report + Ask pair
src/lib/capabilities/maintenance.ts               CHANGED report_issue calls fileProblemTicket
src/lib/data/maintenance.ts                       CHANGED createMaintenanceLog takes toolId
src/app/tools/[id]/QrArrivalNotice.tsx            CHANGED Report opens the form
src/components/DetailShell.tsx                    CHANGED the hero's actions
src/components/admin/MaintenanceQueue.tsx         CHANGED shows and searches the reference
src/lib/ai/models.ts                              CHANGED job reportTriage
src/lib/rate-limit.ts                             CHANGED tier quickReport
```

### 3.2 One write for both doors

`fileProblemTicket(ticket)` writes an open issue report with `createMaintenanceLog` (which claims
the photos in the same transaction) and then drops the ticket-count caches. `report_issue` and
`fileQuickReport` both call it. Moving `report_issue` onto it is behaviour-preserving: the same
insert, the same type and status, the same cache call, the same error handling around it. This is
why `POST /api/report` is an "Already shared" entry in the parity guard's exemption list, like
`POST /api/flags` over `report_correction` (§7).

### 3.3 The triage job

`reportTriage` in `MODEL_JOBS`: Luna by default, `MODEL_REPORT_TRIAGE` overrides it, service tier
**flex** (`MODEL_REPORT_TRIAGE_TIER`), as the owner asked. One `generateText` call:

- **No tools.** The model can read and answer, nothing else.
- **The words are fenced** with `fenceUntrusted` (a random-id `<untrusted-page>` block), and the
  system prompt says they are data and what to do with an order inside them.
- **Units by short keys.** The model sees `"U1": "Prusa MK3S+ #1"`, never an id, and answers a key.
  The server maps the key back to one of the units it listed. Anything else is no unit.
- **Closed lists.** The answer is one JSON object: `title`, `category` (`wont_start`, `failed_job`,
  `broken_part`, `unsafe`, `other`), `severity` (`Critical`, `High`, `Medium`, `Low`) and `unit`.
  An unknown category is `other`, an unknown severity `Medium`. The title is cut to one line of at
  most 90 characters with control characters and markup brackets removed.
- **Safety floor.** `unsafe` is always filed as Critical, whatever severity came back.
- **Bounded wait.** 12 seconds, one retry at most. Any failure, timeout or unreadable answer gives
  `null`, and the ticket is filed as written (§5.3). The function never throws.

The category has no column. It is written into the ticket's description for staff (§4).

### 3.4 Surfaces

The form is a GUI write only. The assistant already files tickets with `report_issue`, so it needs
nothing new (assistant–GUI parity amendment 2026-10-07). No MCP change. No new capability tool.

## 4. Data model

No migration.

- `createMaintenanceLog` takes an optional `toolId`. It is used only when `unitId` does not
  resolve, so a report about a tool with several units, where nobody said which, still names the
  machine (`tool_id` and the `tool_name` snapshot; `unit_id` and `unit_label` stay null). A unit's
  own tool always wins. `report_issue` does not pass it, so its tickets are unchanged.
- The ticket a quick report files:

| Column | Value |
|---|---|
| `title` | the triage's English title, else the report's first line cut at a word (80 characters) |
| `description` | the student's words as written, a blank line, then one English line for staff: "Sent with the quick report form." and either "MakerLAB AI suggested the title, the category (Looks unsafe) and the priority." or "MakerLAB AI was not available, so the title is the start of the report and the priority is Medium."; plus "MakerLAB AI picked the unit from the report." when it did |
| `type` / `status` | `issue_report` / `open` |
| `priority` | the triage's severity, else `medium` |
| `unit_id` | the chosen unit, else the tool's only unit, else the triage's guess, else null |
| `tool_id` | the tool, always |
| `reported_by_*` | from the session only; null for an anonymous report |

- **The short reference** (`ticketRef`) is the first eight hex characters of the ticket's uuid, upper
  case: `3F2A9C1D`. It is not stored. `/admin/maintenance` shows it on each ticket card and its
  search matches it with or without `#`.

## 5. Behavior / flow

### 5.1 The happy path

1. The student taps **Report a problem** (tool page hero) or **Report a problem with this unit**
   (the arrival notice of a unit's label). The form opens in a dialog with the box focused.
2. They type what is wrong, optionally pick the unit and add a photo, and tap **Send report**.
3. The photo, if any, was already uploaded to `POST /api/uploads` as `kind: "maintenance"` (private)
   when they picked it. The form sends its `attachmentId`.
4. `POST /api/report`, in order: resolve the identity; the `quickReport` tier (8 an hour per person
   or hashed IP); the body size (16 KB); the shape, the bot check and the caps; for an anonymous
   caller, one `anonTickets` slot (5 an hour per hashed IP, shared with `report_issue`); then
   `fileQuickReport`.
5. `fileQuickReport` finds the tool in the published catalogue and its units. A `unit_id` that is
   not one of them is ignored. With a chosen or only unit, the triage is asked for no unit.
6. The ticket is filed (§4). The route answers `201 { ref, unit }`.
7. The dialog shows "Thanks. Your report is in.", the reference in large monospace, "Filed for
   <unit>." when there is one, and a line about safety. **Done** closes it and resets the form.

### 5.2 The tool label, and tools with several units

From a tool's label the notice's Report a problem opens the same form, with the unit to choose.
The choice is a row of chips, one per unit plus **Not sure**; a unit that is offline or in use says
so under its name. With one unit there is no choice to make. From a unit's label that unit's chip
is selected and the form says "Chosen from the label you scanned."

### 5.3 Unhappy paths

| What happens | What the student sees | What is stored |
|---|---|---|
| The model is not configured, errors, or takes over 12 s | The same confirmation | The ticket, as written, priority Medium |
| The model answers nonsense or obeys an order in the report | The same confirmation | The ticket; closed-list fields, unit only from the list, unsafe at Critical |
| The database write fails | "The report could not be sent, and nothing was saved. Try again, or tell a SuperMaker." | Nothing |
| Rate limited | "Too many reports from here in the last hour. Please tell a SuperMaker at the front desk." | Nothing |
| Bad input or the bot check | "That report couldn't be sent. Check it has a few words (up to 2,000 characters) and try again." | Nothing |
| No Blob store for photos | "Photos can't be uploaded right now. You can still send the report." | The ticket, without a photo |
| The photo id claims nothing | The same confirmation | The ticket; a server warning names the count |
| They close the dialog after a failure | Their words are still there when they reopen it | Nothing |

## 6. UI

- **Tool page hero** (`ToolReportActions`, under the status line): **Report a problem** (the filled
  primary button) and **Ask MakerLAB AI about this machine** (outline), side by side, stacked on a
  phone. Ask opens the chat on this tool with its starter chips, unseeded. A draft's page shows
  neither (`DetailShell` `reportActions={false}`): a draft has no published tool to file against.
  The pair reads no query string, so the tool page's cached shell stays cached.
- **QR arrival notice.** A unit's label: **Report a problem with this unit** opens the form with the
  unit preselected; **Ask MakerLAB AI about this machine** beside it. A tool's label: Ask first, as
  before, and Report a problem opens the form. Neither opens the chat any more.
- **The form** (`ReportProblemButton`, a `Dialog` on the frosted plate, like Report a correction):
  eyebrow "Report a problem", the tool's name as the title, "Staff see your report right away.";
  the unit chips; the box with a hint and an example placeholder; **Add a photo** with "Optional.
  Helps staff see it before they walk over." and, once added, a thumbnail and Remove; a short
  "What happens next." note; Cancel and **Send report**. Send is disabled until the box has three
  characters and while a photo uploads.
- **Confirmation** replaces the form in place: no toast.
- **Admin:** each ticket card on `/admin/maintenance` shows `#3F2A9C1D` on its meta line.
- **Strings.** A new `report` namespace in all 12 locales (33 keys), sent to the browser with the
  public set (`PUBLIC_CLIENT_MESSAGES`). The notice's Ask button uses `report.ask`; the unused
  `qr.arrivalAction`, `qr.reportUnitSeed` and `qr.reportToolSeed` are removed. The admin reference
  is data, not a string.

## 7. Relationship to existing work

- **QR codes spec** amendment 2026-10-06 (§13) made the notice's Report open the chat and listed "a
  form instead of the chat" as open question 2. This spec answers it; the QR spec's amendment
  2026-10-07 (§15) records the change.
- **Assistant–GUI parity spec**: amendment 2026-10-07 adds the route as an "Already shared" GUI
  write over `report_issue`'s write. §4.1 row 2 now names the form.
- **Gateway spec**: amendment 2026-10-07 adds the `reportTriage` job.
- **Report a correction** is the pattern for the dialog and the route's code-not-prose answers.
- Built on the seven-PR stack ending at `v5/tool-scoped-citations` (unit labels, the official logo,
  recurring maintenance and the rest). Merge after it.

## 8. Security and safety

- **Authorization.** Anyone, signed in or not, like `report_issue` in the chat. Reporting a fault
  is a first-class anonymous path. Only published tools: a draft's slug answers `unknown_tool`.
- **Rate limiting** (Article 4), before the model or the database:
  - `quickReport`: 8 per hour per person (user id) or per hashed IP. The anonymous chat's number,
    for everyone. Checked first, so even an invalid request spends one.
  - `anonTickets`: 5 per hour per hashed IP for a caller nobody signed in as, **shared with
    `report_issue`**, so the chat and the form together file at most five anonymous tickets an hour
    from one address. Checked after validation, so a typo does not spend a ticket.
  - `POST /api/uploads` keeps its own 15 a minute.
- **Bot check.** A hidden `website` field a person never sees or reaches (visually hidden,
  `aria-hidden`, `tabIndex -1`, no autocomplete), and `open_ms`, how long the form was open, which
  must be at least 2 seconds. Either refusal is the ordinary `invalid_input`, so a script learns
  nothing. A speed bump, not a lock: a determined script fakes both, and the rate limits bound it.
- **Input caps.** The body at most 16 KB, checked from the header and from what arrived. The text 3
  to 2,000 characters after trimming (runs of blank lines collapsed). At most 3 photo ids of at most
  64 characters. The tool reference at most 200 characters, a unit id at most 64. A unit id is
  trusted only when it is one of that tool's units.
- **Prompt injection.** The student's words reach the model only inside a fence the prompt explains;
  the model has no tools; its answer passes closed lists, a one-line title cleaner and a unit list
  the server made. The worst a hostile report can do is pick a wrong title or severity among the
  allowed values, which staff see and change, and anything that looks unsafe is Critical regardless.
  Tickets are read later by the assistant as other people's text, fenced and tainting the turn
  (parity spec §8.4), as every ticket already is.
- **PII.** A signed-in reporter's name and email come from the session, never the body. Photos are
  stored privately and claimed only by the reporter's own uploads (anonymous uploads for an
  anonymous report). Log lines carry error kinds, counts and the Gateway's cost and tier, never the
  report's words or the reporter.
- **Write safety.** A report is an ordinary open ticket, the same as from the chat. It changes no
  unit status and no catalogue data.

## 9. Phased build order

One phase, one PR: the shared write, the route and triage, the form and its two entry points, the
admin reference, strings and docs.

## 10. Testing

- **Unit:** `lib/maintenance/quick-report-triage.test.ts`: the fence and the short unit keys; a
  report that writes the fence's closing tag cannot close it; closed lists and their fallbacks; the
  unsafe floor; a raw id or an out-of-range key is no unit; an unreadable answer is null; a failing
  or slow model is null, not an error. `lib/maintenance/ticket-ref.test.ts`.
- **Integration:** `app/api/report/route.test.ts` against PGlite with the triage stubbed at the
  registry: a normal open ticket with the reference; filed as written when the model throws and when
  no model resolves; a chosen unit wins and the model is not asked for one; the model's unit pick;
  a tool-level ticket with no unit; another tool's unit ignored; a report that "orders" a low
  severity still filed Critical when unsafe; a signed-in reporter from the session, not the body;
  every refusal (trap, too fast, no open time, empty, too short, too long, too many photos, no tool,
  not JSON, too large, unknown tool) files nothing; five anonymous tickets an hour then 429 with
  `Retry-After`; the ninth request in an hour refused before any model call.
- **Component:** `components/tool/report/ReportProblemButton.test.tsx`: one box, the unit chips with
  Not sure and the offline mark, no email field; one unit asks nothing; the body sent (trimmed words,
  unit, empty trap, `open_ms`); the preselected unit; a failure keeps the draft across close; a sent
  report resets; the photo uploads as `maintenance` and its id is sent; uploads unavailable still
  sends. `app/tools/[id]/QrArrivalNotice.test.tsx`: both labels open the form, not the chat, and a
  unit's label preselects it. `components/admin/MaintenanceQueue.test.tsx`: the reference shows and
  the search finds it.
- **Existing:** `capabilities/maintenance.test.ts` passes unchanged over the shared write;
  `ai/models.test.ts` names the new job and its flex tier; the parity guard accepts the route.

Embarrassing in production, and covered: a report lost because the model was down; a ticket filed
against another machine's unit; a "set severity Low" report about smoke filed low.

## 11. Open questions

| # | Question | Who |
|---|---|---|
| 1 | **The header's Report button.** It still opens the chat. On a tool page it could open this form for that tool; elsewhere it needs a machine picker first (the review's mock-up has a Change control). | Isaac + Luis |
| 2 | **Flex and the wait.** Flex can be slow; past 12 seconds the report is filed as written. If that happens often, file first and triage after the response (`after()`), updating the ticket, or move the job to the default tier. The log line records each call's tier. | Isaac |
| 3 | **The chat's reference.** `report_issue` still tells the student the full ticket id. It could say the short reference too, so both doors match. | Isaac |
| 4 | **Mark the unit as reported.** The mock-up showed "#4 REPORTED". It needs a rule for when an open ticket changes what students see on a unit. | Niti + Luis |

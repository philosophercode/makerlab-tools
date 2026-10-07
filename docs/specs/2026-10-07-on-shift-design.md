# Who's On Shift — Design Spec

**Date:** 2026-10-07
**Status:** Implemented (branch `v5/on-shift`)
**Target:** the app (repository root)
**Branch:** `v5/on-shift` (on top of `v5/tool-scoped-citations`)
**Spec PR:** with the implementation · **Implementation PR:** not opened yet

> The owner decided this in the design review (`docs/MakerLab_design/review-2026-10-06/decisions.md`,
> 2026-10-07): "Who's on shift: keep it. It connects students to people at the lab instead of
> only to the AI. Simple and opt-in for staff." This spec is that decision, written down.

## 1. Summary

Staff (SuperMakers and directors) can mark themselves **On shift** until a time they pick. The
default is the end of today in lab time. The shift ends by itself at that time. While somebody is
on shift, students see **"On shift now: Alex M."** on the home page, on every tool page under its
buttons, and on the lab screen (`/kiosk`). When nobody is on shift, those places show nothing.
They never show a stand-in name or "nobody".

The assistant gets the same names in its per-request context, so the companion line can say
"Alex M. is on shift, ask them to show you." It names a person only when that list names them.

No new personal data. A shift is a row with an id and two times. What students see is the display
name the account already has, cut to first name and last initial on the server. Nobody appears
unless they marked themselves.

## 2. Goals / Non-goals

### Goals

- A staff member marks themselves on shift, changes the end time, or ends it, from the admin
  overview or from `/account`. Two clicks at most.
- A shift ends at the time picked with no job, sweep or second click.
- Public surfaces show "On shift now: …" with first name and last initial only, and nothing when
  nobody is on shift.
- The assistant may name an on-shift person and never invents one.
- Students' pages stay cached; the line is its own dynamic hole over a cached roster.

### Non-goals (this iteration)

- **A rota or weekly schedule.** The review suggested one under People later. Opt-in "I'm here
  now" is what the owner asked for.
- **Putting somebody else on shift.** Only yourself. A director cannot mark a SuperMaker.
- **Where in the lab someone is, or when their shift ends, on public pages.** The name only.
- **Shifts past midnight.** The time is today in lab time. A later time can be set again tomorrow.
- **The assistant marking you on shift.** GUI only (§3).
- **Showing it in the header's status strip on every page.** The three places named above only;
  the strip is shared by admin pages too, and the decision named home, tool page and kiosk.

## 3. Architecture

- **No capability tool.** The names reach the assistant as prompt context, not as a tool, the way
  the lab-wide notes do. Nothing to call, nothing to refuse.
- **One action.** `shifts.set` (`src/lib/actions/shifts.ts`), registered, GUI only
  (`assistant: "never"`, so `mcp: "never"`). Its one server action is `setMyShift`
  (`src/app/account/shift-actions.ts`), used by both pages.
- **One permission.** `shifts.set`, held by `admin` and `super_admin`. It gates the action and
  also decides who may appear: a person who no longer holds it is never shown.
- **Data.** Migration `0029_staff_shifts`: table `staff_shifts`. Not mirrored to Notion (it is
  live state, not inventory).
- **Reads.** `getShiftRoster()` (`src/lib/on-shift/read.ts`) is `"use cache"` under the tag
  `on-shift` (`ON_SHIFT_CACHE`: revalidate 5 min as a backstop). `loadOnShiftNames(now)` drops
  ended shifts outside the cache, against the request's clock, and fails to an empty list.
- **Surfaces.** `OnShiftNow` (server component, `connection()` then the cached roster) in its own
  `Suspense` on `/` and `/tools/[id]`; `onShift: string[]` added to the kiosk payload outside the
  snapshot's cache; `onShift` in the chat's `PromptEnv`, written by `onShiftSection`
  (`src/lib/ai/on-shift-prompt.ts`) in the "This conversation" tail.

## 4. Data model

```sql
CREATE TABLE "staff_shifts" (
  "user_id"    text PRIMARY KEY REFERENCES "user"("id") ON DELETE cascade,
  "ends_at"    timestamptz NOT NULL,
  "started_at" timestamptz NOT NULL DEFAULT now()
);
```

- One row per person. Marking again replaces it (`on conflict do update`). Ending deletes it.
- A row whose `ends_at` has passed means nothing. Every reader filters `ends_at > now`.
- `cascade`: a removed person's shift goes with them.
- **Backup and `data:push`.** The nightly backup keeps the table. `data:push` skips it
  (`DEPLOYMENT_BOUND` in `src/lib/cron/backup-policy.ts`): a local test shift must never put a
  name on the live home page.
- No existing rows; nothing to backfill.

Shared types: `ShiftInput` (`{ onShift: true; until: "HH:MM" } | { onShift: false }`),
`ShiftResult`, `ShiftError` (`src/app/account/shift-result.ts`); `ShiftRow`
(`src/lib/on-shift/names.ts`); `KioskSnapshot.onShift: string[]`; `PromptEnv.onShift`.

## 5. Behavior / flow

### 5.1 Marking yourself

1. A staff member opens `/admin` (the **On shift** card above the tiles) or `/account` (an
   **On shift** section under the name).
2. The time field holds `23:59` (the end of today), or the current end if they are on shift.
3. **Go on shift** sends `{ onShift: true, until: "18:00" }`. The server reads it as 18:00 today
   in `LAB_TIMEZONE` (`labTimeToday`), never the browser's timezone.
4. A time at or before now is refused with `shift_time_passed`. A malformed input, or one that
   names anybody (the schema is strict), is `invalid_shift_time`.
5. On success the row is written, the `on-shift` tag is cleared, `/admin` and `/account` are
   revalidated, and the control shows "You're on shift until 6:00 PM."
6. **Change end time** sends a new time. **End shift now** sends `{ onShift: false }` and deletes
   the row. Ending a shift you are not on is a no-change success.

### 5.2 Ending by itself

Nothing runs at the end time. Readers compare `ends_at` with their own clock, outside any cache,
so the line disappears on the first request after the end. The row stays until the person's next
shift replaces it.

### 5.3 Who students see

`visibleOnShift(rows, now)`: a shift is shown when it has not ended, the person may appear (the
account resolves exactly as a sign-in would, floor and ban included, and its role holds
`shifts.set`), and there is a real name. The name is first name and last initial
(`shortAuthorName`, the rule the kiosk uses for authors). A placeholder name (the address) shows
nobody. Names are unique and sorted. Empty means nothing is drawn anywhere.

The control tells a staff member how students see them ("Students see you as: Alex M."), and
warns when their name is a placeholder, with a link to fix it.

### 5.4 The assistant

The chat route reads `loadOnShiftNames()` with the rest of its context. When the list has names,
`buildSystemPrompt` adds, in the per-request tail:

```
## On shift now

These MakerLAB staff marked themselves on shift at the lab right now:

- "Alex M."

When the "point to people" rule applies, you may suggest one of them by name ... Name only people
in this list, exactly as written. Do not say when their shift ends, where they are, or anything
else about them.
```

Each name is quoted on its own line (`inlineText`). The companion rules (`lab-companion.ts`) now
say: name a person only when "On shift now" lists them; without it, name nobody ("ask a
SuperMaker"). Starter answers are pre-run and composed without the section, so they never name
anyone; their grader already rejects answers that depend on who is on shift.

### 5.5 Unhappy paths

- **The roster read fails.** Every surface shows nothing and logs; the chat names nobody. Never a
  name that was not read.
- **The own-shift read fails** on the admin card. The card says it could not be read and shows the
  control as off shift.
- **`LAB_TIMEZONE` is not a timezone.** Times fall back to UTC with a warning, like `labToday`.
- **A person is demoted, banned or renamed while on shift.** The next roster fill reflects it (at
  most the 5-minute backstop; marking anyone on or off clears it at once).

## 6. UI

- **Public line** (`OnShiftLine`): the status strip's live dot, then "On shift now: Alex M. and
  Jordan P." in the mono label type. Home: under the gallery's facts line. Tool page: under the
  hero's buttons (where Report a problem sits once the reporting branch lands). Kiosk: beside the
  hours in the top bar, label "On shift now" over the names. Absent when nobody is on shift.
- **Control** (`OnShiftControl`, client): a status line, how students see you, a time field
  labelled "Until (today, lab time)", **Go on shift** (primary) or **Change end time** and **End
  shift now**. Refusals inline, never a toast. Disabled until hydrated.
- **Card / section** (`OnShiftPanel`, server): "What students see now: “On shift now: …”" or "Nobody is on
  shift right now", then the control.
- **Strings.** Public: `status.onShiftNow` and `kiosk.onShiftLabel`, in all 12 locales. Admin
  (English only): `admin.onShift.*`, `admin.errors.invalid_shift_time`,
  `admin.errors.shift_time_passed`, and the `/assistant` page's `shifts_set` entries. `/account`
  receives `admin.onShift` through `ACCOUNT_CLIENT_MESSAGES`.
- Phone: the card stacks; the time field and buttons wrap.

## 7. Relationship to existing work

- Builds on the seven-PR stack ending at `v5/tool-scoped-citations`: the companion line
  ("chat companion" PR) is what the names feed.
- Assistant–GUI parity spec: one registered action, amendment 2026-10-07.
- Identity spec: the companion rule changes, amendment 2026-10-07.
- Kiosk spec: the payload gains `onShift`, amendment 2026-10-07.
- The home redesign (option B) and the reporting branch both touch the home page and the tool
  hero. This adds one slot to each (`GalleryShell`'s `onShift`, `DetailShell`'s `onShift`), so a
  rebase moves one line. Stacked on the student home, the line sits under the home's search
  (`HomeShell`'s `onShift`) and in the full list's hero on `/tools` (`GalleryShell`'s).
- **Migration number.** `0029`: written as `0028`, renumbered when stacked after the manual eval
  questions' `0028_manual_eval_questions`.

## 8. Security and safety

- **Authorization:** `performAction` (limiter, signed in, `shifts.set`). The row is always the
  caller's; the input cannot name anybody.
- **Rate limiting:** `ADMIN_ACTION_TIER` on the action. Public reads add no route: the home and
  tool pages read a cached roster; `/api/kiosk` keeps its own tier.
- **External calls:** one cached query per roster fill; invalidated on every change.
- **Write safety:** opt-in, self only, ends by itself.
- **Untrusted input:** the time is a strict pattern; the names in the prompt are quoted one per
  line and already cut to a first word and an initial.
- **PII:** no new field. Public surfaces get first name and last initial only; the full name and
  address never leave the server (`/api/kiosk` test asserts it).

## 9. Phased build order

One phase: migration, permission, action, reads, the three public surfaces, the chat, the two
staff pages, docs and tests.

## 10. Testing

- **Unit:** `lib/on-shift/time.test.ts` (lab time today, both DST sides, the lab's date not the
  server's, an unknown zone; a shift on before its end and off at it), `names.test.ts`
  (expired, ineligible, placeholder, dedupe, empty), `ai/on-shift-prompt.test.ts`,
  `chat-adapter.test.ts` (tail only, prefix unchanged, absent when empty),
  `permissions.test.ts`, `backup-policy.test.ts`.
- **Integration:** `app/account/shift-actions.test.ts` (gate, permission, lab-time storage,
  passed time, strict input, end, no-change end, **expiry with no write**, demoted, banned,
  placeholder name, failed read), `data/staff-shifts.test.ts`,
  `db/schema/staff-shifts-migration.test.ts`, `api/kiosk/route.test.ts` (short names only, gone
  after the end), `api/chat/route.test.ts` (names in the tail, none when nobody).
- **Component:** `OnShiftControl.test.tsx`, `OnShiftNow.test.tsx`, `KioskScreen.test.tsx`.
- **Embarrassing in production:** a name after the shift ended (expiry tests); a student or a
  demoted account shown (visibility tests); an email address shown (placeholder test); the
  assistant naming someone not on shift (prompt tests).

## 11. Open questions

- **A rota under People** (the review's "later"): who decides, and whether this opt-in line is
  enough. Owner.
- **An eval case** for "Alex M. is on shift, ask them to show you": the eval harness has no way to
  pass on-shift names in a case's context yet. Isaac.

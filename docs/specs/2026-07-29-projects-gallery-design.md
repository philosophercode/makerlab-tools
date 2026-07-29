# Student Projects Gallery — Design Spec

**Date:** 2026-07-29
**Status:** Draft — awaiting approval
**Target:** `v5/`
**Branch:** `philosophercode/projects-gallery` (rebase onto `main`)
**Supersedes:** `2026-05-29-gallery-projects-design.md` (on that branch)

## 1. Summary

The catalog answers *what the lab has*. Nothing answers *what people made with it* — which
is the question that actually teaches capability, and the one an admissions tour or a
funding conversation turns on. A tool page saying "7 projects were made with this" tells a
student more about a bandsaw than any spec table.

This adds a **projects gallery**: students submit a title, a write-up, photos, and the
machines they used; staff publish; the gallery lists published work; and each tool page
gains a **"Built with this"** backlink. That backlink is the point of the feature — it
closes the loop from *ingredients* to *things made*, and without it a projects page is just
a second catalog nobody visits.

**Most of this already exists** on the `projects-gallery` branch — roughly 1,370 lines
covering the data layer, gallery, detail page, submit form, and API route. This spec
supersedes the branch's own spec for three reasons: the branch **has no tests at all**, it
predates sign-in and so has no verified authorship, and its moderation story is thinner
than the drafts-by-default rule now requires (Article 5).

## 2. Goals / Non-goals

### Goals

- A student submits a project in one form: title, write-up, photos, machines used,
  optional link.
- Nothing appears publicly until a human publishes it in Notion.
- The gallery reads as an archive of real work, not a feed.
- Every tool detail page lists the published projects that used it.
- Submissions record a verified author when the student is signed in.
- The whole feature is covered by tests at every layer it touches.

### Non-goals (this iteration)

- **No comments, likes, or any social layer.** This is an archive, not a feed. Social
  features invite moderation work the lab has no capacity for.
- **No in-app editing after submission.** A student who needs a change asks staff, who edit
  in Notion. Edit flows need ownership checks and an audit trail that v5 does not have.
- **No project search or faceting.** At the volume a lab produces — tens per semester, not
  thousands — reverse-chronological with tool filtering from the backlink is enough.
  Revisit past ~200 projects.
- **No agent-mediated submission.** Submitting through chat is attractive and belongs in
  Blueprint; adding a write capability here widens the intake surface right before a
  handover.
- **No bulk import** of historical projects.

## 3. Architecture

**No new capability.** Projects are a read surface plus one form-backed API route. They do
not become agent tools in v5 — the agent has no reason to write a project, and giving it
one expands the write surface for no benefit. (In Blueprint they do become a capability;
see that repo's architecture §8.)

Files, as they exist on the branch and stay:

```
src/lib/projects.ts                     # cached, published-only reads; tool-ref resolution
src/lib/notion.ts                       # fetchAllProjects, createProject
src/app/projects/page.tsx               # gallery
src/app/projects/[id]/page.tsx          # detail
src/app/projects/new/page.tsx           # submit form host
src/app/api/projects/route.ts           # POST submission
src/components/ProjectDetail.tsx
src/components/ProjectSubmitForm.tsx
```

**Caching.** `getPublishedProjects()` is behind `"use cache"` with `cacheTag("projects")`,
busted by the existing admin revalidate endpoint. Matches the catalog exactly.

**The backlink is a join, not a query.** Notion relations are one-directional in practice
here, so the tool page resolves its projects by loading published projects and filtering on
`tools_used`. At this scale that is correct and cheap — both sides are already cached. Do
not add a second Notion relation to avoid a filter; a denormalized relation that can drift
out of sync is worse than an O(n) pass over a few dozen records.

## 4. Data model

The `Projects` Notion database, as the branch defines it. **A human creates this database
and shares it with the integration before the code ships.**

| Property | Type | Notes |
|---|---|---|
| `title` | Title | Required |
| `author` | Text | Display name |
| `author_email` | Email | **New** — verified, from sign-in. Empty when anonymous |
| `body` | Text | Markdown write-up |
| `photos` | Files | Uploaded via the existing Notion file-upload path |
| `tools_used` | Relation → Tools | The backlink |
| `materials` | Multi-select | |
| `link` | URL | Optional external link |
| `published` | Checkbox | **Defaults unchecked** — the moderation gate |
| `date` | Created time | |

Env: `NOTION_DB_PROJECTS`. Absent → the gallery renders an empty state and submission
returns a clear error. It must **not** fall back to mock data — fail toward stale, never toward wrong (Article 4).

`author_email` is the only change from the branch and depends on the auth spec.

## 5. Behavior / flow

**Submitting.** `/projects/new`. Signed in, the author name is pre-filled from Google and
read-only, and `author_email` is recorded. Anonymous, the student types a name and
`author_email` stays empty — deliberate, so the ISAM demo and any student who has not
signed in can still contribute.

Photos upload through the existing `/api/upload-notion` route, which already handles the
`file_upload` flow used by maintenance photos. Reuse it rather than adding a second path.

On success: a confirmation explaining the submission is awaiting review, and that it will
appear once staff publish it. **Say this plainly** — a student who submits and sees nothing
appear assumes it was lost.

**Publishing.** Staff review in Notion and tick `published`, then hit the existing admin
revalidate endpoint. No in-app moderation queue (Article 7).

**Browsing.** `/projects` lists published projects newest-first with photo, title, author,
and the machines used. `/projects/[id]` renders the write-up, photo set, tool links, and
materials. An unpublished or unknown id returns 404 — not a "pending" page, which would
leak the existence of unpublished submissions.

**Built with this.** Tool detail lists published projects using that tool. Zero projects →
the section is omitted entirely rather than rendering an empty shell.

**Unhappy paths.** Notion unreachable on read → empty state, logged loudly. Unreachable on
write → the form preserves what the student typed and says the submission did not save.
Oversized body, too many photos, or malformed payload → 400 with a specific message. Rate
limit exceeded → a message saying when to try again.

## 6. UI

Existing components on the branch, in the technical-schematic system: 0px radius, no
shadows, CSS variables, crosshair accents on cards.

- **Gallery** — grid of cards; photo, title, author, tool chips. Empty state reads as
  intentional ("No projects published yet"), not broken.
- **Detail** — photo set, markdown body, tool links back to catalog pages, materials.
- **Submit form** — client component; per-field validation, disabled submit while
  uploading, visible upload progress, and preserved input on failure.
- **Built with this** — a section on tool detail.

All strings through `next-intl`, all 12 locale files together (Article 6). The branch
already added these; verify none were missed in the rebase.

Mobile: the submit form is the risk — file inputs and long text on a phone. Test it on a
real device, because that is where students will actually submit.

## 7. Relationship to existing work

**Build order: `chat-inventory-intake` → auth → projects.**

- The branch is **8 commits behind `main`** and needs a rebase. It touches
  `notion.ts`, `types.ts`, `catalog-types.ts`, `globals.css`, and
  `api/admin/revalidate/route.ts` — all of which the intake branch also touches. Rebase
  after intake merges, not before.
- `author_email` depends on the auth spec's `resolveIdentity`.
- Supersedes `2026-05-29-gallery-projects-design.md`; delete that file in the rebase.

## 8. Security and safety

- **Authorization.** Anyone may submit, including anonymous. Publishing requires Notion
  access, which is staff-only. That asymmetry *is* the security model.
- **Rate limiting.** `POST /api/projects` by IP — the branch already does this. Tighter
  than chat: **3 submissions per hour**. Photo uploads are the expensive part.
- **Drafts by default.** `published` is never settable from the API. Verify this explicitly
  in a test; it is the single most important assertion in the feature (Article 5).
- **Untrusted input.** Body is Markdown rendered with `react-markdown` — the same
  configuration as chat, which does not enable `rehype-raw`, so embedded HTML is inert.
  **Confirm this in a test with a `<script>` payload.**
- **`link`** must be validated as `http(s)` only — a `javascript:` URL in an anchor is the
  obvious hole here.
- **Photos** are size- and count-capped (8 max, matching the branch) and go through the
  existing upload route's validation.
- **PII.** Student name and, when signed in, email land in Notion. Same open question as
  the auth spec. Photos may show faces — the consent question in §11 is real.
- **No prompt-injection surface.** The agent never reads project bodies in v5.

## 9. Phased build order

1. **Rebase the branch** onto `main` after intake merges. No behavior change. Existing
   suite green.
2. **Tests for what already exists** — the gap this spec closes. Data layer, API route,
   components, E2E. See §10. Nothing new is built until the existing code is covered.
3. **`author_email`** wired from `resolveIdentity`; the form pre-fills for signed-in users.
4. **"Built with this"** on tool detail, if the rebase shows it incomplete.
5. **Mobile pass** on the submit form.

Phase 2 before phase 3 is deliberate: adding features to untested code compounds the
problem.

## 10. Testing

**The branch ships ~1,370 lines with zero tests.** This is the largest single test gap in
the repo and the reason this spec exists.

**Unit** (`projects.ts`, `notion.ts`)
- `toMakerLabProject` mapping: missing author → "Anonymous"; absent photos; unresolvable
  tool ids dropped rather than rendered broken.
- `fetchAllProjects({ publishedOnly: true })` filters correctly.
- `hasProjectsEnv()` false → empty array, no throw.
- `createProject` builds the `file_upload` photo payload correctly.

**Integration** (`POST /api/projects`, MSW-mocked Notion)
- Valid payload → 200, and the created record has **`published` absent or false**.
- **A payload attempting `published: true` does not set it.** Non-negotiable.
- Oversized body, >8 photos, >20 tools → 400 with a useful message.
- `javascript:` link → rejected.
- Rate limit → 429 after the third submission in an hour.
- Notion failure → 5xx, and the response does not leak the Notion error verbatim.

**Component** (RTL)
- Submit form: validation, disabled state during upload, input preserved on failure,
  pre-filled read-only author when signed in.
- `ProjectDetail`: markdown renders; **a `<script>` in the body does not execute**; tool
  links point at the right pages.
- Gallery empty state.

**E2E** (Playwright, mock catalog)
- Browse `/projects` → open a project → click through to a tool page.
- Submit the form → confirmation message appears.
- A tool page with projects shows "Built with this"; one without omits the section.

**Cases that would embarrass us in production**
- An unpublished project reachable by direct URL.
- The API honoring `published: true` from the client.
- A student's submission failing and their write-up being lost with it.
- A tool page 500ing because a project references a deleted tool id.

## 11. Open questions

1. **Photo consent.** Student work, and possibly student faces, in a publicly readable
   gallery. Probably an explicit opt-in checkbox at submission plus a documented takedown
   path — but this is a question for the university, not a design decision to make here.
   *Blocks launch, not development.*
2. **Who publishes, and how fast?** A queue nobody watches is worse than no gallery. Name
   an owner and an expected turnaround before announcing it to students. *Niti.*
3. **Anonymous submissions — keep them?** Convenient for the demo, and an unattributed
   project is weak as an institutional record. Recommend keeping, revisiting with data.
4. **Retention.** Do projects stay after a student graduates? Assume yes; confirm.

---

## Amendments

Appended per [`DRIFT.md`](DRIFT.md). Original text above is never edited — the reason a
design changed usually outlives the change.

### 2026-07-29 — phase 3 built (`author_email`), with four as-built details

**What changed.** §9 phase 3 is implemented. `POST /api/projects` already resolved an
`Identity` for rate limiting; it now also writes `author_email` from that session, and
`ProjectSubmitForm` asks `GET /api/identity` after mount to pre-fill the byline.

Four things the spec did not describe:

1. **The server writes the byline, not just the email.** §5 says the name field is
   read-only when signed in, which the form does — but read-only in a browser is a
   suggestion, not a control. The route therefore prefers `identity.name` over
   `payload.author` for a signed-in submission, so the displayed guarantee and the recorded
   value cannot disagree. Anonymous submission still uses the typed name, unchanged. This
   mirrors `report_issue`, which prefers `ctx.identity.name` over the model's `reported_by`.

2. **`author_email` is write-only and not on `ProjectFields`.** `createProject` takes a
   `ProjectWriteFields = Partial<ProjectFields> & { author_email?: string }` instead. The
   read path never surfaces the address (nothing renders it, and §8's PII question is still
   open), and a type with no reader is the clearest way to say a client may not supply one.
   Same shape as `FlagWriteFields`.

3. **Notion property fallback.** §4 requires a person to add the `author_email` Email
   column, and Notion rejects a write naming a property that does not exist. The route
   retries once without the email and logs a warning, so a column nobody has added yet
   cannot cost a student their write-up (Article 4 — fail toward stale, not toward wrong).
   Identical to `report_issue`'s `reporter_email` fallback.

4. **One new string, `projectForm.authorFromAccount`.** A required field that silently
   refuses typing reads as broken, so a note under it says where the name came from. It
   uses the `{institution}` placeholder, passed at the call site, in all 12 locale files
   (Article 6). It sits **outside** the `<label>` and is wired with `aria-describedby` —
   text inside the label would become part of the field's accessible name.

**What did not change.** `published` is still never settable from the API, and the
assertion that proves it is still the most important test in the feature. Anonymous
submission still works and still records no email: the ISAM demo depends on it (§5), and
`GET /api/identity` failing entirely is indistinguishable from being signed out.

**Status.** Accepted — the spec was right about the shape and silent on these details.

### 2026-07-29 — E2E coverage added, two of §10's four cases not exercisable

**What changed.** `v5/e2e/projects.spec.ts` closes the browser-layer half of §9
phase 2 — seven Playwright tests over `/projects` and `/projects/new`.

**What §10 asked for, and what was built.** §10's E2E list has four cases. Two are
covered as written: *submit the form → confirmation message appears* (plus the
failed-submission case, since §5 and §10 both name a lost write-up as the
embarrassing failure), and the gallery rendering. Two are **not**:

- *Browse `/projects` → open a project → click through to a tool page*
- *A tool page with projects shows "Built with this"; one without omits the section*

**Why.** E2E boots with `NOTION_*` unset (`playwright.config.ts`), so
`hasProjectsEnv()` is false and `getPublishedProjects()` returns `[]` **without a
Notion call**. There is no mock projects backend the way there is a mock catalog:
the published set is empty by construction, so there is no project to open and no
tool page that has one. Writing those two tests today would produce assertions
that pass because nothing renders — the failure mode §10 is trying to prevent.
Both paths are covered at the component layer (`ProjectDetail`, the "Built with
this" section) and at the data layer (`getProjectsForTool`).

**What is asserted instead.** That the empty state reads as *intentional* — the
"no projects published yet" copy and the submit call-to-action are present, and no
error language is — which is the behaviour a lab without the database actually
gets, and which §6 explicitly calls for.

**One general assertion worth keeping.** Both page tests assert the rendered body
contains no literal `{institution}`. A `next-intl` placeholder with no param at
the call site renders as its own name, which is invisible to typecheck and to
every test that matches on a substring; it has already happened once on this
branch (Article 6).

**Unblocking the two skipped cases** needs a seeded projects fixture — either a
mock projects module parallel to `mock-catalog.ts`, or intercepting the Notion
API at the server boundary rather than the browser. Both are more machinery than
the remaining gap justifies; recorded here so the next person decides rather than
rediscovers.

**Status.** Accepted — the spec's E2E list was written before it was known that
the mock backend has no projects.

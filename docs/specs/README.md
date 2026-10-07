# Specification Set — Master Index

> **Status as of 2026-09-27.** Every design spec in this folder, and **what is actually
> built against it**, because a spec set with no conformance record is a wish list.
>
> Constitution: [`../constitution.md`](../constitution.md) — seven articles, binding.
> Format for new specs: [`TEMPLATE.md`](TEMPLATE.md). Keeping specs and code honest with
> each other: [`DRIFT.md`](DRIFT.md).

## How conformance is checked

**Phase-level, by artifact presence and inspection** — for each spec's build order, does
the code it calls for exist and do its tests pass. A phase marked *built* means its
artifacts exist and are tested, not that every clause of the prose is satisfied; where the
build diverged, the spec carries a dated as-built amendment saying how and why.

Two mechanisms keep this current: `npm run spec:coverage` (mechanical — every route,
capability tool, script and env var must appear somewhere in `docs/`) and `/drift`
(semantic — an agent reads specs against code). See [`DRIFT.md`](DRIFT.md).

The audit behind this table was re-verified on 2026-09-27 against `main` at `875c796`.

---

## Status

### Implemented

| Spec | Notes |
|---|---|
| [v5 Test Suite](2026-05-29-v5-test-suite-design.md) | Four offline layers; runbook in `TESTING.md` |
| [Student Projects Gallery](2026-07-29-projects-gallery-design.md) | Storage moved from Notion to Postgres (data platform phase 3); moderation at `/admin/projects` |
| [Agent Eval Harness](2026-07-29-agent-eval-harness-design.md) | `npm run eval`; real, paid, never in CI |
| [QR Codes on Machines](2026-07-29-qr-codes-design.md) | `npm run qr:labels`; amendment 2026-09-29 "QR labels in the app": print sheets at `/admin/inventory/qr`, a QR dialog on each tool page, `get_tool_qr_code`, `/api/qr/[slug]`; amendment 2026-10-06 "Unit labels and reporting from a unit": a label per unit (`?unit=<token>`), Report a problem with this unit on arrival, unit codes in chat photos; amendment 2026-10-07: the arrival notice's Report opens the quick report form, not the chat |
| [Report a Correction](2026-07-29-report-a-correction-design.md) | Corrections land in `feedback`, worked at `/admin/corrections` |
| [Quick Report](2026-10-07-quick-report-design.md) | One box, "Tell us what's wrong with this machine", from the tool page and the QR arrival notice: `POST /api/report`, the `reportTriage` job (flex) guesses title, category, severity and unit, and the ticket is filed through `report_issue`'s write; the short reference on `/admin/maintenance`. Open: the header's Report button, triage after the response if flex is slow |
| [Bulk Intake](2026-09-23-bulk-intake-design.md) | Import a list on `/admin/intake`; allowances under Settings › AI agents (amendment 2026-10-07) |
| [Gateway-First Models and a Product Image Finder](2026-09-23-gateway-models-and-product-images-design.md) | Gateway is the only model path; deterministic cutout, no generative redraw |
| [MCP Access](2026-09-23-mcp-access-design.md) | Phases 0–4: public reads, personal tokens, OAuth sign-in; user guide `docs/mcp.md` |
| [Refresh Research](2026-09-23-refresh-research-design.md) | Phases 1–4 built. Not yet run over the real inventory |
| [Official and Display Names](2026-09-24-tool-display-names-design.md) | `tools.official_name`; backfill with `npm run names:backfill` |
| [Manual Text and Search](2026-09-23-manual-text-and-search-design.md) | Phases 1–3: page text, passages, embeddings, `search_manual`; OCR for scanned PDFs, reranking, `halfvec` storage. Re-index with `npm run manuals:index`. Amendment 2026-10-06: an answer cites only its machine's documents (scope in code, relabelled cross-tool citations, one silence rule, every PDF resource indexed). Amendment 2026-10-07: indexing a manual writes a few eval questions on known pages (`manual_eval_questions`, migration `0028`); `npm run manuals:eval-questions` backfills, `npm run eval:manual-questions` measures recall and (paid) citations |
| [Assistant–GUI Parity](2026-09-27-assistant-gui-parity-design.md) | Phases 1–8: `src/lib/actions/` and `performAction`, proposing tools and the confirmation card, page context, taint, MCP proposals and the `/admin/proposals` inbox (amendment 2026-10-07: its Manuals view, and a tool's proposals confirmed in one step). What the assistant can do, for users: [`assistant.md`](../assistant.md) |
| [Taxonomy v2](2026-09-28-taxonomy-v2-design.md) — nine top-level categories, research-proposed categories, `/admin/taxonomy` | **Implemented** (#108; migration `0023`, `npm run taxonomy:migrate` / `taxonomy:audit`) |
| [Student Home](2026-10-07-student-home-design.md) — the categories and one smart search on `/`, the full list at `/tools` | Design review option B with the owner's addendum: a smart search box (tools, categories, then Ask MakerLAB AI; Enter never asks by accident; rotating placeholder), category tiles, "See all tools"; old `/?category=` links redirect; the logo only once, in the header (amendment) |
| [MakerLAB Identity](2026-09-28-makerlab-identity-design.md) | MakerLAB / MakerLAB Tools / MakerLAB AI naming (renamed from MakerLAB Assistant, amendment 2026-10-07), the wordmark header, the assistant's first-visit callout and operate/debug/create starters, the "Where you are" prompt block (`src/lib/ai/lab-context.ts`), the About page; amendment 2026-10-06 "Lab notes": a tool's lab notes above its description and first in the assistant's context, lab-wide notes at `/admin/inventory/lab-notes`; amendment 2026-10-06 "Companion, not a replacement": the lab's own knowledge first and people suggested (`src/lib/ai/lab-companion.ts`), the "can make mistakes" note under the composer; amendment 2026-10-06: the official Cornell Tech MakerLAB logo on the kiosk, footer, About, link-preview card and QR labels (`BrandLogo`, `public/brand/`) |
| [Admin Sections](2026-10-07-admin-sections-design.md) | Six sections (Overview, Maintenance, Inventory, People, Insights, Settings) and Ask MakerLAB AI; section tabs under each header; the Overview with Need to know, the Shift checklist, quick actions, Waiting for a decision and Inventory health; MCP and AI agents (research budget) under Settings; no route moved, new names redirect |
| [Operational Hardening](2026-07-29-operational-hardening-design.md) | Health endpoint, demo banner, nightly backup with tiered retention, staff refresh, backup heartbeat. Phase 2 (uptime monitor) is account setup in [`operations.md`](../operations.md); phase 6 (Notion webhook) superseded |

### Mostly implemented — open work named

| Spec | Built | Open |
|---|---|---|
| [Recurring Maintenance](2026-09-27-recurring-maintenance-design.md) — recurring tasks per tool, per unit or for general lab upkeep, checked off with Done | **v1** (amendment 2026-10-06, migration `0027`): a checklist, not tickets. Tasks on `/admin/maintenance/schedules`, the **Shift checklist** on `/admin/maintenance/checklist` and the overview with Mark resolved on the machine's open issues (amendment 2026-10-07), `list_maintenance_due` for staff. Amendment 2026-10-07: the 08:00 email reminder of what is due and overdue (built with Email Notifications), linking to the Shift checklist | Assistant proposals for the four `schedules.*` actions; a Skip button; the tool page's staff panel; manual suggestions (phase 4) |
| [Email Notifications](2026-09-30-email-notifications-design.md) — staff emailed when a ticket is filed; outbox + Workflow + Resend, exactly once per recipient | **v1** (approved 2026-10-07, migration `0030`): a ticket from the chat, the report form or MCP emails every `maintenance.manage` holder; one-click signed unsubscribe (`/notifications/unsubscribe`, `/api/notifications/unsubscribe`); cron backstop and retention. Amendment 2026-10-07: the daily 08:00 recurring-maintenance reminder. Offline (no `RESEND_API_KEY`) deliveries are recorded `not_configured`. Architecture: [`notifications.md`](../architecture/notifications.md) | **Going live:** a sending domain verified in Resend and the integration (§9 phase 0, §11 Q1). **v1.1:** preferences on `/account`, the staff digest, the reporter's "resolved" email, the delivery log, the bounce webhook. The E2E email stub and evals |
| [v5 Data Platform](2026-09-14-v5-data-platform-design.md) — Postgres, Blob, roles, admin inventory, two-step intake, Notion mirror | Phases 1–6 and 8 | **Phase 7** (people load and validate the real inventory — not code) pending. **Phase 9** (translation pass) deferred until after launch |
| [UI System](2026-09-25-ui-system-design.md) — shadcn/ui, Tufte density, admin IA, AI Elements chat | Phases 1–5; the admin IA superseded by Admin Sections (amendment 2026-10-07) | **Phase 6** (delete legacy CSS): the repo flatten it waited for is done; needs a screenshot sweep, after the demo |
| [Sign-in and Tiered Rate Limiting](2026-07-29-auth-and-rate-limiting-design.md) | Google sign-in, tiered rate limits as specced | The env-list role model is **superseded** by Better Auth and the `user` table (data platform phase 4) |
| [Intake Confidence](2026-07-29-intake-confidence-design.md) | Confidence grading and parallel identification, now inside the research pipeline | The chat-side card behaviour is **obsolete** — `propose_listing` was removed with the two-step intake (data platform phase 6) |
| [Usage Insight](2026-09-27-usage-insight-design.md) — anonymous usage events in Postgres and an `/admin/insights` page: most- and never-asked-about tools, QR scans, busy times, an Unanswered queue | Phases 1–2 (#107, migration `0022`) with the Unanswered queue's two decisions (amendment 2026-09-28); the value report on `/admin/insights/value` (#109); usage counts over MCP for super admins, `insights.export` (amendment 2026-09-30) | **Phases 3–4** |

### Draft — not started

| Spec | Notes |
|---|---|
| [Kiosk Mode](2026-09-27-kiosk-mode-design.md) — public read-only lab screen at `/kiosk`: down machines, ticket counts, hours, featured tool, QR to chat | **Phase 1 built** (#94, `/kiosk`); phases 2–3 awaiting review; phase 2 adds editable hours and pins |

The 2026-09-27 feature specs build on the Assistant–GUI Parity action layer; each writes its
migration as `00NN` and takes the next free number when it lands.

### Ideas — not decided

The owner has considered these but has not decided to build them. Do not implement against them.

| Spec | Notes |
|---|---|
| [Training Sign-offs](2026-09-27-training-signoffs-design.md) — who is trained on which tool, workshops, refreshers; advisory only, no lockout | Undecided. First questions: does the lab want it, and are training records student records? |
| [Consumables](2026-09-27-consumables-design.md) — stock of filament, resin, sheets and blades by location; student "out / running low" reports; a restock list | Undecided. Recommended start is reports and a restock list only, without counts |

### Superseded — kept for history, do not implement against

| Spec | Superseded by |
|---|---|
| [Chat Inventory Intake](2026-06-01-chat-inventory-intake-design.md) | [v5 Data Platform](2026-09-14-v5-data-platform-design.md) phase 6 — the two-step intake (`identify_tools`, background research, approval) |
| [AI Gateway Migration](2026-07-29-ai-gateway-migration-design.md) | [Gateway-First Models and a Product Image Finder](2026-09-23-gateway-models-and-product-images-design.md) |
| [Notifications (2026-09-27)](2026-09-27-notifications-design.md) | [Email Notifications](2026-09-30-email-notifications-design.md): immediate staff mail on new tickets; Web Push dropped |
| [Gallery Projects (2026-05-29)](../superpowers/specs/2026-05-29-gallery-projects-design.md) | [Student Projects Gallery](2026-07-29-projects-gallery-design.md) — an older duplicate |

---

## What is left to build

Everything open, in one place:

1. **Monitoring setup** — the uptime and heartbeat monitors and the AI Gateway budget, all
   account setup a person does ([`operations.md`](../operations.md)).
2. **Manual search** — first OCR run over the scanned manuals (`npm run manuals:index`).
3. **UI system phase 6** — legacy CSS removal (the repo flatten it waited for is done).
4. **Data platform phase 7** — not code: Isaac and Luis load and validate the real inventory
   in person, and file what breaks.
5. **Data platform phase 9** — the translation pass, after launch.
6. **Refresh research** — its first run over the real inventory (built; not yet used).
7. **Staff email going live**: a sending domain verified in Resend (SPF, DKIM, DMARC), the
   Resend integration on the Vercel project, `EMAIL_FROM`, and a test send to Niti and Luis
   (Email Notifications §9 phase 0). Then v1.1.

## Open questions for a person

These gate work and none of them are code:

1. **Owners** of the Vercel project, the Gateway budget, the Google OAuth client and the
   bill — `docs/handover.md` §2.
2. **Student data** — names and emails in tickets, corrections, projects, the nightly
   backup and any Notion mirror: acceptable to the university?
3. **Photo consent** for student work in the public gallery.
4. **ISAM rate limit** — conference wifi puts every visitor behind one IP;
   `RATE_LIMIT_ANON_CHAT` exists for this. **Hard deadline.**
5. **Sending domain and mail processor**: which domain the lab can put SPF, DKIM and DMARC
   on (Email Notifications §11 Q1), and whether Resend may process staff addresses under
   Cornell policy (Q2).

---

## History

The earlier revisions of this index (2026-07-30 conformance audit of the first eight specs,
the 2026-07-30 drift check, the 2026-09-14 pre-ISAM fixes, and the constitution audit of
that batch) are in git history (`git log -p -- docs/specs/README.md`). Their findings were
closed or folded into the specs' own amendments.

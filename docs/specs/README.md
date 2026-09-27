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
| [v5 Test Suite](2026-05-29-v5-test-suite-design.md) | Four offline layers; runbook in `v5/TESTING.md` |
| [Student Projects Gallery](2026-07-29-projects-gallery-design.md) | Storage moved from Notion to Postgres (data platform phase 3); moderation at `/admin/projects` |
| [Agent Eval Harness](2026-07-29-agent-eval-harness-design.md) | `npm run eval`; real, paid, never in CI |
| [QR Codes on Machines](2026-07-29-qr-codes-design.md) | `npm run qr:labels` |
| [Report a Correction](2026-07-29-report-a-correction-design.md) | Corrections land in `feedback`, worked at `/admin/corrections` |
| [Bulk Intake](2026-09-23-bulk-intake-design.md) | Import a list on `/admin/intake`; allowances on People |
| [Gateway-First Models and a Product Image Finder](2026-09-23-gateway-models-and-product-images-design.md) | Gateway is the only model path; deterministic cutout, no generative redraw |
| [MCP Access](2026-09-23-mcp-access-design.md) | Phases 0–4: public reads, personal tokens, OAuth sign-in; user guide `docs/mcp.md` |
| [Refresh Research](2026-09-23-refresh-research-design.md) | Phases 1–4 built. Not yet run over the real inventory |
| [Official and Display Names](2026-09-24-tool-display-names-design.md) | `tools.official_name`; backfill with `npm run names:backfill` |
| [Manual Text and Search](2026-09-23-manual-text-and-search-design.md) | Phases 1–3: page text, passages, embeddings, `search_manual`; OCR for scanned PDFs, reranking, `halfvec` storage. Re-index with `npm run manuals:index` |
| [Operational Hardening](2026-07-29-operational-hardening-design.md) | Health endpoint, demo banner, nightly backup with tiered retention, staff refresh, backup heartbeat. Phase 2 (uptime monitor) is account setup in [`operations.md`](../operations.md); phase 6 (Notion webhook) superseded |

### Mostly implemented — open work named

| Spec | Built | Open |
|---|---|---|
| [v5 Data Platform](2026-09-14-v5-data-platform-design.md) — Postgres, Blob, roles, admin inventory, two-step intake, Notion mirror | Phases 1–6 and 8 | **Phase 7** (people load and validate the real inventory — not code) pending. **Phase 9** (translation pass) deferred until after launch |
| [UI System](2026-09-25-ui-system-design.md) — shadcn/ui, Tufte density, admin IA, AI Elements chat | Phases 1–5 | **Phase 6** (delete legacy CSS) waits for the repo flatten, PR #79 |
| [Sign-in and Tiered Rate Limiting](2026-07-29-auth-and-rate-limiting-design.md) | Google sign-in, tiered rate limits as specced | The env-list role model is **superseded** by Better Auth and the `user` table (data platform phase 4) |
| [Intake Confidence](2026-07-29-intake-confidence-design.md) | Confidence grading and parallel identification, now inside the research pipeline | The chat-side card behaviour is **obsolete** — `propose_listing` was removed with the two-step intake (data platform phase 6) |
| [Assistant–GUI Parity](2026-09-27-assistant-gui-parity-design.md) — one action layer so the assistant (and MCP, narrower) can do anything the GUI can, by proposal and confirmation card | **Phase 1**: `src/lib/actions/` (`performAction`, the registry), People and the three queues moved onto it, the parity guard | **Phases 2–8**: proposals and the card, page context, catalogue, intake/import, destructive + taint, MCP exposure, docs. §11 answered 2026-09-27 |

### Superseded — kept for history, do not implement against

| Spec | Superseded by |
|---|---|
| [Chat Inventory Intake](2026-06-01-chat-inventory-intake-design.md) | [v5 Data Platform](2026-09-14-v5-data-platform-design.md) phase 6 — the two-step intake (`identify_tools`, background research, approval) |
| [AI Gateway Migration](2026-07-29-ai-gateway-migration-design.md) | [Gateway-First Models and a Product Image Finder](2026-09-23-gateway-models-and-product-images-design.md) |
| [Gallery Projects (2026-05-29)](../superpowers/specs/2026-05-29-gallery-projects-design.md) | [Student Projects Gallery](2026-07-29-projects-gallery-design.md) — an older duplicate |

---

## What is left to build

Everything open, in one place:

1. **Monitoring setup** — the uptime and heartbeat monitors and the AI Gateway budget, all
   account setup a person does ([`operations.md`](../operations.md)).
2. **Manual search** — first OCR run over the scanned manuals (`npm run manuals:index`).
3. **UI system phase 6** — legacy CSS removal, after PR #79 moves `v5/` to the repo root.
4. **Data platform phase 7** — not code: Isaac and Luis load and validate the real inventory
   in person, and file what breaks.
5. **Data platform phase 9** — the translation pass, after launch.
6. **Refresh research** — its first run over the real inventory (built; not yet used).

## Open questions for a person

These gate work and none of them are code:

1. **Owners** of the Vercel project, the Gateway budget, the Google OAuth client and the
   bill — `docs/handover.md` §2.
2. **Student data** — names and emails in tickets, corrections, projects, the nightly
   backup and any Notion mirror: acceptable to the university?
3. **Photo consent** for student work in the public gallery.
4. **ISAM rate limit** — conference wifi puts every visitor behind one IP;
   `RATE_LIMIT_ANON_CHAT` exists for this. **Hard deadline.**

---

## History

The earlier revisions of this index (2026-07-30 conformance audit of the first eight specs,
the 2026-07-30 drift check, the 2026-09-14 pre-ISAM fixes, and the constitution audit of
that batch) are in git history (`git log -p -- docs/specs/README.md`). Their findings were
closed or folded into the specs' own amendments.

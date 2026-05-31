# ISAM 2026 Demo Abstract — Decisions Log

> Working notes for the extended abstract submission. Source: `abstract-v1.1.html` (mirror: `abstract-v1.1.md`).
> Submission deadline: **10 July 2026**. Final publication version: **15 September 2026**.
> Demo install/session: **Sunday evening, 10 October 2026**, on-site.

## Version log

- **V1.1 — SUBMITTED to ISAM 2026 (2026-05-30).** Title: *"The MakerLAB Assistant: AI to Help Operate,
  Fix, and Build in Makerspaces."* 2 pages, 3 figures, 3 references (MCP, Claude, ChatGPT).
  Files: `abstract-v1.1.{html,pdf,docx}`, `abstract-v1.1.md`, `The MakerLAB Assistant - ISAM 2026 Demo V1.1.pdf`.
  Regenerate from `abstract-v1.1.html`:
  - PDF: `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu --no-pdf-header-footer --print-to-pdf=abstract-v1.1.pdf "file://$PWD/abstract-v1.1.html"`
  - DOCX: `pandoc abstract-v1.1.html -o abstract-v1.1.docx --resource-path="$PWD"`
  - **For a V2, copy `abstract-v1.1.*` → `abstract-v2.*` first and edit the v2 source — leave V1 frozen.**

## Planned for V2 (Isaac, post-submission — there is more time before the final 15 Sep version)

- **Add the public demo URL:** https://makerlab-tools-v5.vercel.app (the ISAM template even expects a
  "Public Demo" line). Pairs with one clause on how a lab adopts it.
- **Data provenance** (answers the recurring "how was the inventory collected?" question): the
  catalogue was sourced largely **by hand** — a MakerLAB worker entered each tool via a **Google Form /
  manual spreadsheet input**; it then took **substantial data cleaning and restructuring** before the
  data could be turned into a usable, normalized catalog. Worth a clause in §1 or §2.
- **Stronger, well-cited answers:** update the assistant's **system prompt** so it *always* cites with
  real citations; when it cannot cite a lab source, it must say the info comes from the **model** or a
  **website** (not the SOPs) — i.e., grounded and clearly attributed. (Chat UI already strips leaked
  `<cite>` tags — PR #22.)
- **Demo video:** record a short walkthrough (browse → scope → troubleshoot) for the demo page.

## Locked decisions

- **Title:** "The MakerLab Assistant: Conversational AI for Makerspace Operations."
  (Earlier drafts led with "MakerBot" and/or "…and Cross-Campus Fabrication Support" — both removed.)
- **Authors (3), confirmed order:** Isaac (primary) → Niti → Miguel.
  - Isaac Steinberg — Johnson Cornell Tech MBA '26, Cornell Tech — ies22@cornell.edu
  - Niti Parikh — Director, Learning Spaces and MakerLABs, Cornell Tech — ntp27@cornell.edu
  - Miguel Ramirez Peraza — Intern, Cornell Tech MakerLAB — ramirezperazamiguel@gmail.com
    (built the first Streamlit inventory-search app that framed the problem)
- **System demoed:** v5 (Notion-backed: gallery + tool detail + everywhere-chat overlay),
  framed around the §9 long-term vision in `docs/v5-plan.md`.
- **Assistant name:** **the MakerLab Assistant** (matches the live app UI label "MAKERLAB
  ASSISTANT"). App/platform = **MakerLab Tools** (matches the header "MAKERLAB TOOLS"). "MakerBot"
  was DROPPED per Niti — it is a registered trademark of the MakerBot 3D-printer company
  (makerbot.com). Confirm the new name with the user.
- **Framing:** "activation energy" pedagogical spine (A) + bring-your-own-AI via MCP as the
  novelty moment (C) + a discussion paragraph of the digital-twin vision (B).
- **Headline contribution:** lowering the barrier to **use**, **debug**, and **scope across**
  machines for non-traditional makers.
- **Results:** forward-looking — early Cornell Tech deployment + planned data collection
  (issue resolution, throughput, maintenance surfaced, uptime, access breadth/languages).
  Not a finished study.
- **Future work called out:** (i) student-projects gallery linked to the devices that
  produced them (hardware ↔ output provenance); (ii) digital twin + lab-wide AI agent that
  routes print/fab jobs and helps coordinate machines, schedules, and trainings.

## Accuracy flags (must stay honest in the prose)

- **MCP endpoint: SHIPPED** (merged from main, PR #19). `v5/src/app/api/mcp/route.ts` —
  standards-based MCP server (official SDK, streamable HTTP, server name `makerlab`) exposing
  `list_tools`, `search_tools`, `get_tool_details`, `get_unit_details`,
  `get_maintenance_history`. Abstract states it as live — accurate.
- **`/projects` route already scaffolded** in v5 — the student-projects future-work item is
  partly underway; phrase as "extending" not "net-new."
- **LLM disclosure required** by ISAM policy (Claude used to draft prose) → Acknowledgements.

## Newly landed on main (merged 2026-05-29, commits up to af419464)

- **MCP HTTP endpoint** (#19) — see above. The "bring your own AI" demo thread is now real.
- **i18n / 12-language UI** (#15) — cookie-based locale, selector, RTL support. Languages
  (`v5/src/i18n/config.ts`): English, Simplified Chinese, Spanish, Hindi, Korean, Arabic (RTL),
  French, Brazilian Portuguese, Russian, Turkish, Japanese, Hebrew (RTL). Elevated the
  localization story in §2 from "chat answers in any language" to full UI localization.
- **Gallery fuzzy ranked search + material/location facets** (#17) — reflected in §2.
- **Server-side PDF/manual fetch as base64** (#14) — "manuals and SOPs pulled server-side and
  read in full" in §2.
- **Env-driven white-label site config** (#18) — `NEXT_PUBLIC_SITE_NAME / _INSTITUTION /
  _CHAT_ASSISTANT_NAME`; the app's default assistant label is "MakerLab Assistant" (we brand
  it "MakerBot" in the abstract). Reflected in §2 white-label sentence.
- **Rate limiting on API routes** (#16) — production-hardening; not called out in the abstract.

## Live-system facts (from makerlab-tools-v5.vercel.app, captured 2026-05-28)

- 100 tools across 9 categories: 3D Printing, CNC & Digital Fabrication, Electronics,
  Laser Cutting, Printing & Large Format, Safety & Infrastructure, Scanning & VR,
  Sewing & Textiles, Woodworking.
- Real machines incl. Bambu Lab X1-Carbon, Formlabs Form 4, Trotec Speedy 400, Epilog
  Helix 24, Roland CAMM-1 vinyl cutter, ShopBot Buddy, WAZER waterjet, Ultimaker S5.
- Tool detail shows: training level, PPE, use restrictions, emergency-stop guidance,
  SOP/doc links, spec table, and a per-unit Physical Machines table (status/condition/serial).
- Assistant overlay ("MAKERLAB ASSISTANT") has starter chips ("Find a machine for a
  project", "Check training requirements", "Ask about safety or policy") + photo attach (vision).
- Stack: Next.js / React, Notion source-of-truth, Claude API tool-calling + web search +
  doc fetch + vision, hosted on Vercel.

## Figures (captured, in this folder)

- `fig-gallery.png` — Fig 1: gallery (light), now showing material/location facets + 12-language selector.
- `fig-assistant.png` — Fig 2: **real live exchange** on the Bambu Lab X1-Carbon page — first PLA
  print / bed adhesion → SOP-grounded pre-print checklist (glue, plate, bed leveling, filament).
  (Switched from a Trotec laser example per Niti's preference for a 3D-printer example.)
  NOTE: the chat UI leaked raw `<cite …>` markup on grounded answers (an app rendering bug);
  stripped from the DOM before screenshotting. **TODO (app): parse/strip `<cite>` tags in chat output.**
- `fig-project.png` — Fig 3: **real live exchange** — "wooden box for my phone, hinged lid" →
  start-to-finish, training-aware multi-machine build plan (project scoping).
- `fig-tool-detail.png` — captured earlier (Bambu detail); **no longer used** in the abstract.

## Dark-mode fix (v5 app code) — DONE + verified

`v5/src/styles/globals.css`: the `.tool-detail` page had a private, light-only `--td-*` palette and
hardcoded literals, so dark mode rendered light. Fix: routed ~40 scattered literals through the
`--td-*` palette and added a dark override (under both `[data-theme="dark"]` and the
`prefers-color-scheme: dark` media query). Light mode unchanged. Verified by prototyping on the live
page (`.context/isam-demo/darkmode-toolpage-*.png`). **Local change — not yet committed/deployed.**
Gallery/main page dark mode was already correct.

## Open TODOs before submission

- [x] Capture a real MakerBot conversation screenshot for Fig 2.
- [x] Confirm MCP endpoint will be live by October — yes; abstract states it as live.
- [x] Ship the MCP endpoint PR — done on main (#19); abstract's "live MCP server" claim holds.
- [ ] Fill the ISAM "Demonstration Information" Google Form (link TBD, "COMING SOON").
- [ ] Format into the ISAM two-column Word template; export PDF.
- [ ] Add 2–3 real references (makerspace access/pedagogy) to the IEEE list.

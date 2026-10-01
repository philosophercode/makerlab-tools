# ISAM 2026 Demo Abstract — Decisions Log

> Working notes for the extended abstract submission. **Current source: `abstract-v2.md`** — build with
> `node docs/isam-2026-demo/build.mjs` (see "V2" below). V1/V1.1 sources are kept as records.
> Submission deadline: **10 July 2026** (submitted 30 May). Final upload, via the presenter portal: **30 September 2026**.
> Regular registration closes **15 September 2026**; at least one author must be registered to present.
> Demo install/session: **Sunday evening, 11 October 2026**, on-site at Rice University, Houston (symposium 11–13 October).
> Dates checked 2026-09-14 against the [official Important Dates page](https://event.fourwaves.com/isam-2026/pages/9461609a-3902-42e5-b714-d8e074366b3a).

## Version log

- **V1 — SUBMITTED to ISAM 2026 (2026-05-30). FROZEN — do not edit.** Title: *"The MakerLAB Assistant:
  AI to Help Operate, Fix, and Build in Makerspaces."* 2 pages, 3 figures, 3 references (MCP, Claude,
  ChatGPT). Files: `abstract-v1.{html,pdf,docx}`, `abstract-v1.md`,
  `The MakerLAB Assistant - ISAM 2026 Demo V1.pdf`. This is the record of exactly what was submitted.
- **V1.1 — WORKING copy** for post-submission edits (currently identical to V1). Files:
  `abstract-v1.1.{html,pdf,docx}`, `abstract-v1.1.md`, `The MakerLAB Assistant - ISAM 2026 Demo V1.1.pdf`.
  Edit `abstract-v1.1.html`, then regenerate:
  - PDF: `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu --no-pdf-header-footer --print-to-pdf=abstract-v1.1.pdf "file://$PWD/abstract-v1.1.html"`
  - DOCX: `pandoc abstract-v1.1.html -o abstract-v1.1.docx --resource-path="$PWD"`

- **V2 — WORKING copy for the 30 Sep final upload (2026-09-28).** Title changed to *"MakerLAB AI: AI to
  Help Operate, Fix, and Build in Makerspaces."* 2 pages, abstract 288 words, 3 figures, 4 references.
  **Source of truth: `abstract-v2.md`.** Rebuild everything with one command from the repo root:

  ```bash
  node docs/isam-2026-demo/build.mjs
  ```

  `build.mjs` (no dependencies; a small converter for the Markdown subset the paper uses — front
  matter, `##`/`###`, bold/italic/links, `^1^` superscripts, `- ` lists, `![Fig. N: caption](file.png
  "wide" | "width=2.1in")`, `<!-- comments -->` dropped) fills `abstract-template.html` (the ISAM print
  CSS: Letter, 0.75 in margins, 3.4 in columns / 0.2 in gutter, Times 16/12/10/8 pt), writes
  `abstract-v2.html`, prints `The MakerLAB Assistant - ISAM 2026 Demo V2.pdf` with headless Chrome, and reports the
  abstract word count (limit 300) and page count (must be 2; exits non-zero when over).

## V1.1 → V2 changes (2026-09-28)

- **Naming (owner, 2026-09-28):** the assistant is **MakerLAB AI**; **MakerLAB Tools** is the platform;
  the **MakerLAB** is the physical lab (Studio 101, Tata Innovation Center). Retitled from "The
  MakerLAB Assistant: …" to "MakerLAB AI: …". The accepted submission and ISAM's program carry the
  old title — Niti should agree, and the title field in the presenter portal must match the PDF.
  The live app still labels the chat "MakerLAB Assistant" (visible in Fig. 1's chat header).
- **Framing:** OPERATE / DEBUG / CREATE (V1.1: operate / debug / scope); research question stated
  explicitly in §1; §3 is now "Process and Results" with measured numbers.
- **System now described as built:** Postgres + file storage with a one-way Notion mirror (V1.1 said
  Notion-hosted); manual archive with page-level citations (OCR for scans, hybrid search, reranking);
  photo/list intake with background research and staff approval (V1.1 listed it as future work);
  tickets from chat; GUI parity through confirmation cards (typed name for irreversible changes; no
  people/irreversible changes after reading outside text); kiosk; projects gallery seeded from the
  lab's projects; anonymous usage insights + value report; MCP; 12 languages.
- **Numbers and their sources:** 79 published tools / 98 units (public MCP `list_tools` +
  `get_tool_details`, 2026-09-28; the site header says 100 in inventory); ~54 archived manuals /
  ~2,400 pages (**approximate**, supplied by the coordinator — the public MCP cannot count the
  archive; it shows 60 manual links on 51 tools. Confirm on `/admin/research` before upload);
  59 eval cases (`evals/cases/*.yaml`); 54/59 and 55/59 on 2026-09-28, 50/55 on the earlier
  main, fixed cases 6/6 twice (coordinator's run log; PR #113 notes one flaky case,
  `staff-update-after-yes`); 6,385 offline tests (PR #113); ≈0.03¢ per chat turn with a manual
  search ($0.0003, manual-text spec); ≈2–5¢ per researched tool (bulk-intake spec: $0.0248 for one,
  $0.0779 for three); 20 manuals indexed for $0.013 (coordinator; not found in the repo).
- **URL:** https://makerlab-ai.vercel.app (replaces makerlab-tools-v5.vercel.app); code cited as [4]
  (the repo is public; it has **no LICENSE**, so the paper says "code public", not "open source").
- **Demo set-up (§4):** kiosk on a TV; laptop 1 public assistant; laptop 2 staff intake from a photo;
  iPad on the X1-Carbon page; visitors' phones via the kiosk QR; optional MCP laptop. Requirements:
  table, power, Wi-Fi, monitor/TV.
- **Generative-AI disclosure** rewritten to the template's policy (disclose use beyond editing, in
  Acknowledgements): code written with Claude Code and Codex under Isaac's direction and review; text
  drafted with Claude and checked by the authors; Figs. 1 and 3 are unedited assistant output.
- **Figures (new, live site 2026-09-28, 2x):** `fig-assistant-debug-v2.png` (Fig. 1, spans both
  columns: wordmark header + cited SOP answer, pp. 8 and 10), `fig-kiosk-v2.png` (Fig. 2, 7:02 PM
  capture), `fig-assistant-create-v2.png` (Fig. 3, lamp question). V1.1 figures are unchanged.
- **Figs. 1 and 3 retaken (live site 2026-09-30, 2x):** `fig-assistant-operate-v2.png` (Fig. 1, "How do
  I load filament on the X1 Carbon?", cited steps, SOP p. 9; cropped after step 3) replaces the
  adhesion answer, which opened with "I couldn't find". "Replace the filament" was tried first and
  also came back "the manual doesn't cover", so the question became "load". `fig-assistant-plan-v2.png`
  (Fig. 3, "I want to CNC a chair with laser-cut inlays. Can you help me plan?"; cropped after step 2
  of 4 to hold two pages) replaces the lamp question. The old PNGs stay in the folder, unused.
- **Authors:** unchanged from V1.1 (Isaac, Niti, Miguel). Luis Rodrigo Navarro is thanked in the
  Acknowledgements; a TODO comment in `abstract-v2.md` asks whether to add him as an author.

## Open items for V2 (owner / Niti)

- [ ] Niti: approve the retitle to "MakerLAB AI: …" and the new framing; check her affiliation line.
- [ ] Add Luis as an author, or keep him in the Acknowledgements (ISAM may not allow author changes).
- [ ] Confirm the manual archive count (~54 / ~2,400 pages) on `/admin/research`; update if different.
- [ ] Rename the chat label in the app to "MakerLAB AI" before the demo, then retake Fig. 1 so the
      screenshot matches the paper (`siteConfig.chatAssistantName` / `NEXT_PUBLIC_CHAT_ASSISTANT_NAME`).
- [ ] Isaac's affiliation line still reads "MBA '26, Johnson Cornell Tech" (as in V1.1); the app
      titles him Tech Lead — choose one.
- [ ] Before 11 Oct: set `RATE_LIMIT_ANON_CHAT` for the booth's shared IP (docs/deploy.md).
- [ ] Upload the PDF via the presenter portal by **30 Sep 2026**.

## Planned for V2 (V1.1-era notes — V2 did the URL and cited answers; data provenance and the demo video are not in V2)

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

- **MCP endpoint: SHIPPED** (merged from main, PR #19). `src/app/api/mcp/route.ts` —
  standards-based MCP server (official SDK, streamable HTTP, server name `makerlab`) exposing
  `list_tools`, `search_tools`, `get_tool_details`, `get_unit_details`,
  `get_maintenance_history`. Abstract states it as live — accurate.
- **`/projects` route already scaffolded** in v5 — the student-projects future-work item is
  partly underway; phrase as "extending" not "net-new."
- **LLM disclosure required** by ISAM policy (Claude used to draft prose) → Acknowledgements.

## Newly landed on main (merged 2026-05-29, commits up to af419464)

- **MCP HTTP endpoint** (#19) — see above. The "bring your own AI" demo thread is now real.
- **i18n / 12-language UI** (#15) — cookie-based locale, selector, RTL support. Languages
  (`src/i18n/config.ts`): English, Simplified Chinese, Spanish, Hindi, Korean, Arabic (RTL),
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

`src/styles/globals.css`: the `.tool-detail` page had a private, light-only `--td-*` palette and
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

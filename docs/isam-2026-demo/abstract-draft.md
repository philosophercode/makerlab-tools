# The MakerLab Assistant: Conversational AI for Makerspace Operations

**ISAM 2026 — Demo Extended Abstract (draft)**

> This Markdown mirrors the typeset version. The submission artifact is **`abstract.pdf`**
> (ISAM two-column format); regenerate it from `abstract.html` with the Chrome command in `DECISIONS.md`.

**Isaac Steinberg¹, Niti Parikh², and Miguel Ramirez Peraza³**

¹ Isaac Steinberg; Johnson Cornell Tech MBA '26, Cornell Tech; ies22@cornell.edu
² Niti Parikh; Director, Learning Spaces and MakerLABs, Cornell Tech; ntp27@cornell.edu
³ Miguel Ramirez Peraza; Intern, Cornell Tech MakerLAB; ramirezperazamiguel@gmail.com

*(Assistant = "the MakerLab Assistant" — matches the live app UI; app/platform = "MakerLab Tools". "MakerBot" dropped per Niti: trademark of the 3D-printer company.)*

---

## Abstract

Academic makerspaces run on distributed knowledge — machine documentation, setup procedures,
safety rules, materials, inventory, and fabrication workflows — that is hard to surface when staff
are not physically present. The Cornell Tech MakerLAB is a case in point: a lean-staff lab that
gives students seven-day access, often outside staffed hours, supported by trained student
volunteers ("SuperMakers"). This model rewards ownership and peer learning but strains onboarding,
troubleshooting, and workflow planning. We demonstrate the **MakerLab Assistant**, a conversational
AI layered over a structured operational database (hosted in Notion) within the *MakerLab Tools* app,
so students can, in plain language and in any language, find the right tool,
follow manual-grounded setup and troubleshooting, and scope multi-machine projects. The same
database is exposed as a live Model Context Protocol (MCP) server, so attendees can query the lab
from their *own* Claude or ChatGPT client. The demonstration is participatory: visitors use the live
prototype and also annotate UI templates, map workflows, and record feedback. We frame this as an
ongoing R&D initiative whose long-term goal is a shared operational framework spanning Cornell's
three campuses while preserving each lab's local identity — contributing to AI-assisted makerspace
operations, participatory interface design, and distributed fabrication support.

## 1. Background and Motivation

The project began on the floor of the Cornell Tech MakerLAB. An intern (a co-author) built the first
inventory app in Streamlit to search the lab's hardware — work that organized the data and framed the
problem. Another co-author, volunteering as a "SuperMaker," added an AI layer; the lab's director
posed the guiding ask: could a student *describe a project* and have it **decomposed against the
tools the lab actually has**? The insight that followed was that pairing the inventory with each
machine's manual and setup procedures turns a static list into something generative — a step-by-step
account of the tooling and workflow a project requires. (An early version generated how-to
infographics; today it is grounded text that can seed an image or render on demand.)

That origin exposes a problem the MakerLAB's operating model makes acute. The lab runs on a **lean
staff** and gives students **seven-day access** — often outside staffed hours — backed by trained
student volunteers ("SuperMakers"). The model rewards ownership and peer learning, but when no staff
member is present, the knowledge of what each machine does, who may use it, how to set it up, and how
to recover it from a fault lives only in binders and tribal memory. This taxes every interaction,
hardest for those least equipped to pay it — the student who is troubleshooting an error in a second
language at 11 p.m.

We frame this as an **activation-energy** problem. Three barriers recur: the barrier to **use** a
machine (does the lab have it, where is it, what training and PPE does it require?); the barrier to
**debug** a machine (it threw an error mid-job — now what?); and the barrier to **scope** a project
that spans several machines. Each routes today to a human bottleneck; our goal is to lower all three
at once, for the broadest set of users.

## 2. System Overview

*MakerLab Tools* treats the lab's operational knowledge as structured, typed data
rather than a static list. The layer is a normalized schema — tools, categories, locations,
individual units, resources, setup/safety procedures, and maintenance logs — hosted in Notion, which
keeps staff editing in a tool they already use. The web application (Next.js / React, deployed on
Vercel) presents two surfaces: a **gallery** with fuzzy ranked search and category, material,
training, and location facets across every published machine (Fig. 1), and a **tool detail** page
showing description, location, required training, PPE and use restrictions, emergency-stop guidance,
linked SOPs and manuals, and a live table of individual units with their status, condition, and
serial.

Overlaying both pages is the **MakerLab Assistant**, invoked from any page (Fig. 2). Rather than
baking the catalog into a prompt, it reasons over it through tool-calling,
augmented with web search, document fetch (manuals and SOPs are pulled server-side and read in full),
and vision (a photo of a machine or an error screen). Its context scales with place: from the gallery
it carries a lightweight index of every tool and its resources; opened from a tool page it loads that
machine's full detail and linked manuals, becoming a domain expert on the machine in front of you.
Access is built in end to end: the interface localizes into 12 languages (including right-to-left
Arabic and Hebrew), and the assistant answers in the language asked. The app is **white-label** — a new
lab rebrands and connects its own Notion workspace through environment variables.

## 3. The Demonstration

The demonstration is both **hands-on and participatory**: visitors drive the live prototype, then
help critique and redesign it.

**3.1 Converse and troubleshoot.** Attendees open the MakerLab Assistant on a machine page and ask
operational questions in plain language. On the Bambu Lab X1-Carbon, a first-timer asks how to get a
PLA print to stick; the assistant pulls the printer's SOP and returns a pre-print checklist — glue,
the right build plate, bed leveling in Bambu Studio, and a matching filament profile (Fig. 2). The
same flow handles a fault on a staged sample device — photograph the error, get manual-grounded
recovery steps in any language, and file a repair report on the spot — so the machine stays online
and the incident is captured rather than lost.

**3.2 Scope a project across machines.** From the gallery, a newcomer asks *"I want to make a wooden
box for my phone with a hinged lid — which machines and steps would I need?"* the MakerLab Assistant
returns a start-to-finish, training-aware build plan across the right tools, grounded in the lab's actual
inventory (Fig. 3) — turning a vague idea into an executable workflow.

**3.3 Bring your own AI (MCP).** The database is also a live, standards-based MCP server (streamable
HTTP) with tools to list, search, and inspect machines, individual units, and their maintenance
history. Attendees connect their *own* Claude or ChatGPT client and query the lab from a tool they
already use — reaching the linked manuals and grounding a 3D print or laser-cut SVG in the lab's
actual build and bed dimensions, tightly coupling design files to the hardware that will make them.

**3.4 Participate and critique.** The booth doubles as a design-research station: visitors annotate
printed UI templates, map their own workflows, and leave feedback on reflection cards — surfacing
pain points and ideas for cross-campus deployment as participatory design data. Requirements: a
table, power, lighting, reliable Wi-Fi, and space for a sample device; we supply the laptop/tablet,
printed materials, and QR placards.

## 4. Why a Demonstration

This work is best experienced, not read. The point is the moment a visitor asks a messy, human
question in their own language and watches the lab answer it; connects their own AI client to a
physical makerspace; or fixes a "broken" machine without finding a staff member. A demo also lets
attendees critique the interface and map their own workflows in person, gathering participatory
design data a paper cannot. The interaction is the contribution.

## 5. Early Deployment and Planned Evaluation

The app is deployed at the Cornell Tech MakerLAB over its real ~100-machine inventory. We are
collecting data on whether it measurably helps: issue-resolution rate (resolved without staff
escalation), experiment and print throughput, maintenance issues surfaced (and their effect on
uptime), and breadth of access (user types and languages used). Question logs double as a
pre-telemetry proxy for demand and for tools the lab lacks. We present early observations and frame
this as an in-progress study.

## 6. Discussion and Future Direction

This is an ongoing R&D initiative, not a finished product. Its central long-term goal is a **shared
operational framework across Cornell's campuses** — common onboarding, documentation, equipment
access, and workflows — so students move fluidly between labs and programs while each lab keeps its
local identity (the white-label contract makes this concrete). Nearer term, the same substrate
supports a **student-projects gallery** linked to the devices that made each project, and a **digital
twin** whose lab-wide agent routes fabrication jobs and coordinates schedules and trainings. The
throughline: invest in structured operational knowledge, and every capability — local and
cross-campus — compounds on it.

## Acknowledgements

We thank the staff and students of the Cornell Tech MakerLAB. Isaac Steinberg designed the system
architecture and wrote all application code for v5 and the current version, developed with the AI
coding assistants Claude Code and Codex. In accordance with ISAM policy, we also disclose that a
large language model (Anthropic's Claude) assisted in drafting and editing portions of this abstract;
all technical claims, design decisions, and the system itself are the authors' own.

## References

*(IEEE style — [1], [2], [4] are placeholders to be finalized.)*

[1] *(Makerspace access / broadening-participation reference.)*

[2] *(Conversational / natural-language interfaces for technical or educational tasks.)*

[3] Anthropic, "Model Context Protocol," 2024. [Online]. Available: https://modelcontextprotocol.io

[4] *(Academic-makerspace operations / management reference, e.g., a prior ISAM paper.)*

---

### Figures

- **Fig. 1** `fig-gallery.png` — gallery: fuzzy search + category/training/material/location facets across ~100 machines; 12-language selector top-right.
- **Fig. 2** `fig-assistant.png` — live MakerLab Assistant exchange on the Bambu Lab X1-Carbon page (first PLA print / bed adhesion → SOP-grounded pre-print checklist).
- **Fig. 3** `fig-project.png` — live MakerLab Assistant project scoping (wooden phone box → start-to-finish, training-aware build plan).

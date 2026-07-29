# Agent evals

Every other test in this repo checks *code*. These check the **assistant** — the
part students actually use, and the part that can get quietly worse while the
whole test suite stays green. A prompt edit, a model bump, a capability rename
or a change to how manuals are attached can all degrade answers without breaking
a single unit test.

The suite checks the three behaviours that carry the assistant's value:

1. it **finds the right machine** from a natural request,
2. it **grounds answers in the catalogue** and says where they came from,
3. it **calls the right tool** instead of inventing an answer,

plus the one that matters most when it regresses: it **admits what the lab does
not have**.

Design spec: [`docs/specs/2026-07-29-agent-eval-harness-design.md`](../../docs/specs/2026-07-29-agent-eval-harness-design.md).

---

## Running it

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # or AI_GATEWAY_API_KEY
npm run eval

EVAL_MODEL=claude-haiku-4-5 npm run eval   # try a different model
```

The suite runs the deployment's own model (`src/lib/model.ts`), so a run says
something about production. `EVAL_MODEL` overrides it — which is exactly what
this harness is for when the question is "does the next model still behave?".

> [!IMPORTANT]
> **This makes real, paid model calls** — roughly one per case, plus a retry for
> any case that fails. It is deliberately **not** part of `npm test` or
> `npm run test:all`, which stay free, offline and green, and it must never be
> wired into a pull-request trigger where a fork could spend your money.

**When to run it:** before merging a change to a prompt fragment, a capability,
or the model id — and before a demo. That is the whole policy.

Output is a per-case line, a detail block for anything that did not pass, and a
JSON artifact at `evals/.last-run.json` (gitignored).

```
  PASS  laser-by-capability
  FLAKY unit-status-calls-tool
  FAIL  form4-build-volume-unknown

FAIL  form4-build-volume-unknown
  prompt: What's the exact build volume and layer resolution on this printer?
  x no_fabricated_specs — expected numbers attributed to build_volume to match the fixture
      "145" is attributed to build_volume, but the fixture records no value for it
      answer: "The Form 4 has a build volume of 145 x 145 x 185 mm."

11/12 passed · 1 flaky · 1 failed · 0 errored
```

**FLAKY is not a pass.** A failing case is retried once; one that passes only on
the retry is reported as flaky and never counted as a pass. Flakiness is signal —
a case that flakes is usually badly written. It does not fail the run (one flake
in a dozen cases is noise), but a *structural* failure is always worth
investigating.

---

## Adding a case

Cases are data. Adding one is editing a YAML file — no code.

Open the file that matches what you are testing (or add a new `*.yaml`; every
file in `cases/` is loaded automatically):

| File | Covers |
|---|---|
| `cases/catalog-lookup.yaml` | Finding the right machine from a natural request |
| `cases/manual-grounding.yaml` | Answering from the record, citing the document, inventing nothing |
| `cases/tool-calling.yaml` | Calling a capability instead of guessing |
| `cases/honest-absence.yaml` | Saying "we don't have that" |

Append a case:

```yaml
- id: laser-by-capability             # unique across every file
  prompt: "I need to cut 3mm acrylic. What should I use?"
  context: { page: gallery }          # or { page: tool, toolId: form-4 }
  assert:
    - kind: mentions_tool
      value: "Trotec Speedy 400"
    - kind: no_unknown_tools
```

`context.toolId` is a **catalogue slug** and puts the assistant on that machine's
detail page, exactly as the chat route does when a student asks a question from
a tool page. `page: tool` requires a `toolId`.

Run `npm test` after editing a case file: the loader is unit-tested, so a typo,
an unknown assertion kind or a missing argument fails there — free and offline —
rather than halfway through a paid run.

### The assertion vocabulary

Kept small on purpose. Structural assertions do almost all the useful work.

| Kind | Argument | Checks |
|---|---|---|
| `mentions_tool` | `value: "Form 4"` | The named machine appears in the answer (plain, bold or linked) |
| `no_unknown_tools` | — | Every machine the answer *offers* exists in the fixture |
| `called_tool` | `value: get_unit_details` | That tool appears in the recorded tool calls |
| `contains_all` | `value: ["gloves"]` | Every literal is present (case-insensitive) |
| `not_contains_any` | `value: ["yes, we have"]` | None of the literals is present |
| `no_fabricated_specs` | `fields: [build_volume]` | Every number attributed to those fields matches the fixture |
| `cites_resource` | `value: "Trotec Speedy 400 SOP"` (optional) | The answer references a document attached to the machine |

**`no_unknown_tools` and `no_fabricated_specs` are the two that matter.** They
are the direct test of "grounded, never fabricated," which is the assistant's
whole promise. Prefer them over adding more literal-substring assertions.

Two details worth knowing:

- **`no_unknown_tools`** flags a machine name from `EQUIPMENT_LEXICON`
  (`fixtures.ts`) that does not resolve to a catalogue machine, *unless the
  sentence is denying that the lab has it* — "we don't have a Glowforge" passes,
  "you can use the Glowforge Pro" fails. It also rejects any `/tools/<slug>`
  link whose slug is not in the catalogue. If the assistant starts inventing a
  brand this list has never heard of, **add it to `EQUIPMENT_LEXICON`** — that
  list is the check's teeth. If the assistant legitimately calls a catalogue
  machine by another name (a manufacturer, a short form), add it to
  `EXTRA_ALIASES` instead.
- **`no_fabricated_specs`** only judges *numbers*, in sentences that mention the
  field. Fields the fixture has no value for — `build_volume`, `laser_power`,
  `resolution` — admit **no** number at all, which is the point: the assistant
  must say it does not know rather than produce a plausible figure. The field
  list lives in `SPEC_FIELDS` (`fixtures.ts`); naming a field that is not there
  fails at load.

### The YAML subset

Case files are parsed by a small parser in `cases.ts` rather than a YAML
dependency the app does not otherwise need. Supported: block mappings, block
sequences, one-line flow sequences (`[a, b]`) and flow mappings (`{ a: b }`),
quoted and plain scalars, `#` comments, 2-space indentation. **Not** supported:
block scalars (`|`, `>`), anchors, multi-document files, tabs. Anything outside
the subset throws with a file and line number — it is never silently misread.

---

## What it runs against

**Fixtures replace Notion, not the model.** Every `NOTION_*` variable is blanked
before the run, so `getCatalogTools()` serves the built-in mock catalogue
(`src/components/mock-catalog.ts`) — a fixed set of machines the assertions can
name exact values from. The model call is real, because a mocked model would
make this theatre.

Today that fixture catalogue is exactly two machines: **Form 4** (resin printer)
and **Trotec Speedy 400** (CO2 laser). Write cases against those; anything else
is, correctly, a machine the lab does not have.

**It exercises the real path.** The runner composes the system prompt and the
tool set through the same `CAPABILITIES` registry and `composeChat` that
`/api/chat` uses. An eval that tested a reimplementation of the prompt would
test nothing.

**Nothing is ever written.** Every `write` capability tool (`report_issue`,
`create_tool`) is replaced with a recorded no-op, so the model still sees and can
still call the same tool surface, but an eval can never create a Notion record.
The provider-native `web_search` / `web_fetch` tools the chat route adds are
omitted — live network, unbounded cost, non-deterministic — so a case must not
depend on the assistant reading a page.

## Files

| File | Purpose |
|---|---|
| `cases/*.yaml` | The cases — data, no code |
| `assertions.ts` | The assertion vocabulary. Pure functions, no I/O |
| `cases.ts` | YAML subset parser + validation. Fails loudly at load |
| `fixtures.ts` | Pins the mock catalogue: aliases, spec fields, equipment lexicon |
| `runner.ts` | Control flow: execute → assert → retry → classify → report |
| `run.eval.ts` | `npm run eval` entrypoint: the real model call and safety rails |
| `vitest.config.ts` | Config for `npm run eval` only — never picked up by `npm test` |

`assertions.ts`, `cases.ts` and `runner.ts` are covered by `*.test.ts` files that
run inside `npm test` with **no API key and no cost** — the runner's control flow
is verified against a stubbed model response.

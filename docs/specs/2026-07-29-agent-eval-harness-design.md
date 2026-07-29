# Agent Eval Harness (Minimal) — Design Spec

**Date:** 2026-07-29
**Status:** Draft — awaiting approval
**Target:** `v5/`
**Branch:** `v5/evals`

## 1. Summary

Every test in this repo checks code. Nothing checks the **assistant**, which is the part
students actually use and the part most likely to get quietly worse. A prompt edit, a model
version bump, a capability rename, or a change to how manuals are attached can all degrade
answers with the entire suite still green — and the way anyone finds out is a student being
told the wrong bed size.

This adds a **deliberately minimal** eval harness: a handful of cases, run on demand rather
than on every PR, checking the three behaviors that carry the assistant's value.

1. It **finds the right machine** from a natural request.
2. It **grounds answers in the manual** and says where the answer came from.
3. It **calls the right tool** instead of inventing an answer.

The design principle is that **structural assertions do almost all the useful work.** Did it
call `get_unit_details`? Does the number in the answer appear in the fixture? Those are
cheap, deterministic, and catch real regressions. Model-graded scoring is deferred entirely
— a drifting judge produces confident nonsense and costs money to do it.

## 2. Goals / Non-goals

### Goals

- Catch it when the assistant stops finding tools, stops citing manuals, or starts
  fabricating specs.
- Run in one command, locally or on demand in CI.
- Cases live in the repo as data, so adding one is editing a file, not writing code.
- Deterministic where it can be: fixtures, not live Notion.
- Cheap enough that nobody avoids running it.

### Non-goals (this iteration)

- **No model-graded scoring.** A second model judging tone and helpfulness is the expensive,
  least trustworthy part. Add it only once the structural layer is boring.
- **No CI gate on every PR.** Real model calls cost money and are non-deterministic. Gating
  merges on a flaky, paid check trains everyone to bypass it.
- **No multi-turn conversations.** Single request → response. Multi-turn state is where
  most complexity lives and least value sits, at this size.
- **No scoring dashboard or history.** Console output and a JSON artifact. Trend tracking
  belongs in Blueprint, where runs are already durable records.
- **No red-teaming or jailbreak suite.** Different discipline, different spec.

## 3. Architecture

```
v5/evals/
  cases/
    catalog-lookup.yaml      # finds the right machine
    manual-grounding.yaml    # cites the manual, invents nothing
    tool-calling.yaml        # calls tools instead of guessing
  runner.ts                  # loads cases, executes, asserts, reports
  assertions.ts              # the assertion vocabulary
  fixtures.ts                # pins the mock catalog + a stub manual
  README.md
```

**It exercises the real path.** The runner calls the same capability registry and the same
system-prompt composition that `/api/chat` uses — not a parallel copy. An eval that tests a
reimplementation tests nothing.

**Fixtures replace Notion, not the model.** Cases run against `mock-catalog.ts` with
`NOTION_*` unset, so the catalog is fixed and assertions can name exact values. The model
call is real, because a mocked model would make this theatre.

**Cost control.** Roughly 10 cases × one call each. Cheap enough to run freely, which is the
point — an expensive suite is an unrun suite.

## 4. Case format

```yaml
- id: laser-by-capability
  prompt: "I need to cut 6mm plywood. What should I use?"
  context: { page: gallery }
  assert:
    - kind: mentions_tool
      value: "Glowforge Pro"
    - kind: no_unknown_tools

- id: bed-size-grounded
  prompt: "What's the build volume on the Bambu Lab X1-Carbon?"
  context: { page: tool, toolId: bambu-x1-carbon }
  assert:
    - kind: contains_all
      value: ["256"]
    - kind: no_fabricated_specs
      fields: [build_volume]

- id: unit-lookup-calls-tool
  prompt: "Is Prusa #1 working right now?"
  context: { page: gallery }
  assert:
    - kind: called_tool
      value: get_unit_details

- id: absent-tool-admits-it
  prompt: "Do you have a waterjet cutter?"
  context: { page: gallery }
  assert:
    - kind: not_contains_any
      value: ["yes, we have", "located in"]
    - kind: no_unknown_tools
```

**The assertion vocabulary, kept small on purpose:**

| Kind | Checks |
|---|---|
| `mentions_tool` | The named tool appears in the answer |
| `no_unknown_tools` | Every tool-like name in the answer exists in the fixture |
| `called_tool` | That tool appears in the recorded tool calls |
| `contains_all` / `not_contains_any` | Literal substrings |
| `no_fabricated_specs` | Numbers attributed to named fields match the fixture |
| `cites_resource` | The answer references an attached document |

`no_unknown_tools` and `no_fabricated_specs` are the two that matter — they are the direct
test of "grounded, never fabricated," which is the assistant's whole promise.

## 5. Behavior / flow

`npm run eval` → load cases → for each, build the same context the chat route builds →
execute through the registry → record text and tool calls → run assertions → report.

Output per case: id, pass/fail, which assertions failed and why. Summary: totals, duration,
approximate token cost. A JSON artifact at `evals/.last-run.json`, gitignored.

**Failure is informative, never bare.** A failed assertion prints the case prompt, the
assertion, the expected value, and the relevant excerpt of the answer. An eval failure that
requires re-running by hand to understand is an eval failure nobody investigates.

**Flake handling.** Models are non-deterministic. A case that fails is retried once; a case
that passes on retry is reported as **FLAKY**, not as a pass. Flakiness is signal — a case
that flakes is usually badly written, and hiding that is how a suite rots.

## 6. UI

None. Command-line only.

## 7. Relationship to existing work

- **Depends on `chat-inventory-intake`** for the capability registry and
  `buildSystemPrompt`. Without it, the runner would have to duplicate the chat route's
  prompt assembly, which is exactly the reimplementation §3 forbids.
- Uses `mock-catalog.ts` unchanged.
- Independent of auth and projects; can be built in parallel with either.
- Distinct from `npm run test:all`, which stays free, offline, and green.

## 8. Security and safety

- **Requires a real `ANTHROPIC_API_KEY`** and spends real money. Never wired into a
  pull-request trigger where a fork could run it.
- **No live Notion**, no live writes. `report_issue` and the intake write tools are stubbed
  in the harness — an eval must never create a Notion record.
- Cases and fixtures contain no student data.

## 9. Phased build order

1. **Runner and assertions** with two cases (`mentions_tool`, `called_tool`). Proves the
   path end to end.
2. **Grounding assertions** — `no_unknown_tools`, `no_fabricated_specs`. The valuable half.
3. **Case set to ~10**, covering catalog lookup, manual grounding, tool calling, and honest
   absence.
4. **`npm run eval` + `evals/README.md`** explaining how to add a case. Documentation is
   what determines whether anyone else ever adds one.
5. *(Optional)* A manual GitHub Actions trigger, secret-gated.

## 10. Testing

The harness itself is tested with `npm run test:all` — no API key, no model calls:

- **Assertions** are pure functions with full unit coverage, including the interesting
  negatives: `no_unknown_tools` catching a plausible-but-absent machine name;
  `no_fabricated_specs` catching a wrong number next to a right field name.
- **Case loading**: malformed YAML and unknown assertion kinds fail loudly at load, not
  mid-run.
- **The runner** is tested against a stubbed model response, so its control flow — retry,
  flaky classification, reporting — is verified without spending anything.

**Cases that would embarrass us**: a harness that reports green because assertions silently
no-op on an unknown kind; a runner that writes to real Notion.

## 11. Open questions

1. **What counts as a regression worth acting on?** With ~10 cases, one failure is 10% and
   probably noise. Suggest: investigate any structural failure, ignore single-case flakes.
   Revisit once the suite is larger.
2. **Who runs it, and when?** Realistically: before merging a prompt or capability change,
   and before a demo. Worth writing into the handover guide rather than assuming.
3. **Should cases be seeded from real questions?** Real chat questions would make the suite
   far more representative, but v5 does not log them. Blueprint does. *Not blocking.*

---
description: Turn a merged spec into a reviewed, phased implementation plan with tasks
---

Produce an implementation plan for the spec: **$ARGUMENTS**

(If no spec is named, list `docs/specs/` and ask which one.)

## Preconditions

The spec must be **merged** (constitution Article 1). If it is still in draft or
open in a PR, say so and stop — planning against a moving spec wastes the plan.

## Steps

1. **Read** `docs/constitution.md`, the spec, and `v5/AGENTS.md`.

2. **Verify the spec against the current code.** Specs go stale. Confirm the files,
   types, and patterns it references still exist and still look the way it assumes.
   Report drift rather than quietly designing around it.

3. **Decompose into tasks**, grouped by the spec's phases. Each task states:
   - the files it creates or changes
   - what "done" means, concretely
   - its tests, and which layer they belong to (`v5/TESTING.md`)
   - what it depends on, and what can run in parallel with it

4. **Flag the risky ones.** Which tasks are likely to be harder than they look,
   touch shared code, or conflict with an unmerged branch.

5. **Check constitution compliance** for the plan as a whole:
   - Capabilities go in the registry, not route handlers (Art. 2)
   - Test suite stays green and offline (Art. 3)
   - Write paths are drafts-by-default (Art. 5)
   - New API routes are rate-limited (Art. 6)
   - New user-facing strings go through `next-intl`, all 12 locales (Art. 7)

6. **Write** the plan to `docs/specs/<same-slug>-plan.md` and report the phase
   count, task count, and anything that should change in the spec.

## Quality bar

- Every phase leaves `main` deployable and `npm run test:all` green.
- Refactors that preserve behavior are separated from changes that alter it —
  never mixed in one task, because the test suite is the proof for the first kind
  and cannot be for the second.
- Prefer more, smaller tasks. A task that can't be described in two sentences is
  two tasks.

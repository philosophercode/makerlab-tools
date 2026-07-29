---
description: Write a design spec for a feature, following the project template and constitution
---

Write a design spec for: **$ARGUMENTS**

Per constitution Article 1, this spec merges as its own PR *before* implementation
begins. Your job in this command is the spec only — do not write implementation code.

## Steps

1. **Read the ground rules.** `docs/constitution.md`, then `docs/specs/TEMPLATE.md`.
   Skim `docs/v5-plan.md` and `v5/AGENTS.md` so the spec fits the architecture
   rather than inventing a parallel one.

2. **Read a good example.** `docs/specs/2026-05-29-v5-test-suite-design.md` is the
   reference for depth and tone; the intake spec on the `chat-inventory-intake`
   branch is the other.

3. **Investigate the code before designing.** Find the files this touches, the
   existing patterns it should follow, and anything already half-built. Check
   unmerged branches (`git branch -a`) — this repo has a history of relevant work
   sitting on branches.

4. **Clarify before planning.** Identify decisions where different reasonable
   answers lead to materially different designs, and ask the user — batched, once,
   with a recommendation for each. Do not silently pick and proceed. Questions that
   only affect a later phase can be recorded in §11 instead of blocking.

5. **Write it** to `docs/specs/YYYY-MM-DD-<slug>.md` using today's date and the
   template's structure.

6. **Report** the path plus the open questions that still need the user's decision.

## Quality bar

- **Non-goals are as valuable as goals.** They prevent the review comment that
  proposes something already ruled out for unrecorded reasons.
- **Be concrete.** Real type definitions, real file paths, real tool names.
- **Notion schema changes are manual.** State precisely what a human must create.
- **Drafts by default** for any write path (Article 5).
- **Phased build order**, each phase leaving `main` deployable.
- **Name the risks.** A spec that reads as though nothing could go wrong has not
  been thought about hard enough.

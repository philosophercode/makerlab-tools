# <Feature Name> — Design Spec

**Date:** YYYY-MM-DD
**Status:** Draft | Approved for planning | Implemented | Superseded
**Target:** `v5/`
**Branch:** `<branch-name>`
**Spec PR:** #NNN · **Implementation PR:** #NNN

> Copy this file to `docs/specs/YYYY-MM-DD-<slug>.md`. Per constitution Article 1,
> this merges **before** implementation begins.
>
> Delete sections that genuinely don't apply — but deleting §2 (Goals/Non-goals),
> §8 (Security), or §10 (Testing) should be rare and deliberate.

## 1. Summary

Two or three paragraphs. What is being added, for whom, and what changes for a
user. Someone who reads only this section should be able to say whether the
feature is worth building.

If the feature requires an architecture change, say so here and name it — the
change is often more consequential than the feature that motivated it.

## 2. Goals / Non-goals

### Goals

- Specific and checkable. "Students can file a ticket from chat without leaving
  the page" — not "improve the maintenance experience."

### Non-goals (this iteration)

- What you are deliberately *not* doing, and ideally one clause on why.
- This section prevents the most expensive kind of review comment: the one that
  proposes a feature you already decided against for reasons you didn't record.

## 3. Architecture

How this fits the capability-registry architecture
(`v5/AGENTS.md`, and the capability registry in `src/lib/capabilities/`). Cover:

- **Which capability** does this belong to — existing or new?
- **Which surfaces** does it reach (chat, MCP, or both), and is anything
  deliberately `chatOnly`?
- **Notion implications.** New databases, properties, or relations? Notion schema
  changes are manual — say exactly what a human must create before the code ships,
  and remember the parser tolerates snake_case and Title-case property names.
- **What moves where**, if this includes a refactor. Call out explicitly whether
  the refactor is behavior-preserving.

Diagrams and type sketches earn their place here.

## 4. Data model

New or changed entities, fields, and relations. Include the shared TypeScript
types other parts of the system will import — getting these right in the spec is
most of the design work.

Notion has no migrations — schema changes are a human editing a database.
List them explicitly, and note what happens to records created before the change.

## 5. Behavior / flow

Step by step, from the user's first action to the persisted result. Include the
unhappy paths — what happens when input is ambiguous, a service is down, or the
user abandons midway. For agent features, sketch the tool-call sequence.

## 6. UI

Components added or changed, states (loading / empty / error / success), and how
it behaves on mobile. Note new user-facing strings — all 12 locale files are
updated together (Article 6).

## 7. Relationship to existing work

Which merged PRs, branches, or specs this builds on, extends, or supersedes.
Flag conflicts with in-flight branches early; a rebase discovered during review
is a rebase discovered too late.

## 8. Security and safety

- **Authorization:** who may call this, and what happens when they may not.
- **Rate limiting:** which routes, what limits (Article 4).
- **External calls:** what is cached, for how long, and what invalidates it (Article 4).
- **Write safety:** drafts-by-default, human confirmation, moderation gates.
- **Untrusted input:** user text, uploaded files, fetched web content, and what
  stops any of it from reaching the model or the database unchecked.
- **Prompt-injection surface** if the agent reads external content.
- **PII** touched, stored, or logged.

## 9. Phased build order

Numbered phases, each independently reviewable and each leaving `main`
deployable. Note which phases can proceed in parallel.

## 10. Testing

Which of the four layers (unit / integration / component / E2E — see
`v5/TESTING.md`) cover what, plus the specific cases that would otherwise be
missed. Every external service is mocked (Article 3).

Name the cases that would embarrass us in production.

## 11. Open questions

Genuine unknowns, each with who decides and by when. An open question that
blocks implementation is resolved before this spec merges; one that only affects
a later phase can travel with the spec.

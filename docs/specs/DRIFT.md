# Spec ↔ Code Drift

> How this project keeps specs and code honest with each other, in both
> directions. Read with [`README.md`](README.md) (what is built) and
> [`../constitution.md`](../constitution.md) (Article 1: no feature without a
> merged spec).

## The problem

Article 1 gets you a spec *before* the code. It does nothing about the weeks
afterwards, when the code moves and the spec does not. Three things happen, and
they need different answers:

1. **The code is wrong.** It does something the spec did not ask for, and the
   spec is still right.
2. **The spec is stale.** The code does something better, or the world changed,
   and the spec was never updated.
3. **The code grew a surface nobody wrote down.** A hotfix, a supporting
   endpoint, a helper that turned out to be load-bearing.

The third is the dangerous one, because nothing surfaces it. A wrong
implementation eventually fails a test or a user. An undocumented feature just
sits there, and the person who inherits it has no idea it was deliberate.

---

## The rule, by direction

**Code diverges, spec is still right → fix the code.** The spec merged; it is
the agreed design. Do not quietly reinterpret it.

**Code diverges, code is right → amend the spec.** In a PR, with the reason, as a
dated **as-built amendment** appended to the spec rather than a silent rewrite of
the original text. *The reason a design changed is usually worth more than the
change itself* — six months on, "we tried X and it did not work because Y" saves
someone from trying X again. Rewriting history erases exactly that.

**Code exists, spec is silent → decide, out loud.** Three valid outcomes: spec it
retroactively as an as-built addition, delete it, or record it as intentionally
undocumented with a reason. The one invalid outcome is leaving it undecided.

**Hotfixes may skip the spec — they may not skip the record.** Article 1 exempts
trivial fixes, and an outage is not the moment to write a design document. But a
hotfix that changes described behaviour creates **spec debt**, and the follow-up
that pays it down is part of the fix, not optional cleanup.

---

## Detection

Two mechanisms, because they catch different things.

### `npm run spec:coverage` — mechanical, cheap, run it often

Enumerates the app's public surface — **API routes, capability tools, npm
scripts, environment variables** — and checks each appears somewhere in `docs/`.

This architecture makes the check unusually effective: the route list and the
capability registry *are* the feature surface, so anything the app can do is in
one of those enumerations. If it is not in the written record, it is
undocumented, full stop.

It is deliberately shallow. It cannot tell you whether code matches what a spec
*says* — only whether the thing exists in writing at all. Which is precisely the
direction humans and agents are worst at noticing.

Anything intentionally undocumented goes in the script's `ACCEPTED` map **with a
reason**. That list is a feature: it turns "nobody noticed" into "someone
decided."

### `/drift` — semantic, expensive, run it at checkpoints

An agent reads each spec against the code it describes and reports divergence,
missing phases, and undocumented behaviour it can see but the mechanical check
cannot. Slower and fallible; catches what greps cannot.

**When to run:** after any workflow-built batch of work, before a release or a
demo, and after any hotfix. Not on every commit — the cost is real and a check
people skip is worse than one they do not have.

---

## Recording an amendment

Append to the spec, never edit the original text:

```markdown
## Amendments

### 2026-07-29 — `/api/identity` added (as-built)

**What changed.** A `GET /api/identity` route was added, not in the original §3.

**Why.** The header renders inside a statically-shelled layout and cannot read
the session cookie during render, so it needs a small endpoint to ask who the
caller is. Not foreseen when the spec was written.

**Scope.** Returns role and display name only; email stays server-side per §8.
Always 200, since anonymous is a normal answer rather than an error.

**Status.** Accepted — the code is right and the spec was incomplete.
```

Then update [`README.md`](README.md) so the master index reflects it.

---

## What this does not attempt

**Clause-level traceability.** Proving every sentence of a spec is satisfied by
some line of code needs machine-readable requirements and a discipline that costs
more than it returns at this size. What is tracked instead is **phase-level**
(README) plus **surface-level** (`spec:coverage`), and the gap between those and
full conformance is covered by judgement, stated as such.

**Automatic spec updates.** An agent may *propose* an amendment; a human merges
it. A spec that rewrites itself to match the code is not a spec — it is a
changelog with extra steps, and it can no longer tell you the code is wrong.

---
description: Check specs against the code, report drift in both directions, propose amendments
---

Check spec ↔ code coherence for: **$ARGUMENTS**

(No argument = every spec in `docs/specs/`.)

Read [`docs/specs/DRIFT.md`](../../docs/specs/DRIFT.md) first — it defines the three
drift directions and the rule for each. Follow it.

## Steps

1. **Run the mechanical check first**, from `v5/`:

   ```bash
   npm run spec:coverage
   ```

   It enumerates routes, capability tools, npm scripts, and env vars, and reports
   anything no document mentions. Start from its output — it is free and it is
   usually right.

2. **Read the spec(s)** in scope, plus `docs/specs/README.md` for the recorded
   build status.

3. **Compare against the code**, per spec. For each §9 phase: does what it calls for
   exist, is it tested, and does it behave as described? Read the code — do not infer
   from filenames.

4. **Classify every divergence** into exactly one bucket:

   - **CODE-WRONG** — spec is still right, code does something else. Propose the code fix.
   - **SPEC-STALE** — code is right, spec was never updated. Draft an as-built amendment
     in the format DRIFT.md gives.
   - **UNDOCUMENTED** — code exists, no spec covers it. Recommend one of: spec it
     retroactively, remove it, or add it to the `ACCEPTED` map in
     `v5/scripts/check-spec-coverage.ts` with a reason.
   - **NOT-BUILT** — specified, agreed, absent. Note whether it was deferred deliberately
     (check the spec and README) or simply missed.

5. **Report.** For each item: which spec and section, what the code does, which bucket,
   and the recommended action. Then update `docs/specs/README.md` if the build status
   changed.

## Rules

- **Propose amendments; do not merge them.** A spec that rewrites itself to match the
  code cannot tell you the code is wrong. Draft the text and leave it for a human.
- **Never edit a spec's original text.** As-built amendments are appended, dated, and
  carry the reason — the reason a design changed usually outlives the change.
- **Do not fix code as part of a drift check**, beyond an obvious typo. Reporting and
  fixing in one pass makes it impossible to review either.
- **Say what you did not check.** A drift report claiming full coverage it did not
  achieve is worse than one with an honest gap, because the next person trusts it.

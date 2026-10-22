#!/usr/bin/env bash
# Every agent eval in one command (evals/README.md, "Run everything").
#
#   npm run eval:all                        # the chat eval, then the manual questions
#   EVAL_MODEL=openai/gpt-6-sol npm run eval:all
#
# REAL, PAID model calls through the Vercel AI Gateway: needs AI_GATEWAY_API_KEY
# (or VERCEL_OIDC_TOKEN) in the environment or .env.local. Never wire it into CI.
#
# 1. The chat eval (`npm run eval`): finding machines, grounding, tool calls,
#    honest absence. Runs on its own fixture catalogue, so it needs no database.
# 2. The manual question eval (`npm run eval:manual-questions`), end to end
#    (EVAL_MQ_E2E=1), on your inventory when DATABASE_URL or PGLITE_DATA_DIR is
#    set, else on the bundled fixture manuals.
#
# Both run even if the first fails; exits non-zero if either did.
set -u
cd "$(dirname "$0")/.."
VITEST=(node --env-file-if-exists=.env.local node_modules/vitest/vitest.mjs run)
fail=0

has_inventory() {
  [ -n "${DATABASE_URL:-}" ] || [ -n "${PGLITE_DATA_DIR:-}" ] && return 0
  [ -f .env.local ] && grep -qE '^(DATABASE_URL|PGLITE_DATA_DIR)=.+' .env.local
}

echo "== 1/2 chat eval =="
"${VITEST[@]}" --config evals/vitest.config.ts || fail=1

echo "== 2/2 manual question eval =="
if has_inventory; then
  EVAL_MQ_E2E=1 "${VITEST[@]}" --config evals/manual-questions.vitest.config.ts || fail=1
else
  echo "(no DATABASE_URL or PGLITE_DATA_DIR: using the bundled fixture manuals)"
  EVAL_MQ_FIXTURES=1 EVAL_MQ_E2E=1 "${VITEST[@]}" --config evals/manual-questions.vitest.config.ts || fail=1
fi

[ "$fail" -eq 0 ] && echo "== all evals passed ==" || echo "== an eval failed (see above) =="
exit "$fail"

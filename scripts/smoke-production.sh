#!/usr/bin/env bash
# Smoke test for a live deployment (operational hardening spec, amendment
# 2026-10-06 "Post-deploy smoke test"). Run by .github/workflows/deploy-smoke.yml
# after every production deployment, and by hand:
#
#   npm run smoke:production                         # https://makerlab-ai.vercel.app
#   SMOKE_BASE_URL=https://example.org npm run smoke:production
#
# Read-only: GET requests only, no sign-in, no chat (a chat turn costs money and
# counts as usage). Exits non-zero when any check fails.
set -u
B="${SMOKE_BASE_URL:-https://makerlab-ai.vercel.app}"
B="${B%/}"
fail=0
ok() { echo "ok    $*"; }
bad() { echo "FAIL  $*"; fail=1; }
get() { curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "$1" 2>/dev/null || echo 000; }

# 1. The health route: the database answers and the catalogue is the live one.
health=$(curl -sS --max-time 30 "$B/api/health" 2>/dev/null || true)
if echo "$health" | grep -q '"status":"ok"' && echo "$health" | grep -q '"catalog":"live"'; then
  ok "/api/health $health"
else
  bad "/api/health ${health:-no response}"
fi

# 2. The public pages, the kiosk, the MCP page, the admin shell and the share image.
for p in / /tools/bambu-lab-x1-carbon-combo-3d-printer /kiosk /map /product /projects /mcp /admin /opengraph-image; do
  c=$(get "$B$p")
  if [ "$c" = 200 ]; then ok "$c $p"; else bad "$c $p"; fi
done

# 3. An image from the lab's own Blob store loads through the optimizer, and an
#    outside host is refused (next.config.ts remotePatterns).
img=$(curl -sS --max-time 30 "$B/projects" 2>/dev/null | grep -o '/_next/image?url=[^" ]*' | head -1 | sed 's/&amp;/\&/g')
if [ -n "$img" ]; then
  c=$(get "$B$img")
  if [ "$c" = 200 ]; then ok "$c optimized image from the lab's store"; else bad "$c optimized image from the lab's store"; fi
else
  echo "skip  no optimized image on /projects"
fi
c=$(get "$B/_next/image?url=https%3A%2F%2Fimages.unsplash.com%2Fphoto-1&w=640&q=75")
if [ "$c" = 400 ]; then ok "$c optimizer refuses an outside host"; else bad "$c optimizer should refuse an outside host (400)"; fi

if [ "$fail" = 0 ]; then echo "SMOKE PASS ($B)"; else echo "SMOKE FAIL ($B)"; fi
exit "$fail"

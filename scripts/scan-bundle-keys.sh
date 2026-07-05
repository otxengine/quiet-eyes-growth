#!/usr/bin/env bash
# ponytail: grep scan — add a line here when a new server-side key vendor is added
set -euo pipefail

DIST="${1:-dist}"

if [[ ! -d "$DIST" ]]; then
  echo "Bundle directory '$DIST' not found — run 'npm run build' first." >&2
  exit 1
fi

# Server-side key prefixes that must never appear in the client bundle.
PATTERNS=(
  'sk-ant-'    # Anthropic
  'tvly-'      # Tavily
  'apify_api_' # Apify
  'AIzaSy'     # Google API keys
  'sk_live_'   # Stripe secret (live)
  'sk_test_sk' # Stripe secret (test) — pk_test_ is public, sk_test_ is not
)

FOUND=0
for pat in "${PATTERNS[@]}"; do
  matches=$(grep -rFl "$pat" --include="*.js" "$DIST" 2>/dev/null || true)
  if [[ -n "$matches" ]]; then
    echo "FAIL: pattern '$pat' found in:" >&2
    echo "$matches" >&2
    FOUND=1
  fi
done

if [[ $FOUND -eq 0 ]]; then
  echo "OK: bundle scan clean — no server-side key patterns found in $DIST"
  exit 0
else
  echo "FAIL: server-side keys detected in client bundle." >&2
  exit 1
fi

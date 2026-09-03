#!/bin/bash
# Phase 2 audit part 2: verify DB objects (functions, trigger, buckets, policies)
# Credentials come from the environment / .env.local — never hardcoded.
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ -f "$PROJECT_ROOT/.env.local" ]; then
  set -a
  . "$PROJECT_ROOT/.env.local"
  set +a
fi
URL="${NEXT_PUBLIC_SUPABASE_URL:?NEXT_PUBLIC_SUPABASE_URL not set — export it or create .env.local}"
KEY="${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY not set — export it or create .env.local}"

rpc() {
  echo "--- rpc $1 ($2) ---"
  curl -s -X POST "$URL/rest/v1/rpc/$1" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" -d "$2" | head -c 400
  echo ""
}

# Helper functions from migration 001 — existence check
rpc "fn_user_is_workspace_member" '{"p_workspace_id":"00000000-0000-0000-0000-000000000000"}'
rpc "fn_user_workspace_role" '{"p_workspace_id":"00000000-0000-0000-0000-000000000000"}'
rpc "fn_user_can_edit_workspace" '{"p_workspace_id":"00000000-0000-0000-0000-000000000000"}'

echo "--- storage buckets (migration 004) ---"
curl -s "$URL/storage/v1/bucket" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" | head -c 600
echo ""
echo "--- table list via pg_meta style OpenAPI ---"
curl -s "$URL/rest/v1/" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" | python3 -c "
import json,sys
d=json.load(sys.stdin)
defs=d.get('definitions',{})
print('TABLES/VIEWS:', sorted(defs.keys()))
paths=d.get('paths',{})
rpcs=[p.split('/rpc/')[1] for p in paths if '/rpc/' in p]
print('FUNCTIONS:', sorted(rpcs))
" 2>&1 | head -20

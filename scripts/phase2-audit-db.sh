#!/bin/bash
# Phase 2 audit: dump live DB state via Supabase REST (service key)
# Credentials come from the environment / .env.local — never hardcoded.
# Auto-load .env.local from the project root when present (already-exported
# vars are NOT overridden because we source it only for unset values).
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ -f "$PROJECT_ROOT/.env.local" ]; then
  set -a
  . "$PROJECT_ROOT/.env.local"
  set +a
fi
URL="${NEXT_PUBLIC_SUPABASE_URL:?NEXT_PUBLIC_SUPABASE_URL not set — export it or create .env.local}"
KEY="${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY not set — export it or create .env.local}"

q() {
  echo "--- $1 ---"
  curl -s "$URL/rest/v1/$2" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" | head -c 2500
  echo ""
}

q "profiles" "profiles?select=id,email,display_name,default_workspace_id,created_at"
q "workspaces" "workspaces?select=id,slug,name,plan,owner_id,created_at"
q "workspace_members" "workspace_members?select=workspace_id,user_id,role,joined_at"
q "forms" "forms?select=id,workspace_id,name,status,public_key,created_by,created_at&order=created_at.desc&limit=10"
q "form_fields count" "form_fields?select=id"
q "submissions count" "submissions?select=id"

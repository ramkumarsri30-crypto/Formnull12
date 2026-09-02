#!/bin/bash
# Phase 2 audit: dump live DB state via Supabase REST (service key)
URL="https://sqtolkfjnskyxnltuyci.supabase.co"
KEY="REDACTED_SUPABASE_SECRET_KEY"

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

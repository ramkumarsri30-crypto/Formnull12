#!/bin/bash
# Phase 2A FINAL E2E part 3 — REAL switch verification (check 12 + 17):
# switch to formnull.test's workspace (2 forms), verify data reload +
# profiles.default_workspace_id persistence, then switch back to the new ws.
# Robust dropdown handling: verify menuitems visible before extracting ref.
set -u
cd /home/z/my-project
S="agent-browser --session e2e"
LOG=scripts/results/phase2a-final-e2e.log
SEL_TEXT='document.querySelector("button[aria-label=\"Switch workspace\"] p.truncate.font-semibold")?.textContent'

selname() { $S eval "$SEL_TEXT" 2>/dev/null | tail -1 | tr -d '"'; }
ref_of() { $S snapshot -i 2>&1 | rg "$1" | rg -o 'ref=e[0-9]+' | head -1 | cut -d= -f2; }

open_menu() {
  local tries=0 ref=""
  while [ $tries -lt 3 ] && [ -z "$ref" ]; do
    $S find role button click --name "Switch workspace" >/dev/null 2>&1
    sleep 1
    ref=$($S snapshot -i 2>&1 | rg -c "menuitem" 2>/dev/null || true)
    if [ -z "$ref" ] || [ "$ref" = "0" ]; then ref=""; $S press Escape >/dev/null 2>&1; sleep 1; fi
    tries=$((tries+1))
  done
}

echo "" | tee -a "$LOG"; echo "### PART 3: real workspace switch ($(date))" | tee -a "$LOG"
$S open "http://localhost:3000/dashboard/" >/dev/null 2>&1
$S wait 3000 >/dev/null 2>&1
echo "current: $(selname)" | tee -a "$LOG"

echo "-- switch to formnull.test's workspace" | tee -a "$LOG"
open_menu
REF=$(ref_of "formnull.test.s workspace")
echo "ref: @${REF:-none}" | tee -a "$LOG"
if [ -n "$REF" ]; then
  $S click "@$REF" 2>&1 | tail -1 | tee -a "$LOG"
  $S wait 2500 >/dev/null 2>&1
fi
echo "selector now: $(selname)" | tee -a "$LOG"
echo "-- dashboard must show the 2 real forms of the previous workspace:" | tee -a "$LOG"
$S snapshot -i -c 2>&1 | rg -i "Phase 2A E2E Test Form|RLS probe|No forms yet" | head -4 | tee -a "$LOG"
$S screenshot download/phase2a-final/13-real-switch-prev-ws.png >/dev/null 2>&1

echo "-- DB check: profiles.default_workspace_id should now be the previous ws" | tee -a "$LOG"
set -a; source .env.local; set +a
bun -e "
import { createClient } from '@supabase/supabase-js';
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const { data: p } = await admin.from('profiles').select('default_workspace_id').eq('email','formnull.test@gmail.com').single();
const { data: w } = await admin.from('workspaces').select('slug').eq('id', p.default_workspace_id!).single();
console.log('profile default ->', w?.slug);
" 2>&1 | rg "profile default" | tee -a "$LOG"

echo "-- switch back to Phase 2A Final Workspace Test" | tee -a "$LOG"
open_menu
REF2=$(ref_of "Phase 2A Final")
echo "ref: @${REF2:-none}" | tee -a "$LOG"
if [ -n "$REF2" ]; then
  $S click "@$REF2" 2>&1 | tail -1 | tee -a "$LOG"
  $S wait 2500 >/dev/null 2>&1
fi
echo "selector now: $(selname)" | tee -a "$LOG"
$S snapshot -i -c 2>&1 | rg -i "No forms yet|Phase 2A E2E|RLS probe" | head -3 | tee -a "$LOG"
$S screenshot download/phase2a-final/14-real-switch-back-new-ws.png >/dev/null 2>&1

echo "-- DB check: default should be back to the new ws" | tee -a "$LOG"
bun -e "
import { createClient } from '@supabase/supabase-js';
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const { data: p } = await admin.from('profiles').select('default_workspace_id').eq('email','formnull.test@gmail.com').single();
const { data: w } = await admin.from('workspaces').select('slug').eq('id', p.default_workspace_id!).single();
console.log('profile default ->', w?.slug);
" 2>&1 | rg "profile default" | tee -a "$LOG"

echo "-- final console/network sweep" | tee -a "$LOG"
$S console 2>&1 | rg -v "DevTools|HMR" | tail -8 | tee -a "$LOG"
$S network requests 2>&1 | rg -v " (200|204|304) " | rg -v "favicon|OPTIONS|stack-frames" | tail -6 | tee -a "$LOG"
echo "### PART 3 finished" | tee -a "$LOG"

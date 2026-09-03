#!/bin/bash
# Phase 2A FINAL E2E — workspace creation through the real FormNull UI.
# Requires: dev server on :3000 (started via double-fork pattern), agent-browser.
# All output -> scripts/results/phase2a-final-e2e.log
set -u
cd /home/z/my-project
S="agent-browser --session e2e"
LOG=scripts/results/phase2a-final-e2e.log
mkdir -p scripts/results download/phase2a-final
: > "$LOG"

step() { echo "" | tee -a "$LOG"; echo "### $1" | tee -a "$LOG"; }
snap() { $S snapshot -i -c 2>&1 | head -60 | tee -a "$LOG"; }

echo "=== PHASE 2A FINAL E2E — workspace creation ($(date)) ===" | tee -a "$LOG"

# ---------- fresh session state ----------
$S close >/dev/null 2>&1
sleep 2
$S open "http://localhost:3000/signin/" 2>&1 | tail -2 | tee -a "$LOG"
$S wait --load networkidle >/dev/null 2>&1
$S wait 1500 >/dev/null 2>&1
echo "page after open: $($S get url 2>&1 | tail -1)" | tee -a "$LOG"

step "STEP 1: sign in as formnull.test@gmail.com"
$S find label "Email" fill "formnull.test@gmail.com" 2>&1 | tee -a "$LOG"
$S find label "Password" fill "TestPass123!" 2>&1 | tee -a "$LOG"
echo "email value: $($S get value 'input[type=email]' 2>&1 | tail -1)" | tee -a "$LOG"
$S wait 2000 >/dev/null 2>&1   # let React hydrate + Fast Refresh settle
$S find role button click --name "Sign in" 2>&1 | tee -a "$LOG"
$S wait --url "/dashboard" --timeout 20000 2>&1 | tee -a "$LOG"
# retry once if hydration race caused a native GET submit (url stays /signin/)
URL_NOW=$($S get url 2>&1 | tail -1)
if [[ "$URL_NOW" == *"/signin/"* ]]; then
  echo "RETRY: sign-in did not navigate (url=$URL_NOW) — re-filling and re-submitting" | tee -a "$LOG"
  $S find label "Email" fill "formnull.test@gmail.com" 2>&1 | tee -a "$LOG"
  $S find label "Password" fill "TestPass123!" 2>&1 | tee -a "$LOG"
  $S wait 2000 >/dev/null 2>&1
  $S find role button click --name "Sign in" 2>&1 | tee -a "$LOG"
  $S wait --url "/dashboard" --timeout 30000 2>&1 | tee -a "$LOG"
fi
$S wait --load networkidle >/dev/null 2>&1
$S wait 2000 >/dev/null 2>&1
$S screenshot download/phase2a-final/01-dashboard-before-create.png >/dev/null 2>&1
echo "URL after sign-in: $($S get url 2>&1 | tail -1)" | tee -a "$LOG"
snap

step "STEP 2: open the workspace selector + Create workspace dialog"
$S find role button click --name "Switch workspace" 2>&1 | tee -a "$LOG"
$S wait 800 >/dev/null 2>&1
$S screenshot download/phase2a-final/02-selector-dropdown.png >/dev/null 2>&1
snap
$S find role menuitem click --name "Create workspace" 2>&1 | tee -a "$LOG"
$S wait 1200 >/dev/null 2>&1
$S screenshot download/phase2a-final/03-create-dialog.png >/dev/null 2>&1
step "STEP 2b: dialog content (must show Create a workspace + fields)"
snap

step "STEP 3: fill name + description, submit"
$S find label "Workspace name" fill "Phase 2A Final Workspace Test" 2>&1 | tee -a "$LOG"
$S find label "Description (optional)" fill "Created by final Phase 2A E2E verification" 2>&1 | tee -a "$LOG"
$S screenshot download/phase2a-final/04-dialog-filled.png >/dev/null 2>&1
$S find role button click --name "Create workspace" 2>&1 | tee -a "$LOG"
$S wait --load networkidle 2>&1 | tee -a "$LOG"
$S wait 2500 >/dev/null 2>&1
$S screenshot download/phase2a-final/05-after-create.png >/dev/null 2>&1
echo "URL after create: $($S get url 2>&1 | tail -1)" | tee -a "$LOG"
snap

step "STEP 4: verify RPC actually called on the network"
$S network requests --filter create_workspace 2>&1 | tee -a "$LOG"

step "STEP 5: console + page errors after creation flow"
echo "-- console:" | tee -a "$LOG"
$S console 2>&1 | tail -30 | tee -a "$LOG"
echo "-- page errors:" | tee -a "$LOG"
$S errors 2>&1 | tail -20 | tee -a "$LOG"

step "STEP 6: hard refresh — selected workspace must persist"
$S reload >/dev/null 2>&1
$S wait --load networkidle >/dev/null 2>&1
$S wait 2500 >/dev/null 2>&1
$S screenshot download/phase2a-final/06-after-refresh.png >/dev/null 2>&1
echo "URL after refresh: $($S get url 2>&1 | tail -1)" | tee -a "$LOG"
snap

step "STEP 7: switch back to previous workspace (formnull.test's workspace) — data must reload"
$S find role button click --name "Switch workspace" 2>&1 | tee -a "$LOG"
$S wait 800 >/dev/null 2>&1
$S find role menuitem click --name "formnull.test's workspace" 2>&1 | tee -a "$LOG"
$S wait --load networkidle >/dev/null 2>&1
$S wait 2000 >/dev/null 2>&1
$S screenshot download/phase2a-final/07-switched-back.png >/dev/null 2>&1
snap

step "STEP 8: switch again to the new workspace — aria-current + Forms stat"
$S find role button click --name "Switch workspace" 2>&1 | tee -a "$LOG"
$S wait 800 >/dev/null 2>&1
$S find role menuitem click --name "Phase 2A Final Workspace Test" 2>&1 | tee -a "$LOG"
$S wait --load networkidle >/dev/null 2>&1
$S wait 2000 >/dev/null 2>&1
$S screenshot download/phase2a-final/08-switched-to-new.png >/dev/null 2>&1
snap

step "STEP 9: final console/network state"
echo "-- network failures (non-2xx):" | tee -a "$LOG"
$S network requests 2>&1 | rg -v "\b(200|201|204|304|307|308)\b" | tail -25 | tee -a "$LOG"
echo "-- console:" | tee -a "$LOG"
$S console 2>&1 | tail -20 | tee -a "$LOG"
echo "-- page errors:" | tee -a "$LOG"
$S errors 2>&1 | tail -10 | tee -a "$LOG"

echo "" | tee -a "$LOG"
echo "=== E2E flow finished ===" | tee -a "$LOG"

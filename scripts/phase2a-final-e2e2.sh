#!/bin/bash
# Phase 2A FINAL E2E part 2 — workspace switching via selector (checks 11-12),
# then sign-out / sign-in session verification (§5).
# Uses ref-based menuitem clicking (accessible names include "Owner · Free"
# suffix which breaks exact-name matching).
set -u
cd /home/z/my-project
S="agent-browser --session e2e"
LOG=scripts/results/phase2a-final-e2e.log
SEL_TEXT='document.querySelector("button[aria-label=\"Switch workspace\"] p.truncate.font-semibold")?.textContent'

hyd() { $S eval "[...document.querySelectorAll('button,a')].filter(el => Object.keys(el).some(k=>k.startsWith('__react'))).length" 2>/dev/null | tail -1 | tr -dc '0-9'; }
selname() { $S eval "$SEL_TEXT" 2>/dev/null | tail -1 | tr -d '"'; }

echo "" | tee -a "$LOG"; echo "### PART 2: switching + session ($(date))" | tee -a "$LOG"

# ensure we're on the dashboard and hydrated
$S open "http://localhost:3000/dashboard/" >/dev/null 2>&1
$S wait 3000 >/dev/null 2>&1
H=$(hyd); echo "hydration: $H" | tee -a "$LOG"
if [ "$H" -lt 3 ] 2>/dev/null; then
  echo "NOT HYDRATED — reloading once (known Turbopack dev flake)" | tee -a "$LOG"
  $S reload >/dev/null 2>&1; $S wait 3000 >/dev/null 2>&1; H=$(hyd)
  echo "hydration after retry: $H" | tee -a "$LOG"
fi
echo "active workspace now: $(selname)" | tee -a "$LOG"

# --- check 11: new workspace appears in the selector ---
echo "" | tee -a "$LOG"; echo "-- CHECK 11: selector lists all 3 workspaces incl. new one" | tee -a "$LOG"
$S find role button click --name "Switch workspace" >/dev/null 2>&1
$S wait 800 >/dev/null 2>&1
$S snapshot -i 2>&1 | rg "menuitem" | tee -a "$LOG"
$S press Escape >/dev/null 2>&1

# --- check 12: switch to previous workspace by ref ---
echo "" | tee -a "$LOG"; echo "-- CHECK 12a: switch to formnull.test's workspace (by ref)" | tee -a "$LOG"
$S find role button click --name "Switch workspace" >/dev/null 2>&1
$S wait 800 >/dev/null 2>&1
REF=$($S snapshot -i 2>&1 | rg "formnull.test's workspace" | rg -o 'ref=e[0-9]+' | head -1 | cut -d= -f2)
echo "ref for previous ws menuitem: @${REF:-none}" | tee -a "$LOG"
if [ -n "$REF" ]; then $S click "@$REF" 2>&1 | tail -1 | tee -a "$LOG"; fi
$S wait 2500 >/dev/null 2>&1
echo "selector after switch: $(selname)" | tee -a "$LOG"
$S eval "document.body.innerText.includes('2') ? 'forms-stat-ok' : 'check'" 2>/dev/null | tail -1 | tee -a "$LOG"
$S screenshot download/phase2a-final/09-switched-to-prev-ws.png >/dev/null 2>&1
$S snapshot -i -c 2>&1 | rg -i "form|heading" | head -12 | tee -a "$LOG"

# --- switch back to the new workspace ---
echo "" | tee -a "$LOG"; echo "-- CHECK 12b: switch back to new workspace (by ref)" | tee -a "$LOG"
$S find role button click --name "Switch workspace" >/dev/null 2>&1
$S wait 800 >/dev/null 2>&1
REF2=$($S snapshot -i 2>&1 | rg "Phase 2A Final Workspace Test" | rg -o 'ref=e[0-9]+' | head -1 | cut -d= -f2)
echo "ref for new ws menuitem: @${REF2:-none}" | tee -a "$LOG"
if [ -n "$REF2" ]; then $S click "@$REF2" 2>&1 | tail -1 | tee -a "$LOG"; fi
$S wait 2500 >/dev/null 2>&1
echo "selector after switch back: $(selname)" | tee -a "$LOG"
$S screenshot download/phase2a-final/10-switched-back-to-new-ws.png >/dev/null 2>&1

# --- §5 session verification: sign out, sign in, default workspace ---
echo "" | tee -a "$LOG"; echo "-- SESSION: sign out" | tee -a "$LOG"
$S find role button click --name "Sign out" 2>&1 | tail -1 | tee -a "$LOG"
$S wait --url "**/" --timeout 15000 >/dev/null 2>&1
$S wait 3000 >/dev/null 2>&1
echo "url after signout: $($S get url 2>&1 | tail -1)" | tee -a "$LOG"
$S screenshot download/phase2a-final/11-after-signout.png >/dev/null 2>&1
COOKIES=$($S cookies 2>&1 | rg -c "sb-" || true)
echo "remaining sb- cookies: ${COOKIES:-0}" | tee -a "$LOG"

echo "-- SESSION: sign back in" | tee -a "$LOG"
$S open "http://localhost:3000/signin/" >/dev/null 2>&1
$S wait 3000 >/dev/null 2>&1
H=$(hyd); echo "signin hydration: $H" | tee -a "$LOG"
if [ "$H" -lt 2 ] 2>/dev/null; then
  echo "NOT HYDRATED — reloading once" | tee -a "$LOG"
  $S reload >/dev/null 2>&1; $S wait 3000 >/dev/null 2>&1
fi
$S find label "Email" fill "formnull.test@gmail.com" >/dev/null 2>&1
$S find label "Password" fill "TestPass123!" >/dev/null 2>&1
$S wait 1500 >/dev/null 2>&1
$S find role button click --name "Sign in" >/dev/null 2>&1
$S wait --url "/dashboard" --timeout 30000 2>&1 | tail -1 | tee -a "$LOG"
$S wait 3000 >/dev/null 2>&1
H=$(hyd); echo "dashboard hydration after signin: $H" | tee -a "$LOG"
if [ "$H" -lt 3 ] 2>/dev/null; then
  echo "NOT HYDRATED — reloading once" | tee -a "$LOG"
  $S reload >/dev/null 2>&1; $S wait 3000 >/dev/null 2>&1
fi
echo "default workspace after re-signin: $(selname)" | tee -a "$LOG"
$S screenshot download/phase2a-final/12-after-resignin.png >/dev/null 2>&1
$S snapshot -i -c 2>&1 | head -14 | tee -a "$LOG"
echo "" | tee -a "$LOG"; echo "### PART 2 finished" | tee -a "$LOG"

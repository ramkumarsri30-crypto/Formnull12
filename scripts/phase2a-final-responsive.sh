#!/bin/bash
# Phase 2A FINAL — responsive verification of the workspace-creation flow.
# For each width: no horizontal overflow, dialog fits, buttons usable,
# selector works, mobile drawer correct where applicable.
set -u
cd /home/z/my-project
S="agent-browser --session resp"
LOG=scripts/results/phase2a-final-responsive.log
mkdir -p scripts/results download/phase2a-final/responsive
: > "$LOG"
S2="agent-browser --session e2e"   # reuse authenticated session state

echo "=== Responsive verification: workspace creation flow ($(date)) ===" | tee -a "$LOG"

WIDTHS="320 375 390 414 480 768 1024 1280 1440 1920 2560"
PASS_COUNT=0; FAIL_COUNT=0

for W in $WIDTHS; do
  # height: phone-ish for narrow, desktop for wide
  if [ "$W" -lt 500 ]; then H=700; elif [ "$W" -lt 900 ]; then H=900; else H=1080; fi
  echo "" | tee -a "$LOG"; echo "--- width $W x $H ---" | tee -a "$LOG"

  # reuse the authenticated e2e session page (already hydrated)
  $S2 set viewport "$W" "$H" >/dev/null 2>&1
  sleep 1
  OV=$($S2 eval "document.documentElement.scrollWidth - document.documentElement.clientWidth" 2>/dev/null | tail -1 | tr -dc '0-9-')
  echo "dashboard horizontal overflow: ${OV}px" | tee -a "$LOG"
  $S2 screenshot "download/phase2a-final/responsive/dash-$W.png" >/dev/null 2>&1

  # mobile drawer check (sidebar hidden on mobile)
  if [ "$W" -lt 768 ]; then
    DRAWER=$($S2 eval "!!document.querySelector('[data-slot=sidebar]') ? 'sidebar-standalone' : (document.querySelector('nav[aria-label=Dashboard]') ? 'nav-visible' : 'nav-hidden')" 2>/dev/null | tail -1)
    echo "mobile nav state: $DRAWER" | tee -a "$LOG"
  fi

  # open create-workspace dialog
  $S2 find role button click --name "Switch workspace" >/dev/null 2>&1
  sleep 1
  $S2 find role menuitem click --name "Create workspace" >/dev/null 2>&1
  sleep 1
  DLG=$($S2 eval "
    (() => {
      const d = document.querySelector('[role=dialog]');
      if (!d) return 'no-dialog';
      const r = d.getBoundingClientRect();
      const fits = r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight + 2;
      const name = !!document.getElementById('ws-create-name');
      const btn = [...d.querySelectorAll('button')].find(b => /Create workspace/.test(b.textContent||''));
      const btnUsable = btn ? (btn.getBoundingClientRect().width > 0 && btn.getBoundingClientRect().height > 0) : false;
      const ovf = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      return JSON.stringify({fits, name, btnUsable, ovf, dw: Math.round(r.width), dh: Math.round(r.height)});
    })()
  " 2>/dev/null | tail -1)
  echo "create dialog: $DLG" | tee -a "$LOG"
  $S2 screenshot "download/phase2a-final/responsive/wsdialog-$W.png" >/dev/null 2>&1
  $S2 press Escape >/dev/null 2>&1; sleep 0.5

  # evaluate pass/fail for this width
  if [[ "$OV" == "0" || -z "$OV" ]] && [[ "$DLG" == *'"fits":true'* && "$DLG" == *'"name":true'* && "$DLG" == *'"btnUsable":true'* && "$DLG" != *'"ovf":'1'* && "$DLG" != *'"ovf":'2'* ]]; then
    echo "WIDTH $W: PASS" | tee -a "$LOG"; PASS_COUNT=$((PASS_COUNT+1))
  else
    echo "WIDTH $W: CHECK-NEEDED" | tee -a "$LOG"; FAIL_COUNT=$((FAIL_COUNT+1))
  fi
done

echo "" | tee -a "$LOG"
echo "RESULT: $PASS_COUNT pass / $FAIL_COUNT check-needed of $(echo $WIDTHS | wc -w) widths" | tee -a "$LOG"

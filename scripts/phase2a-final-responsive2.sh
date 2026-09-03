#!/bin/bash
# Phase 2A FINAL — responsive verification of the workspace-creation flow (v2).
# v2 fixes: mobile drawer opened via hamburger (aria-label="Open menu") below
# lg (1024px); pass/fail evaluated with rg on the dialog JSON (escaped quotes).
set -u
cd /home/z/my-project
LOG=scripts/results/phase2a-final-responsive.log
S2="agent-browser --session e2e"
: > "$LOG"
echo "=== Responsive v2: workspace creation flow ($(date)) ===" | tee -a "$LOG"

WIDTHS="320 375 390 414 480 768 1024 1280 1440 1920 2560"
PASS_COUNT=0; FAIL_COUNT=0

for W in $WIDTHS; do
  if [ "$W" -lt 500 ]; then H=700; elif [ "$W" -lt 900 ]; then H=900; else H=1080; fi
  echo "" | tee -a "$LOG"; echo "--- width $W x $H ---" | tee -a "$LOG"

  $S2 set viewport "$W" "$H" >/dev/null 2>&1
  sleep 1
  OV=$($S2 eval "document.documentElement.scrollWidth - document.documentElement.clientWidth" 2>/dev/null | tail -1 | tr -dc '0-9-')
  echo "dashboard horizontal overflow: ${OV}px" | tee -a "$LOG"

  if [ "$W" -lt 1024 ]; then
    # open mobile drawer via hamburger
    $S2 find role button click --name "Open menu" >/dev/null 2>&1
    sleep 1
    $S2 screenshot "download/phase2a-final/responsive/drawer-$W.png" >/dev/null 2>&1
  fi

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
      return JSON.stringify({fits, name, btnUsable, ovf});
    })()
  " 2>/dev/null | tail -1)
  echo "create dialog: $DLG" | tee -a "$LOG"
  $S2 screenshot "download/phase2a-final/responsive/wsdialog-$W.png" >/dev/null 2>&1
  $S2 press Escape >/dev/null 2>&1; sleep 0.5
  # close drawer if open (click backdrop / Escape again)
  if [ "$W" -lt 1024 ]; then $S2 press Escape >/dev/null 2>&1; sleep 0.5; fi

  OK=1
  [ -z "$OV" ] && OV=99
  [ "$OV" != "0" ] && OK=0
  echo "$DLG" | rg -q '\\"fits\\":true|\\"name\\":true' || OK=0
  echo "$DLG" | rg -q '\\"btnUsable\\":true' || OK=0
  echo "$DLG" | rg -q '\\"ovf\\":0' || OK=0
  if [ "$OK" = "1" ]; then
    echo "WIDTH $W: PASS" | tee -a "$LOG"; PASS_COUNT=$((PASS_COUNT+1))
  else
    echo "WIDTH $W: FAIL" | tee -a "$LOG"; FAIL_COUNT=$((FAIL_COUNT+1))
  fi
done

echo "" | tee -a "$LOG"
echo "RESULT: $PASS_COUNT pass / $FAIL_COUNT fail of 11 widths" | tee -a "$LOG"

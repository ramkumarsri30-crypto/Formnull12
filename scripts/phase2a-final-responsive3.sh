#!/bin/bash
# Phase 2A FINAL — narrow-width responsive re-test (320/375/390).
# Fresh page load per width + hydration retry + ref-based clicking.
set -u
cd /home/z/my-project
S="agent-browser --session e2e"
LOG=scripts/results/phase2a-final-responsive.log

for W in 320 375 390; do
  echo "" | tee -a "$LOG"; echo "--- width $W (fresh page) ---" | tee -a "$LOG"
  $S set viewport "$W" 700 >/dev/null 2>&1
  $S open "http://localhost:3000/dashboard/" >/dev/null 2>&1
  $S wait 3500 >/dev/null 2>&1
  H=$($S eval "[...document.querySelectorAll('button,a')].filter(el=>Object.keys(el).some(k=>k.startsWith('__react'))).length" 2>/dev/null | tail -1 | tr -dc '0-9')
  if [ "$H" -lt 3 ] 2>/dev/null; then
    $S reload >/dev/null 2>&1; $S wait 3500 >/dev/null 2>&1
    H=$($S eval "[...document.querySelectorAll('button,a')].filter(el=>Object.keys(el).some(k=>k.startsWith('__react'))).length" 2>/dev/null | tail -1 | tr -dc '0-9')
  fi
  echo "hydration: $H" | tee -a "$LOG"
  OV=$($S eval "document.documentElement.scrollWidth - document.documentElement.clientWidth" 2>/dev/null | tail -1 | tr -dc '0-9-')
  echo "overflow: ${OV}px" | tee -a "$LOG"

  # open drawer
  $S find role button click --name "Open menu" >/dev/null 2>&1
  sleep 1.2
  $S screenshot "download/phase2a-final/responsive/drawer-$W.png" >/dev/null 2>&1
  # open selector dropdown, find Create workspace by ref
  $S find role button click --name "Switch workspace" >/dev/null 2>&1
  sleep 1.2
  REF=$($S snapshot -i 2>&1 | rg "Create workspace" | rg -o 'ref=e[0-9]+' | head -1 | cut -d= -f2)
  echo "create menuitem ref: @${REF:-none}" | tee -a "$LOG"
  if [ -n "$REF" ]; then $S click "@$REF" >/dev/null 2>&1; fi
  sleep 1.5
  DLG=$($S eval "
    (() => {
      const d = document.querySelector('[role=dialog]');
      if (!d) return 'no-dialog';
      const r = d.getBoundingClientRect();
      const fits = r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight + 2;
      const name = !!document.getElementById('ws-create-name');
      const btn = [...d.querySelectorAll('button')].find(b => /Create workspace/.test(b.textContent||''));
      const btnUsable = btn ? (btn.getBoundingClientRect().width > 0) : false;
      const ovf = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      return JSON.stringify({fits, name, btnUsable, ovf, dw: Math.round(r.width)});
    })()
  " 2>/dev/null | tail -1)
  echo "dialog: $DLG" | tee -a "$LOG"
  $S screenshot "download/phase2a-final/responsive/wsdialog-$W.png" >/dev/null 2>&1
  $S press Escape >/dev/null 2>&1; sleep 0.5; $S press Escape >/dev/null 2>&1; sleep 0.5

  OK=1
  [ -z "$OV" ] && OV=99; [ "$OV" != "0" ] && OK=0
  echo "$DLG" | rg -q '\\"fits\\":true' || OK=0
  echo "$DLG" | rg -q '\\"name\\":true' || OK=0
  echo "$DLG" | rg -q '\\"btnUsable\\":true' || OK=0
  echo "$DLG" | rg -q '\\"ovf\\":0' || OK=0
  echo "WIDTH $W: $([ $OK = 1 ] && echo PASS || echo FAIL)" | tee -a "$LOG"
done

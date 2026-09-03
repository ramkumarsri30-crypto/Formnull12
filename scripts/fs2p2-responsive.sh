#!/bin/bash
# Phase 2 responsive sweep — builder route at 17 widths.
# Verifies: no horizontal overflow, no page-level scroll (fixed-height app),
# rail present at lg+, mobile hamburger header below lg.
set -u
S="agent-browser --session e2e"
BUILDER="http://localhost:3000/dashboard/forms/89edc6dd-bcaf-46a3-b690-fc9a4d8cdd9c/"
LOG="scripts/results/fs2p2-responsive.log"
mkdir -p scripts/results
: > "$LOG"

WIDTHS=(320 375 390 414 480 600 768 820 912 1024 1280 1366 1440 1536 1600 1920 2560)

$S open "$BUILDER" >/dev/null 2>&1
sleep 3

for W in "${WIDTHS[@]}"; do
  H=$(( W < 500 ? 700 : 900 ))
  $S set viewport "$W" "$H" >/dev/null 2>&1
  sleep 1.2
  # measure overflow + scroll + rail visibility + hamburger visibility
  MEAS=$($S eval '(() => {
    const de = document.documentElement;
    const overflowX = de.scrollWidth - de.clientWidth;
    const bodyScrollable = de.scrollHeight > de.clientHeight + 2;
    const rail = document.querySelector("aside[aria-label=\"Builder navigation\"]");
    const railVisible = rail ? getComputedStyle(rail).display !== "none" : false;
    const hamburger = document.querySelector("header button[aria-label=\"Open navigation menu\"]");
    const hamVisible = hamburger ? hamburger.offsetParent !== null : false;
    const propsPanel = document.querySelector("aside[aria-label=Properties]");
    const propsVisible = propsPanel ? propsPanel.offsetParent !== null : false;
    const addFieldBtn = document.querySelector("button[aria-label=\"Open field library to add a field\"]");
    return JSON.stringify({overflowX, bodyScrollable, railVisible, hamVisible, propsVisible, addBtn: !!addFieldBtn});
  })()' 2>/dev/null | tail -1)
  echo "$W -> $MEAS" | tee -a "$LOG"
done

echo "" | tee -a "$LOG"
echo "SUMMARY:" | tee -a "$LOG"
grep -c "overflowX\":0" "$LOG" | xargs -I{} echo "{} / ${#WIDTHS[@]} widths with zero horizontal overflow" | tee -a "$LOG"
grep -c "\"bodyScrollable\":false" "$LOG" | xargs -I{} echo "{} / ${#WIDTHS[@]} widths with no page-level scroll" | tee -a "$LOG"

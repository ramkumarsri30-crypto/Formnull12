#!/usr/bin/env bash
# Phase 3 responsive verification (corrected: `set viewport`).
# Checks horizontal overflow on builder + public form at 12 widths.
set -u
S="agent-browser --session e2e"
BUILDER="http://localhost:3000/dashboard/forms/29db4876-5470-4280-b1b3-2cbdd7d42076"
PUBLIC="http://localhost:3000/f/d9c07a47407e45429d6457a517de2024deb9/"
LOG="download/phase3-audit/responsive2.log"
mkdir -p download/phase3-audit
: > "$LOG"

WIDTHS=(320 375 390 414 480 768 834 1024 1280 1440 1920 2560)
FAIL=0

for W in "${WIDTHS[@]}"; do
  $S set viewport $W 800 >/dev/null 2>&1
  # builder
  $S goto "$BUILDER" >/dev/null 2>&1
  sleep 3
  D1=$($S eval "document.documentElement.scrollWidth - document.documentElement.clientWidth" 2>/dev/null | tail -1 | tr -dc '0-9-')
  D1=${D1:-999}
  [ "$D1" -ne 0 ] && FAIL=1
  # public
  $S goto "$PUBLIC" >/dev/null 2>&1
  sleep 3.5
  D2=$($S eval "document.documentElement.scrollWidth - document.documentElement.clientWidth" 2>/dev/null | tail -1 | tr -dc '0-9-')
  D2=${D2:-999}
  [ "$D2" -ne 0 ] && FAIL=1
  echo "[$W x 800] builder delta=$D1 | public delta=$D2" | tee -a "$LOG"
  $S screenshot "download/phase3-audit/resp2-${W}.png" >/dev/null 2>&1
done

$S set viewport 1920 1080 >/dev/null 2>&1
echo "RESULT: $([ $FAIL -eq 0 ] && echo ALL-PASS || echo HAS-FAILURES)"

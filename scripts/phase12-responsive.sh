#!/usr/bin/env bash
# Phase 12 (Field Expansion) responsive sweep — builder + public form.
# Reuses the agent-browser session "sweep" with explicit set viewport.
set -u

BUILDER="http://localhost:3000/dashboard/forms/10922e6c-ac0a-4de8-a0f1-184c6525da59/"
PUBLIC="http://localhost:3000/f/b21756c92bb6cb5361a1874fd98ba1a2b48e/"
OUT="/home/z/my-project/download/phase12/responsive"
mkdir -p "$OUT"

WIDTHS=(320 360 375 390 414 480 600 768 820 912 1024 1280 1366 1440 1536 1600 1920 2560)

S=0
F=0

for W in "${WIDTHS[@]}"; do
  for PAGE in builder public; do
    if [ "$PAGE" = "builder" ]; then URL="$BUILDER"; else URL="$PUBLIC"; fi
    agent-browser --session sweep set viewport "$W" 800 >/dev/null 2>&1
    agent-browser --session sweep open "$URL" >/dev/null 2>&1
    sleep 1.6
    # Real overflow check on documentElement (body may scroll for the
    # Memphis bleed which is intentional + pointer-events-none)
    OX=$(agent-browser --session sweep eval "document.documentElement.scrollWidth - document.documentElement.clientWidth" 2>/dev/null | tr -d '"' || echo "ERR")
    if [ "$OX" = "0" ] || [ -z "$OX" ]; then
      S=$((S+1))
      STATUS="PASS"
    else
      F=$((F+1))
      STATUS="FAIL"
    fi
    echo "[$STATUS] $PAGE @ ${W}px overflowX=$OX"
    if [ "$W" = "375" ] || [ "$W" = "1440" ] || [ "$W" = "2560" ]; then
      agent-browser --session sweep screenshot "$OUT/${PAGE}-${W}.png" >/dev/null 2>&1
    fi
  done
done

echo ""
echo "SUMMARY: $S pass, $F fail"
exit $([ "$F" -eq 0 ] && echo 0 || echo 1)

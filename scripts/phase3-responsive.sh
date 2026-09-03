#!/usr/bin/env bash
# Phase 3 responsive verification: builder + public form at 12 widths.
# Checks: no horizontal overflow, key controls present.
set -u
S="agent-browser --session e2e"
BUILDER="http://localhost:3000/dashboard/forms/29db4876-5470-4280-b1b3-2cbdd7d42076"
PUBLIC="http://localhost:3000/f/d9c07a47407e45429d6457a517de2024deb9/"
LOG="download/phase3-audit/responsive.log"
mkdir -p download/phase3-audit
: > "$LOG"

WIDTHS=(320 375 390 414 480 768 834 1024 1280 1440 1920 2560)

for W in "${WIDTHS[@]}"; do
  for PAGE in builder public; do
    URL="$BUILDER"; TAG="builder"
    if [ "$PAGE" = "public" ]; then URL="$PUBLIC"; TAG="public"; fi
    $S viewport $W 800 >/dev/null 2>&1
    $S goto "$URL" >/dev/null 2>&1
    sleep 3.5
    OVERFLOW=$($S eval "document.documentElement.scrollWidth + ' vs ' + document.documentElement.clientWidth" 2>/dev/null | tail -1)
    # horizontal overflow if scrollWidth > clientWidth
    SW=$(echo "$OVERFLOW" | grep -oE "^[0-9]+")
    CW=$(echo "$OVERFLOW" | grep -oE "[0-9]+$")
    STATUS="OK"
    if [ -n "$SW" ] && [ -n "$CW" ] && [ "$SW" -gt "$CW" ]; then STATUS="OVERFLOW"; fi
    # presence checks
    if [ "$PAGE" = "builder" ]; then
      HAS_ADD=$($S eval "document.body.textContent.includes('Add field') ? 'yes' : 'no'" 2>/dev/null | tail -1)
      HAS_PUB=$($S eval "document.body.textContent.includes('Publish') ? 'yes' : 'no'" 2>/dev/null | tail -1)
      EXTRA="add=$HAS_ADD publish=$HAS_PUB"
    else
      HAS_SUBMIT=$($S eval "document.body.textContent.includes('Send it!') ? 'yes' : 'no'" 2>/dev/null | tail -1)
      EXTRA="submit=$HAS_SUBMIT"
    fi
    echo "[$W x 800] $TAG: $STATUS (scrollW=$SW clientW=$CW) $EXTRA" | tee -a "$LOG"
    $S screenshot "download/phase3-audit/resp-${TAG}-${W}.png" >/dev/null 2>&1
  done
done
$S viewport 1920 1080 >/dev/null 2>&1
echo "=== done, results in $LOG ==="
grep -c "OK" "$LOG"; echo "^ OK count (expect 24)"; grep -c "OVERFLOW" "$LOG" || true; echo "^ overflow count (expect 0)"

#!/usr/bin/env bash
# Runs every test file in its own process, so a crashed browser costs one file, not the run.
# Usage: tests/run-all.sh [parallel files, default 2] [output folder, default a temp folder]
# A file whose process dies without a summary line is run once more on its own.
set -u
cd "$(dirname "$0")/.."
JOBS="${1:-2}"
OUT="${2:-$(mktemp -d)}"
mkdir -p "$OUT"
one() {
  f="$1"; out="$2/$f.txt"
  node tests/run.js "$f" > "$out" 2>&1
  if ! grep -q "passed, .* failed" "$out"; then node tests/run.js "$f" > "$out" 2>&1; fi
  if ! grep -q "passed, .* failed" "$out"; then echo "  FAIL $f › the test process crashed twice" >> "$out"; echo "0 passed, 0 known, 1 failed  (crash)" >> "$out"; fi
}
export -f one
ls tests | grep '\.test\.js$' | xargs -P "$JOBS" -I{} bash -c 'one "$@"' _ {} "$OUT"
pass=0; known=0; fail=0
for f in "$OUT"/*.txt; do
  l=$(grep "passed, .* failed" "$f" | tail -1)
  pass=$((pass + $(echo "$l" | sed -E 's/^([0-9]+) passed.*/\1/')))
  known=$((known + $(echo "$l" | sed -E 's/.* ([0-9]+) known.*/\1/')))
  fail=$((fail + $(echo "$l" | sed -E 's/.* ([0-9]+) failed.*/\1/')))
done
grep -h -A1 -E "^\s+FAIL" "$OUT"/*.txt | cut -c1-260
echo "$pass passed, $known known, $fail failed  (results in $OUT)"

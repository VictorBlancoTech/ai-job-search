#!/bin/zsh

set -euo pipefail

ROOT="${AI_JOB_SEARCH_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
LOCK_DIR="$ROOT/job_scraper/.digest.lock"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  exit 0
fi
trap 'rmdir "$LOCK_DIR"' EXIT INT TERM

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.bun/bin:$PATH"
OPENCODE_BIN="${OPENCODE_BIN:-$(command -v opencode || true)}"
if [[ -z "$OPENCODE_BIN" ]]; then
  print -u2 "opencode no está disponible en PATH"
  exit 1
fi

# The two fixed invocations below are equivalent to: opencode run --command <name>.
cd "$ROOT"
"$OPENCODE_BIN" run --dir "$ROOT" --auto --command job-scrape
"$OPENCODE_BIN" run --dir "$ROOT" --auto --command job-rank
python3 "$ROOT/tools/digest.py" --root "$ROOT"

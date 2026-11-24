#!/usr/bin/env bash
# End-to-end smoke through a real `pi` binary using the deterministic `agy`
# CLI stub — no credentials or network model calls needed.
set -euo pipefail

EXT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

STUB_DIR="$(mktemp -d)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$STUB_DIR" "$WORK_DIR"' EXIT

cp "$EXT_DIR/tests/e2e/agy-stub.cjs" "$STUB_DIR/agy"
chmod +x "$STUB_DIR/agy"

export XDG_STATE_HOME="$WORK_DIR/state"

echo "pi version: $(pi --version 2>/dev/null || true)"

if command -v timeout >/dev/null 2>&1; then
  TIMEOUT=(timeout 120)
elif command -v gtimeout >/dev/null 2>&1; then
  TIMEOUT=(gtimeout 120)
else
  TIMEOUT=()
fi

run_pi() {
  cd "$WORK_DIR" && PATH="$STUB_DIR:$PATH" ${TIMEOUT[@]+"${TIMEOUT[@]}"} \
    pi -ne -e "$EXT_DIR" -p --model "pi-agy-cli/gemini-4-neon-high" "$1" \
    </dev/null
}

OUT="$(run_pi "magic word")"

echo "--- pi output ---"
echo "$OUT"
echo "-----------------"

if ! grep -q "PORT-OK" <<<"$OUT"; then
  echo "e2e FAILED: expected PORT-OK in output" >&2
  exit 1
fi

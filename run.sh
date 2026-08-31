#!/usr/bin/env bash
# Launch Football Edge. Creates a virtualenv on first run, then starts the app.
set -euo pipefail
cd "$(dirname "$0")"

PY="${PYTHON:-python3}"
if ! "$PY" -c 'import sys; raise SystemExit(sys.version_info < (3, 10))'; then
  echo "Need Python 3.10 or newer; found $("$PY" --version 2>&1)." >&2
  echo "Set PYTHON=/path/to/python3.11 to point at a different interpreter." >&2
  exit 1
fi

if [ ! -d .venv ]; then
  echo "Creating virtualenv in .venv ..."
  "$PY" -m venv .venv
  ./.venv/bin/pip install --quiet --upgrade pip
  ./.venv/bin/pip install --quiet -r requirements.txt
fi

echo "Starting Football Edge on http://localhost:8501"
echo "First run downloads ~7 seasons per league and caches them in cache/;"
echo "that takes a minute or two, after which startup is quick."
exec ./.venv/bin/streamlit run app.py "$@"

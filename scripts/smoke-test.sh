#!/usr/bin/env bash
set -euo pipefail

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-3099}"
URL="http://$HOST:$PORT/api/health"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required"
  exit 1
fi

response="$(curl --silent --show-error --fail "$URL")"
if [[ "$response" != *'"ok":true'* ]]; then
  echo "Unexpected health response: $response"
  exit 1
fi

echo "Smoke test passed for $URL"
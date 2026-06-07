#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"

echo "$ curl -X POST $BASE_URL/api/runs -H 'content-type: application/json' -d @demo-payload.json"
RUN_RESPONSE="$(
  curl -sS -X POST "$BASE_URL/api/runs" \
    -H "content-type: application/json" \
    -d '{
      "agentId": "portfolio-agent",
      "command": "python -c \"print(42)\"",
      "workspaceRef": "demo-workspace",
      "policyYaml": "policy_id: default-terminal-sandbox\nnetwork:\n  allow: false\nfilesystem:\n  writable_paths:\n    - /workspace\nexecution:\n  max_seconds: 20\n  denied_commands:\n    - curl\n    - nc\n"
    }'
)"
echo "$RUN_RESPONSE"

RUN_ID="$(printf '%s' "$RUN_RESPONSE" | python -c "import json,sys; print(json.load(sys.stdin)['runId'])")"

echo
echo "$ curl $BASE_URL/api/runs/$RUN_ID"
for _ in 1 2 3 4 5; do
  curl -sS "$BASE_URL/api/runs/$RUN_ID"
  echo
  sleep 1
done

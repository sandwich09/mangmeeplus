#!/usr/bin/env bash
# Tail prod CloudWatch logs (live).
#
#   ./infra/prod-ecs-express/logs.sh api                    tail api-web live
#   ./infra/prod-ecs-express/logs.sh ai                     tail ai-gateway live
#   ./infra/prod-ecs-express/logs.sh workers                tail workers live
#   ./infra/prod-ecs-express/logs.sh api crm.autonomy       only lines containing "crm.autonomy"
#   ./infra/prod-ecs-express/logs.sh api crm.autonomy 2h    ... looking back 2 hours (default 15m)
#
# Ctrl+C to stop. Uses AWS_PROFILE=watchdog-bedrock unless already set.
set -euo pipefail

SERVICE="${1:-api}"
FILTER="${2:-}"
SINCE="${3:-15m}"

case "$SERVICE" in
  api)     GROUP=/ecs/watchdog-bms-api-web ;;
  ai)      GROUP=/ecs/watchdog-bms-ai-gateway ;;
  workers) GROUP=/ecs/watchdog-bms-workers ;;
  *) echo "usage: logs.sh api|ai|workers [filter-text] [since e.g. 15m|2h|1d]" >&2; exit 1 ;;
esac

export AWS_PROFILE="${AWS_PROFILE:-watchdog-bedrock}"
ARGS=(logs tail "$GROUP" --follow --since "$SINCE" --format short)
if [ -n "$FILTER" ]; then ARGS+=(--filter-pattern "\"$FILTER\""); fi
exec aws "${ARGS[@]}"

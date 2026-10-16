#!/usr/bin/env bash
# Start proof servers in their own recorded sessions; wait for API HTTP health and the web port.
# Safety: stack.sh owns session creation and process-group-only stopping; common.sh checks local DB URLs.
source "$(dirname "$0")/common.sh"
exec bash "$LOCAL_PROOF_DIR/stack.sh" proof start "$@"

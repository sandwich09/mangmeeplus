#!/usr/bin/env bash
# Start trial servers in their own recorded sessions; require API HTTP health.
# Safety: stack.sh owns session creation and process-group-only stopping; common.sh checks local DB URLs.
source "$(dirname "$0")/common.sh"
exec bash "$LOCAL_PROOF_DIR/stack.sh" trial start "$@"

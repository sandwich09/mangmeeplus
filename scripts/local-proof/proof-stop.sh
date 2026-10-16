#!/usr/bin/env bash
# Stop only matching recorded proof process groups. Usage: proof-stop.sh [api|web|all].
# Safety: stack.sh owns session creation and process-group-only stopping; common.sh checks local DB URLs.
source "$(dirname "$0")/common.sh"
exec bash "$LOCAL_PROOF_DIR/stack.sh" proof stop "$@"

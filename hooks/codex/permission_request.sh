#!/bin/bash
source "$(dirname "$0")/_helpers.sh"

INPUT=$(cat)
SESSION_ID=$(get_session_id_from_input "$INPUT")

if [ -n "$SESSION_ID" ]; then
    write_state "$SESSION_ID" "waiting" "Waiting for approval"
    write_notification_event "$INPUT" permission "$(extract_field "$INPUT" "turn_id")"
fi

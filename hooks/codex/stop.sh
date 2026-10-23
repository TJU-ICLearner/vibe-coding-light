#!/bin/bash
source "$(dirname "$0")/_helpers.sh"

INPUT=$(cat)
SESSION_ID=$(get_session_id_from_input "$INPUT")

if [ -n "$SESSION_ID" ]; then
    write_state "$SESSION_ID" "completed" "Task finished"
    write_notification_event "$INPUT" completed "$(extract_field "$INPUT" "turn_id")"
fi

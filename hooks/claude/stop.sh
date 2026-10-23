#!/bin/bash
source "$(dirname "$0")/_helpers.sh"

INPUT=$(cat)
set_input_session_id "$INPUT"

stop_reason=$(extract_field "$INPUT" "reason")
message="Task finished"
[ -n "$stop_reason" ] && message="Finished: $stop_reason"

write_state "completed" "$message"
write_notification_event "$INPUT" completed

#!/bin/bash
source "$(dirname "$0")/_helpers.sh"

INPUT=$(cat)
set_input_session_id "$INPUT"
write_state "working" "User prompt submitted"
write_notification_event "$INPUT" working

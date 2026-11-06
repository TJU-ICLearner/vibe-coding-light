#!/bin/bash
source "$(dirname "$0")/_helpers.sh"

INPUT=$(cat)
set_input_session_id "$INPUT"

tool_name=$(extract_field "$INPUT" "tool_name")
file_path=$(extract_field "$INPUT" "file_path")
message="Tool execution failed"
[ -n "$tool_name" ] && message="${tool_name} failed"

write_state "error" "$message" "$tool_name" "$file_path"
write_notification_event "$INPUT" error

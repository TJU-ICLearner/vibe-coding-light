#!/bin/bash
source "$(dirname "$0")/_helpers.sh"

INPUT=$(cat)
set_input_session_id "$INPUT"

tool_name=$(extract_field "$INPUT" "tool_name")
file_path=$(extract_field "$INPUT" "file_path")
command=$(extract_field "$INPUT" "command")
query=$(extract_field "$INPUT" "query")
message=$(make_message "$tool_name" "$file_path" "$command" "$query")

sf=$(session_file)
if ! grep -q '"state":"working"' "$sf" 2>/dev/null; then
    write_notification_event "$INPUT" working
fi
write_state "working" "$message" "$tool_name" "$file_path" "$command" "$query"

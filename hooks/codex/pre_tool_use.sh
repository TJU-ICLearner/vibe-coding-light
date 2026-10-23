#!/bin/bash
source "$(dirname "$0")/_helpers.sh"

INPUT=$(cat)
SESSION_ID=$(get_session_id_from_input "$INPUT")

tool_name=$(extract_field "$INPUT" "tool_name")
file_path=$(extract_field "$INPUT" "file_path")
command=$(extract_field "$INPUT" "command")
message=$(make_message "$tool_name" "$file_path" "$command")

if [ -n "$SESSION_ID" ]; then
    if ! grep -q '"state":"working"' "$(session_file "$SESSION_ID")" 2>/dev/null; then
        write_notification_event "$INPUT" working "$(extract_field "$INPUT" "turn_id")"
    fi
    write_state "$SESSION_ID" "working" "$message" "$tool_name" "$file_path" "$command"
fi

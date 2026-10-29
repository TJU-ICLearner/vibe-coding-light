#!/bin/bash
source "$(dirname "$0")/_helpers.sh"

INPUT=$(cat)
SESSION_ID=$(get_session_id_from_input "$INPUT")

tool_name=$(extract_field "$INPUT" "tool_name")
file_path=$(extract_field "$INPUT" "file_path")
command=$(extract_field "$INPUT" "command")
message=$(make_message "$tool_name" "$file_path" "$command")

if [ -n "$SESSION_ID" ]; then
    tool_failed=0
    if printf '%s' "$INPUT" | perl -MJSON::PP -0777 -ne '
        eval {
            my $response = decode_json($_)->{tool_response};
            exit((ref($response) eq "HASH" &&
                (($response->{isError} // 0) eq JSON::PP::true ||
                 ($response->{exit_code} // 0) =~ /^[1-9][0-9]*$/)) ? 0 : 1);
        };
        exit 1;
    ' 2>/dev/null; then
        tool_failed=1
    fi
    if [ "$tool_failed" -eq 0 ] && codex_is_question_tool "$INPUT"; then
        if ! grep -q '"state":"waiting"' "$(session_file "$SESSION_ID")" 2>/dev/null; then
            write_notification_event "$INPUT" question "$(extract_field "$INPUT" "turn_id")"
        fi
        write_state "$SESSION_ID" "waiting" "Waiting for user input"
        exit 0
    fi
    if [ "$tool_failed" -eq 1 ]; then
        write_notification_event "$INPUT" error "$(extract_field "$INPUT" "turn_id")"
    fi
    write_state "$SESSION_ID" "working" "$message" "$tool_name" "$file_path" "$command"
fi

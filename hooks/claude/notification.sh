#!/bin/bash
source "$(dirname "$0")/_helpers.sh"

INPUT=$(cat)

notification_type=$(extract_field "$INPUT" "notification_type")
case "$notification_type" in
    permission_prompt)
        write_state "waiting" "Waiting for confirmation"
        write_notification_event "$INPUT" permission
        ;;
    elicitation_dialog|elicitation_url_dialog)
        write_state "waiting" "Waiting for confirmation"
        write_notification_event "$INPUT" question
        ;;
esac

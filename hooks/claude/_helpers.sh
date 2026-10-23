#!/bin/bash
# Shared helper for code-light hooks

CODE_LIGHT_DIR="$HOME/.code-light"
SESSIONS_DIR="$CODE_LIGHT_DIR/sessions"
EVENTS_DIR="$CODE_LIGHT_DIR/events"

# Use stable session ID from environment
get_session_id() {
    echo "${CLAUDE_CODE_SESSION_ID:-unknown}"
}

ensure_dir() {
    mkdir -p "$SESSIONS_DIR"
}

session_file() {
    echo "$SESSIONS_DIR/$(get_session_id).json"
}

# Atomic write
_atomic_write() {
    local target="$1"
    local content="$2"
    local tmp="${target}.tmp.$$"
    printf '%s' "$content" > "$tmp"
    mv "$tmp" "$target"
}

# Escape string for safe JSON embedding
json_escape() {
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\n'/\\n}"
    s="${s//$'\r'/\\r}"
    s="${s//$'\t'/\\t}"
    printf '%s' "$s"
}

# Extract a string field value from JSON input
extract_field() {
    local input="$1"
    local field="$2"
    printf '%s' "$input" | grep -o "\"${field}\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed 's/.*:.*"\(.*\)"/\1/'
}

# Build descriptive message from tool context
make_message() {
    local tool_name="$1"
    local file_path="${2:-}"
    local command="${3:-}"
    local query="${4:-}"

    case "$tool_name" in
        Read)
            [ -n "$file_path" ] && printf 'Reading %s' "$(basename "$file_path")" && return
            ;;
        Edit)
            [ -n "$file_path" ] && printf 'Editing %s' "$(basename "$file_path")" && return
            ;;
        Write)
            [ -n "$file_path" ] && printf 'Writing %s' "$(basename "$file_path")" && return
            ;;
        NotebookEdit)
            [ -n "$file_path" ] && printf 'Editing notebook %s' "$(basename "$file_path")" && return
            ;;
        Bash)
            [ -n "$command" ] && printf 'Running: %s' "${command:0:60}" && return
            ;;
        WebSearch)
            [ -n "$query" ] && printf 'Searching: %s' "${query:0:60}" && return
            ;;
        Agent)
            [ -n "$file_path" ] && printf 'Agent: %s' "$file_path" && return
            ;;
        AskUserQuestion)
            printf 'Waiting for user input' && return
            ;;
        *)
            ;;
    esac
    [ -n "$tool_name" ] && printf 'Using %s' "$tool_name"
}

# Write the latest event, including events from a new turn in the same session.
# Args: state [message] [tool_name] [file_path] [command] [query]
write_state() {
    local state="$1"
    local message="${2:-}"
    local tool_name="${3:-}"
    local file_path="${4:-}"
    local command="${5:-}"
    local query="${6:-}"

    ensure_dir
    local sf="$(session_file)"

    local session_id="$(get_session_id)"
    local ts="$(date +%s)"
    local cwd=$(json_escape "${PWD:-}")
    local project=$(json_escape "$(basename "${PWD:-}")")

    # Build JSON object
    local json="{"
    json="${json}\"state\":\"${state}\""
    json="${json},\"message\":\"$(json_escape "$message")\""
    json="${json},\"timestamp\":${ts}"
    json="${json},\"session_id\":\"$(json_escape "$session_id")\""
    [ -n "$tool_name" ] && json="${json},\"tool_name\":\"$(json_escape "$tool_name")\""
    [ -n "$file_path" ] && json="${json},\"file_path\":\"$(json_escape "$file_path")\""
    [ -n "$command" ] && json="${json},\"command\":\"$(json_escape "$command")\""
    [ -n "$query" ] && json="${json},\"query\":\"$(json_escape "$query")\""
    json="${json},\"cwd\":\"${cwd}\""
    json="${json},\"project\":\"${project}\""
    json="${json},\"agent\":\"claude\""
    json="${json}}"

    _atomic_write "$sf" "$json"
}

# Record a small immutable event for the running app. Never send from a hook.
write_notification_event() {
    local input="$1" kind="$2" turn_id="${3:-}"
    local session_id
    session_id=$(extract_field "$input" "session_id")
    [ -n "$session_id" ] || session_id=$(get_session_id)
    [ -n "$session_id" ] && [ "$session_id" != unknown ] || return 0
    mkdir -p "$EVENTS_DIR" 2>/dev/null || return 0
    local id ts target tmp
    id=$(uuidgen | tr '[:upper:]' '[:lower:]')
    ts=$(( $(date +%s) * 1000 ))
    target="$EVENTS_DIR/$id.json"
    tmp="$target.tmp.$$"
    printf '{"id":"%s","source":"claude","session_id":"%s","turn_id":%s,"kind":"%s","at_ms":%s}' \
        "$id" "$(json_escape "$session_id")" \
        "$(if [ -n "$turn_id" ]; then printf '"%s"' "$(json_escape "$turn_id")"; else printf null; fi)" \
        "$kind" "$ts" > "$tmp" 2>/dev/null || return 0
    chmod 600 "$tmp" 2>/dev/null || true
    mv "$tmp" "$target" 2>/dev/null || true
}

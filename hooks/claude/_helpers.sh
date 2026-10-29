#!/bin/bash
# Shared helper for code-light hooks
umask 077

CODE_LIGHT_DIR="$HOME/.code-light"
SESSIONS_DIR="$CODE_LIGHT_DIR/sessions"
EVENTS_DIR="$CODE_LIGHT_DIR/events"

# Cursor, TRAE and Grok Build can import Claude hooks. Their native adapters
# write the correct source label, so skip this compatibility invocation.
code_light_compat_host() {
    [ -n "${CURSOR_PROJECT_DIR:-}" ] || [ -n "${TRAE_PROJECT_DIR:-}" ] || [ -n "${GROK_SESSION_ID:-}" ]
}

detail_capture_enabled() {
    local pid updated now
    [ -r "$CODE_LIGHT_DIR/detail-capture" ] || return 1
    read -r pid updated < "$CODE_LIGHT_DIR/detail-capture" || return 1
    [[ "$pid" =~ ^[0-9]+$ && "$updated" =~ ^[0-9]+$ ]] || return 1
    # Tauri writes a native Windows PID, which MSYS `kill` cannot reliably query.
    if [ "${OS:-}" != "Windows_NT" ]; then
        case "${MSYSTEM:-$(uname -s 2>/dev/null)}" in
            MINGW*|MSYS*|CYGWIN*) ;;
            *) kill -0 "$pid" 2>/dev/null || return 1 ;;
        esac
    fi
    now=$(date +%s)
    (( now >= updated && now - updated <= 15 ))
}

# Use stable session ID from environment
get_session_id() {
    echo "${HOOK_SESSION_ID:-${CLAUDE_CODE_SESSION_ID:-unknown}}"
}

set_input_session_id() {
    local candidate
    candidate=$(extract_field "$1" "session_id")
    if [[ "$candidate" =~ ^[a-zA-Z0-9_-]+$ ]]; then
        HOOK_SESSION_ID="$candidate"
    fi
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
    code_light_compat_host && return 0
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
    code_light_compat_host && return 0
    local input="$1" kind="$2" turn_id="${3:-}" fallback_command="${4:-}" new_turn="${5:-0}"
    local session_id
    session_id=$(get_session_id)
    [ -n "$session_id" ] && [ "$session_id" != unknown ] || return 0
    mkdir -p "$EVENTS_DIR" 2>/dev/null || return 0
    local id ts target tmp capture=0
    detail_capture_enabled && capture=1
    id=$(perl -MTime::HiRes -e 'printf "e-%x-%x-%x", int(Time::HiRes::time() * 1000000), $$, int(rand(0x7fffffff))' 2>/dev/null) || return 0
    ts=$(perl -MTime::HiRes -e 'printf "%.0f", Time::HiRes::time() * 1000' 2>/dev/null) || ts=$(( $(date +%s) * 1000 ))
    target="$EVENTS_DIR/$id.json"
    tmp="$target.tmp.$$"
    printf '%s' "$input" | perl -MJSON::PP -0777 -e '
        my ($id, $session, $turn, $kind, $ts, $fallback_command, $capture, $new_turn) = @ARGV;
        my $input = eval { decode_json(<STDIN>) } || {};
        my $short = sub {
            my ($value) = @_;
            return undef if !defined($value) || ref($value) || $value eq "";
            return length($value) > 1000 ? substr($value, 0, 1000) . "..." : $value;
        };
        my $tool = ref($input->{tool_input}) eq "HASH" ? $input->{tool_input} : {};
        my %details;
        if ($capture eq "1") {
            for my $pair ([task => $input->{prompt}], [command => ($tool->{command} // $fallback_command)],
                [error => $input->{error}], [reply => $input->{last_assistant_message}], [question => $input->{message}]) {
                my $value = $short->($pair->[1]);
                $details{$pair->[0]} = $value if defined($value);
            }
        }
        print encode_json({id=>$id, source=>"claude", session_id=>$session,
            turn_id=>($turn eq "" ? undef : $turn), kind=>$kind, new_turn=>($new_turn eq "1" ? JSON::PP::true : JSON::PP::false), at_ms=>0+$ts, details=>\%details});
    ' "$id" "$session_id" "$turn_id" "$kind" "$ts" "$fallback_command" "$capture" "$new_turn" > "$tmp" 2>/dev/null || return 0
    chmod 600 "$tmp" 2>/dev/null || true
    mv "$tmp" "$target" 2>/dev/null || true
}

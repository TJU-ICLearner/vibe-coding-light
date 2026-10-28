#!/bin/bash
# Shared helper for code-light Codex hooks
umask 077

CODE_LIGHT_DIR="$HOME/.code-light"
SESSIONS_DIR="$CODE_LIGHT_DIR/sessions"
EVENTS_DIR="$CODE_LIGHT_DIR/events"

detail_capture_enabled() {
    local pid updated now
    [ -r "$CODE_LIGHT_DIR/detail-capture" ] || return 1
    read -r pid updated < "$CODE_LIGHT_DIR/detail-capture" || return 1
    [[ "$pid" =~ ^[0-9]+$ && "$updated" =~ ^[0-9]+$ ]] || return 1
    kill -0 "$pid" 2>/dev/null || return 1
    now=$(date +%s)
    (( now >= updated && now - updated <= 15 ))
}

# Extract session_id from JSON input (handles optional whitespace)
get_session_id_from_input() {
    local input="$1"
    echo "$input" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'
}

ensure_dir() {
    mkdir -p "$SESSIONS_DIR"
}

session_file() {
    echo "$SESSIONS_DIR/$1.json"
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

    case "$tool_name" in
        Read|read_file)
            [ -n "$file_path" ] && printf 'Reading %s' "$(basename "$file_path")" && return
            ;;
        Edit|edit_file|Write|write_file)
            [ -n "$file_path" ] && printf 'Editing %s' "$(basename "$file_path")" && return
            ;;
        Bash|shell)
            [ -n "$command" ] && printf 'Running: %s' "${command:0:60}" && return
            ;;
        *)
            ;;
    esac
    [ -n "$tool_name" ] && printf 'Using %s' "$tool_name"
}

# Write the latest event, including events from a new turn in the same session.
# Args: session_id state [message] [tool_name] [file_path] [command]
write_state() {
    local session_id="$1"
    local state="$2"
    local message="${3:-}"
    local tool_name="${4:-}"
    local file_path="${5:-}"
    local command="${6:-}"

    ensure_dir
    local sf
    sf="$(session_file "$session_id")"

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
    json="${json},\"cwd\":\"${cwd}\""
    json="${json},\"project\":\"${project}\""
    json="${json},\"agent\":\"codex\""
    json="${json}}"

    _atomic_write "$sf" "$json"
}

write_notification_event() {
    local input="$1" kind="$2" turn_id="${3:-}" new_turn="${4:-0}"
    local session_id
    session_id=$(get_session_id_from_input "$input")
    [ -n "$session_id" ] || return 0
    mkdir -p "$EVENTS_DIR" 2>/dev/null || return 0
    local id ts target tmp capture=0
    detail_capture_enabled && capture=1
    id=$(perl -MTime::HiRes -e 'printf "e-%x-%x-%x", int(Time::HiRes::time() * 1000000), $$, int(rand(0x7fffffff))' 2>/dev/null) || return 0
    ts=$(perl -MTime::HiRes -e 'printf "%.0f", Time::HiRes::time() * 1000' 2>/dev/null) || ts=$(( $(date +%s) * 1000 ))
    target="$EVENTS_DIR/$id.json"
    tmp="$target.tmp.$$"
    printf '%s' "$input" | perl -MJSON::PP -0777 -e '
        my ($id, $session, $turn, $kind, $ts, $capture, $new_turn) = @ARGV;
        my $input = eval { decode_json(<STDIN>) } || {};
        my $short = sub {
            my ($value) = @_;
            return undef if !defined($value) || ref($value) || $value eq "";
            return length($value) > 1000 ? substr($value, 0, 1000) . "..." : $value;
        };
        my $tool = ref($input->{tool_input}) eq "HASH" ? $input->{tool_input} : {};
        my $response = $input->{tool_response};
        my $error = $input->{error};
        if (!defined($error) && ref($response) eq "HASH") {
            for my $field (qw(error stderr output stdout)) {
                my $value = $response->{$field};
                if (defined($value) && !ref($value) && $value ne "") {
                    $error = $value;
                    last;
                }
            }
            if (!defined($error) && ref($response->{content}) eq "ARRAY") {
                $error = join "\n", map { ref($_) eq "HASH" ? ($_->{text} // "") : "" } @{$response->{content}};
            }
        }
        $error = $response if !defined($error) && !ref($response);
        my %details;
        if ($capture eq "1") {
            for my $pair ([task => $input->{prompt}], [command => $tool->{command}],
                [error => $error], [reply => $input->{last_assistant_message}], [question => $input->{message}]) {
                my $value = $short->($pair->[1]);
                $details{$pair->[0]} = $value if defined($value);
            }
        }
        print encode_json({id=>$id, source=>"codex", session_id=>$session,
            turn_id=>($turn eq "" ? undef : $turn), kind=>$kind, new_turn=>($new_turn eq "1" ? JSON::PP::true : JSON::PP::false), at_ms=>0+$ts, details=>\%details});
    ' "$id" "$session_id" "$turn_id" "$kind" "$ts" "$capture" "$new_turn" > "$tmp" 2>/dev/null || return 0
    chmod 600 "$tmp" 2>/dev/null || true
    mv "$tmp" "$target" 2>/dev/null || true
}

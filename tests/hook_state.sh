#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
test_home="$(mktemp -d)"
trap 'rm -rf "$test_home"' EXIT
export HOME="$test_home"

for helper in "$repo_dir/hooks/claude/_helpers.sh" "$repo_dir/hooks/codex/_helpers.sh"; do
    mode=$(bash -c 'umask 022; source "$1"; umask' _ "$helper")
    test "$mode" = 0077 || { echo "Hook helper leaves private events exposed with umask $mode"; exit 1; }
done

codex_event='{"session_id":"codex-1","cwd":"/tmp/project"}'
printf '%s' "$codex_event" | bash "$repo_dir/hooks/codex/stop.sh"
printf '%s' "$codex_event" | bash "$repo_dir/hooks/codex/user_prompt_submit.sh"
codex_state="$(sed -n 's/.*"state":"\([^"]*\)".*/\1/p' "$HOME/.code-light/sessions/codex-1.json")"
test "$codex_state" = working || { echo "Codex did not resume after Stop: $codex_state"; exit 1; }

export CLAUDE_CODE_SESSION_ID=claude-1
claude_event='{"session_id":"claude-1","tool_name":"Read","tool_input":{"file_path":"/tmp/project/a.txt"}}'
printf '%s' "$claude_event" | bash "$repo_dir/hooks/claude/stop.sh"
printf '%s' "$claude_event" | bash "$repo_dir/hooks/claude/pre-tool-use.sh"
claude_state="$(sed -n 's/.*"state":"\([^"]*\)".*/\1/p' "$HOME/.code-light/sessions/claude-1.json")"
test "$claude_state" = working || { echo "Claude did not resume after Stop: $claude_state"; exit 1; }

printf '%s' '{"session_id":"codex-private","prompt":"private task text"}' | bash "$repo_dir/hooks/codex/user_prompt_submit.sh"
printf '%s %s\n' "$$" "$(date +%s)" > "$HOME/.code-light/detail-capture"
chmod 600 "$HOME/.code-light/detail-capture"
printf '%s' '{"session_id":"codex-detail","turn_id":"turn-1","prompt":"修复登录按钮"}' | bash "$repo_dir/hooks/codex/user_prompt_submit.sh"
printf '%s' '{"session_id":"codex-detail","turn_id":"turn-1","tool_name":"Bash","tool_input":{"command":"npm test"}}' | bash "$repo_dir/hooks/codex/permission_request.sh"
printf '%s' '{"session_id":"codex-detail","turn_id":"turn-1","tool_name":"Bash","tool_response":{"exit_code":1,"stderr":"","output":"Tests failed"}}' | bash "$repo_dir/hooks/codex/post_tool_use.sh"
printf '%s' '{"session_id":"claude-detail","prompt":"修复同步错误"}' | bash "$repo_dir/hooks/claude/user-prompt-submit.sh"
printf '%s' '{"session_id":"claude-detail","tool_name":"Bash","tool_input":{"command":"printf \"hello\""}}' | bash "$repo_dir/hooks/claude/pre-tool-use.sh"
printf '%s' '{"session_id":"claude-detail","tool_name":"Bash","tool_input":{"command":"npm test"},"error":"Exit code 1: module missing"}' | bash "$repo_dir/hooks/claude/post-tool-use-failure.sh"
python3 - <<'PY'
import glob, json, os
events = [json.load(open(path)) for path in glob.glob(os.path.join(os.environ['HOME'], '.code-light/events/*.json'))]
def detail(source, kind, session):
    return next(event['details'] for event in events if event['source'] == source and event['kind'] == kind and event['session_id'] == session)
assert detail('codex', 'working', 'codex-detail')['task'] == '修复登录按钮'
assert detail('codex', 'working', 'codex-private').get('task') is None
assert next(event for event in events if event['source'] == 'codex' and event['kind'] == 'working' and event['session_id'] == 'codex-private')['new_turn'] is True
assert any(event.get('new_turn') is True for event in events if event['source'] == 'claude' and event['kind'] == 'working' and event['session_id'] == 'claude-detail')
assert detail('codex', 'permission', 'codex-detail')['command'] == 'npm test'
assert detail('codex', 'error', 'codex-detail')['error'] == 'Tests failed'
assert any(event.get('details', {}).get('task') == '修复同步错误' for event in events if event['source'] == 'claude' and event['kind'] == 'working' and event['session_id'] == 'claude-detail')
assert any(event.get('details', {}).get('command') == 'printf "hello"' for event in events if event['source'] == 'claude' and event['kind'] == 'working' and event['session_id'] == 'claude-detail')
assert detail('claude', 'error', 'claude-detail')['error'] == 'Exit code 1: module missing'
PY

echo 'Hook state tests passed'

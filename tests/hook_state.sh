#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
test_home="$(mktemp -d)"
trap 'rm -rf "$test_home"' EXIT
export HOME="$test_home"

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

echo 'Hook state tests passed'

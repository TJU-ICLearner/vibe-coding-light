#!/bin/bash
# Read-only adapter for clients with command hooks. Never blocks an agent action.
umask 077
# Grok Build can load Cursor user hooks in addition to its own hooks.
if [ "${1:-}" = cursor ] && [ -n "${GROK_SESSION_ID:-}" ]; then exit 0; fi
exec perl -MJSON::PP -MTime::HiRes=time -MFile::Path=make_path -MFile::Basename=basename -e '
    use strict; use warnings;
    my ($source, $hook) = @ARGV;
    exit 0 unless $source =~ /\A(?:cursor|trae|grok|deepseek)\z/;
    local $/;
    my $input = eval { decode_json(<STDIN>) };
    exit 0 unless ref($input) eq "HASH";
    my $session = $input->{session_id} // $input->{sessionId} // $input->{conversation_id} // "";
    exit 0 if ref($session) || $session eq "";
    $session =~ s/[^A-Za-z0-9_-]/_/g;
    $session = substr($session, 0, 100);
    my $turn = $input->{turn_id} // $input->{turnId} // $input->{generation_id};
    $turn = undef if defined($turn) && ref($turn);
    if (defined($turn)) { $turn =~ s/[^A-Za-z0-9_-]/_/g; $turn = substr($turn, 0, 128); }
    my $kind = $hook eq "prompt" || $hook eq "working" ? "working" :
        $hook eq "stop" ? "completed" :
        $hook eq "error" || $hook eq "stop_failure" ? "error" :
        $hook eq "permission" ? "permission" :
        $hook eq "question" ? "question" : "";
    if ($hook eq "notification") {
        my $type = $input->{notification_type} // $input->{notificationType} // "";
        $kind = $type eq "permission_prompt" || $type eq "document_review" ? "permission" :
            $type eq "ask_user_question" || $type eq "browser_interaction" ? "question" : "";
    }
    if ($hook eq "post") {
        my $response = $input->{tool_response} // $input->{toolResponse} // $input->{tool_output};
        $kind = ref($response) eq "HASH" && ($response->{isError} || ($response->{exit_code} // 0) =~ /\A[1-9][0-9]*\z/) ? "error" : "";
    }
    if ($source eq "cursor" && $hook eq "stop") {
        my $status = $input->{status} // "";
        $kind = $status eq "error" ? "error" : $status eq "aborted" ? "" : "completed";
    }
    exit 0 if $kind eq "";
    my $home = $ENV{HOME} // "";
    exit 0 if $home eq "";
    my $base = "$home/.code-light";
    my $events = "$base/events";
    my $sessions = "$base/sessions";
    eval { make_path($events, $sessions) }; exit 0 if $@;
    my $now = time;
    my $id = sprintf("e-%x-%x-%x", int($now * 1000000), $$, int(rand(0x7fffffff)));
    my $cwd = $input->{cwd} // $input->{workspace_root} // $ENV{PWD} // "";
    $cwd = "" if ref($cwd);
    my $tool = $input->{tool_name} // $input->{toolName} // "";
    $tool = "" if ref($tool);
    my $tool_input = $input->{tool_input} // $input->{toolInput};
    $tool_input = {} unless ref($tool_input) eq "HASH";
    my $command = $tool_input->{command} // $input->{command} // "";
    $command = "" if ref($command);
    my $message = $kind eq "permission" ? "Waiting for approval" :
        $kind eq "question" ? "Waiting for answer" :
        $kind eq "completed" ? "Task finished" :
        $kind eq "error" ? "Execution error" :
        $tool ne "" ? "Using $tool" : "Working";
    my $state = $kind eq "permission" || $kind eq "question" ? "waiting" : $kind eq "error" ? "error" : $kind eq "completed" ? "completed" : "working";
    my $session_file = "$sessions/$source-$session.json";
    my $state_data = { state => $state, message => $message, timestamp => int($now),
        session_id => $session, agent => $source, cwd => $cwd, project => basename($cwd) };
    my $state_tmp = "$session_file.tmp.$$";
    if (open(my $out, ">", $state_tmp)) {
        print {$out} encode_json($state_data); close $out;
        rename($state_tmp, $session_file) or unlink($state_tmp);
    }
    my %details;
    if (open(my $marker, "<", "$base/detail-capture")) {
        my $line = <$marker> // "";
        if ($line =~ /\A(\d+)\s+(\d+)/ && $now >= $2 && $now - $2 <= 15 && kill(0, $1)) {
            my $error = $input->{error_message} // $input->{error} // $input->{message};
            my $response = $input->{tool_response} // $input->{toolResponse} // $input->{tool_output};
            $error = $response->{stderr} // $response->{error} if !defined($error) && ref($response) eq "HASH";
            my %raw = (task => $input->{prompt}, command => $command,
                error => $error, reply => $input->{last_assistant_message}, question => $input->{message});
            for my $key (keys %raw) {
                my $value = $raw{$key};
                $details{$key} = substr($value, 0, 1000) if defined($value) && !ref($value) && $value ne "";
            }
        }
        close $marker;
    }
    my $event = { id => $id, source => $source, session_id => $session, turn_id => $turn,
        kind => $kind, new_turn => $hook eq "prompt" ? JSON::PP::true : JSON::PP::false,
        at_ms => int($now * 1000), details => \%details };
    my $target = "$events/$id.json";
    my $tmp = "$target.tmp.$$";
    if (open(my $out, ">", $tmp)) {
        print {$out} encode_json($event); close $out;
        rename($tmp, $target) or unlink($tmp);
    }
' "$@"

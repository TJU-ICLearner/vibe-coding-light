import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";

const roots: string[] = [];

function run(agent: "claude" | "codex", script: string, payload: object) {
  const home = mkdtempSync(join(tmpdir(), "vcl-hook-"));
  roots.push(home);
  const result = spawnSync("bash", [resolve(`hooks/${agent}/${script}`)], {
    input: JSON.stringify(payload), encoding: "utf8",
    env: { ...process.env, HOME: home, CLAUDE_CODE_SESSION_ID: "claude-session" },
  });
  expect(result.status).toBe(0);
  const dir = join(home, ".code-light/events");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")));
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("normalizes Cursor, TRAE, Grok Build and DeepSeek Harness hook events", () => {
  const cases = [
    ["cursor", "prompt", { conversation_id: "cursor-1", generation_id: "turn-1", prompt: "private task" }, "working"],
    ["cursor", "error", { conversation_id: "cursor-1", error_message: "private error" }, "error"],
    ["trae", "notification", { session_id: "trae-1", notification_type: "permission_prompt", message: "private question" }, "permission"],
    ["trae", "notification", { session_id: "trae-1", notification_type: "ask_user_question", message: "private question" }, "question"],
    ["grok", "permission", { sessionId: "grok-1" }, "permission"],
    ["grok", "stop", { sessionId: "grok-1" }, "completed"],
    ["deepseek", "prompt", { session_id: "dsh-1", prompt: "private task" }, "working"],
    ["deepseek", "stop", { session_id: "dsh-1", last_assistant_message: "private reply" }, "completed"],
  ] as const;
  for (const [source, hook, payload, expected] of cases) {
    const home = mkdtempSync(join(tmpdir(), "vcl-hook-")); roots.push(home);
    const result = spawnSync("bash", [resolve("hooks/integrations/dispatch.sh"), source, hook], {
      input: JSON.stringify(payload), encoding: "utf8", env: { ...process.env, HOME: home },
    });
    expect(result.status, result.stderr).toBe(0);
    const dir = join(home, ".code-light/events");
    const event = JSON.parse(readFileSync(join(dir, readdirSync(dir)[0]), "utf8"));
    expect(event).toMatchObject({ source, kind: expected });
    expect(JSON.stringify(event)).not.toContain("private");
  }
});

it("does not double count compatibility hooks loaded by Grok or Cursor", () => {
  const home = mkdtempSync(join(tmpdir(), "vcl-hook-")); roots.push(home);
  const input = JSON.stringify({ session_id: "shared-session" });
  const claude = spawnSync("bash", [resolve("hooks/claude/stop.sh")], {
    input, encoding: "utf8", env: { ...process.env, HOME: home, CURSOR_PROJECT_DIR: "/project" },
  });
  expect(claude.status).toBe(0);
  const cursor = spawnSync("bash", [resolve("hooks/integrations/dispatch.sh"), "cursor", "stop"], {
    input, encoding: "utf8", env: { ...process.env, HOME: home, GROK_SESSION_ID: "grok-session" },
  });
  expect(cursor.status).toBe(0);
  expect(existsSync(join(home, ".code-light/events"))).toBe(false);
});

it("generates event IDs when uuidgen is unavailable", () => {
  if (process.platform === "win32") return;
  const home = mkdtempSync(join(tmpdir(), "vcl-hook-")); roots.push(home);
  const bin = join(home, "bin"); mkdirSync(bin);
  const blockedUuidgen = join(bin, "uuidgen");
  writeFileSync(blockedUuidgen, "#!/bin/sh\nexit 127\n"); chmodSync(blockedUuidgen, 0o755);
  for (const agent of ["claude", "codex"] as const) {
    const result = spawnSync("bash", [resolve(`hooks/${agent}/stop.sh`)], {
      input: JSON.stringify({ session_id: `${agent}-session` }), encoding: "utf8",
      env: { ...process.env, HOME: home, PATH: `${bin}${delimiter}${process.env.PATH}` },
    });
    expect(result.status).toBe(0);
  }
  const events = readdirSync(join(home, ".code-light/events"));
  expect(events).toHaveLength(2);
  expect(events.every((name) => /^e-[a-f0-9-]+\.json$/.test(name))).toBe(true);
});

it("records Claude approval and question without prompt text", () => {
  const approval = run("claude", "notification.sh", { session_id: "claude-session", notification_type: "permission_prompt", message: "secret prompt" })[0];
  expect(approval).toMatchObject({ source: "claude", session_id: "claude-session", kind: "permission" });
  expect(JSON.stringify(approval)).not.toContain("secret prompt");
  expect(run("claude", "notification.sh", { session_id: "claude-session", notification_type: "elicitation_dialog", message: "secret prompt" })[0]).toMatchObject({ source: "claude", kind: "question" });
});

it("records Claude completion and explicit tool failure", () => {
  expect(run("claude", "stop.sh", { session_id: "claude-session" })[0].kind).toBe("completed");
  expect(run("claude", "post-tool-use-failure.sh", { session_id: "claude-session", tool_name: "Bash", error: "secret" })[0].kind).toBe("error");
});

it("records only one working transition across repeated Claude tools", () => {
  const home = mkdtempSync(join(tmpdir(), "vcl-hook-")); roots.push(home);
  for (let index = 0; index < 2; index++) {
    const result = spawnSync("bash", [resolve("hooks/claude/pre-tool-use.sh")], {
      input: JSON.stringify({ session_id: "claude-session", tool_name: "Read" }), encoding: "utf8",
      env: { ...process.env, HOME: home, CLAUDE_CODE_SESSION_ID: "claude-session" },
    });
    expect(result.status).toBe(0);
  }
  expect(readdirSync(join(home, ".code-light/events")).length).toBe(1);
});

it("records Codex permission, completion and explicit failure", () => {
  expect(run("codex", "permission_request.sh", { session_id: "codex-session", turn_id: "t1" })[0]).toMatchObject({ source: "codex", kind: "permission", turn_id: "t1" });
  expect(run("codex", "stop.sh", { session_id: "codex-session", turn_id: "t1" })[0].kind).toBe("completed");
  expect(run("codex", "post_tool_use.sh", { session_id: "codex-session", turn_id: "t1", tool_response: { exit_code: 1 } })[0].kind).toBe("error");
});

it("does not call a successful Codex tool an error", () => {
  const events = run("codex", "post_tool_use.sh", { session_id: "codex-session", turn_id: "t1", tool_response: { exit_code: 0 } });
  expect(events.filter((event) => event.kind === "error")).toEqual([]);
});

it("ignores an exit code in Codex tool input when the tool succeeds", () => {
  const events = run("codex", "post_tool_use.sh", { session_id: "codex-session", turn_id: "t1", tool_input: { exit_code: 1 }, tool_response: { exit_code: 0 } });
  expect(events.filter((event) => event.kind === "error")).toEqual([]);
});

it("records prompt transitions for repeated Claude replies and Codex turns", () => {
  for (const agent of ["claude", "codex"] as const) {
    const home = mkdtempSync(join(tmpdir(), "vcl-hook-")); roots.push(home);
    const env = { ...process.env, HOME: home, CLAUDE_CODE_SESSION_ID: "claude-session" };
    const script = agent === "claude" ? "user-prompt-submit.sh" : "user_prompt_submit.sh";
    for (const turn_id of ["t1", "t2"]) {
      const payload = { session_id: `${agent}-session`, turn_id, prompt: "secret" };
      expect(spawnSync("bash", [resolve(`hooks/${agent}/${script}`)], { input: JSON.stringify(payload), encoding: "utf8", env }).status).toBe(0);
      const stop = agent === "claude" ? "stop.sh" : "stop.sh";
      expect(spawnSync("bash", [resolve(`hooks/${agent}/${stop}`)], { input: JSON.stringify(payload), encoding: "utf8", env }).status).toBe(0);
    }
    const events = readdirSync(join(home, ".code-light/events")).map((name) => JSON.parse(readFileSync(join(home, ".code-light/events", name), "utf8")));
    expect(events.filter((item) => item.kind === "working"), `${agent} events: ${JSON.stringify(events)}`).toHaveLength(2);
    expect(events.filter((item) => item.kind === "completed"), `${agent} events: ${JSON.stringify(events)}`).toHaveLength(2);
    expect(JSON.stringify(events)).not.toContain("secret");
  }
});

it("keeps Claude session state separate without an environment session id", () => {
  const home = mkdtempSync(join(tmpdir(), "vcl-hook-")); roots.push(home);
  for (const session_id of ["one", "two"]) {
    const result = spawnSync("bash", [resolve("hooks/claude/pre-tool-use.sh")], {
      input: JSON.stringify({ session_id, tool_name: "Read" }), encoding: "utf8",
      env: { ...process.env, HOME: home, CLAUDE_CODE_SESSION_ID: "" },
    });
    expect(result.status).toBe(0);
  }
  const events = readdirSync(join(home, ".code-light/events")).map((name) => JSON.parse(readFileSync(join(home, ".code-light/events", name), "utf8")));
  expect(events.filter((item) => item.kind === "working"), `Claude events: ${JSON.stringify(events)}`).toHaveLength(2);
});

it("records nested Codex tool errors wherever the failure flag appears", () => {
  for (const tool_response of [
    { content: [{ type: "text", text: "failed" }], isError: true },
    { isError: true, content: [{ type: "text", text: "failed" }] },
  ]) {
    expect(run("codex", "post_tool_use.sh", { session_id: "codex-session", tool_response }).some((item) => item.kind === "error")).toBe(true);
  }
});

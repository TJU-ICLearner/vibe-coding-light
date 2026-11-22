import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TrayPanelApi, TrayPanelState } from "../tray";
import { TrayPanelModel } from "./model";
import { TrayPanel } from "./TrayPanel";
const base: TrayPanelState = {
  appearance: { followSystem: true, manualTheme: "system_light" }, notificationEnabled: true, notificationServiceAvailable: true,
  barkKeySaved: true, barkSendFailed: false, agentHooks: { claude: true, codex: true }, agentSources: { claude: true, codex: true },
  locale: "zh-CN", petVisible: true, togglePetLabel: "隐藏桌宠", petActionLabel: "摸摸", customizePetLabel: "自定义桌宠", notificationSettingsLabel: "通知设置",
  setupClaudeLabel: "设置 Claude 钩子", setupCodexLabel: "设置 Codex 钩子", integrationFeedback: null, sessionsTitle: "当前会话", sessions: ["Codex · 很长的测试项目名称 · 工作中"],
  languageTitle: "语言", chineseLabel: "中文", englishLabel: "英文", loginLabel: "登录时启动", loginEnabled: false, loginAvailable: true,
  autoUpdatesLabel: "自动检查新版本", autoUpdatesEnabled: false, autoUpdatesFailed: false, checkUpdatesLabel: "检查新版本", updateRunning: false, releaseLabel: null, quitLabel: "退出 Vibe Coding Light",
};
function fixture(): TrayPanelApi { return { getState: vi.fn(async () => ({ ...base })), performAction: vi.fn(async () => ({ ...base })), hide: vi.fn(async () => {}) }; }
async function setup(api = fixture()) { const model = new TrayPanelModel(api); await model.init(); render(<TrayPanel model={model} />); return { model, api }; }
beforeEach(() => document.body.replaceChildren()); afterEach(() => cleanup());
describe("BoardUI quick controls", () => {
  it("poll_keeps_language_focus", async () => {
    const api = fixture(); const { model } = await setup(api);
    fireEvent.click(screen.getByRole("tab", { name: "设置" }));
    const trigger = document.querySelector<HTMLElement>("[data-role=language] button")!;
    trigger.focus();
    api.getState = vi.fn(async () => ({ ...base, checkUpdatesLabel: "当前已是最新版本" }));
    await model.refresh();
    expect(document.activeElement).toBe(trigger);
  });
  it("toggle_and_update_keep_panel_open", async () => {
    const api = fixture(); api.performAction = vi.fn(async (action) => ({ ...base, loginEnabled: action === "launch_at_login", updateRunning: action === "check_updates" }));
    await setup(api); fireEvent.click(screen.getByRole("tab", { name: "设置" }));
    fireEvent.click(screen.getByRole("switch", { name: "登录时启动" }));
    await vi.waitFor(() => expect(api.performAction).toHaveBeenCalledWith("launch_at_login"));
    fireEvent.click(screen.getByRole("button", { name: "检查新版本" }));
    await vi.waitFor(() => expect(api.performAction).toHaveBeenCalledWith("check_updates"));
    expect(api.hide).not.toHaveBeenCalled();
  });
  it("failed_action_keeps_last_state", async () => {
    const api = fixture(); const { model } = await setup(api); api.performAction = vi.fn(async () => { throw Error("failed"); });
    await model.performAction("launch_at_login");
    expect(model.getSnapshot().state?.loginEnabled).toBe(false);
    expect(screen.getByRole("alert").textContent).toContain("操作失败");
  });
  it("theme_change_updates_all_windows", async () => {
    const api = fixture(); api.performAction = vi.fn(async (): Promise<TrayPanelState> => ({ ...base, appearance: { followSystem: false, manualTheme: "shaxi" } }));
    await setup(api); fireEvent.click(screen.getByRole("tab", { name: "设置" }));
    fireEvent.click(screen.getByRole("button", { name: "社戏" }));
    await vi.waitFor(() => expect(document.documentElement.dataset.theme).toBe("shaxi"));
  });
  it("escape_hides_panel", async () => {
    const { api } = await setup(); fireEvent.keyDown(document, { key: "Escape" });
    await vi.waitFor(() => expect(api.hide).toHaveBeenCalledTimes(1));
  });
  it("three_tabs_remain_reachable", async () => {
    await setup();
    for (const name of ["概览", "Agent 接入", "设置"]) { fireEvent.click(screen.getByRole("tab", { name })); await vi.waitFor(() => expect(screen.getByRole("tab", { name }).getAttribute("aria-selected")).toBe("true")); }
  });
  it("offers a retry when the initial panel read fails", async () => {
    const api = fixture();
    api.getState = vi.fn().mockRejectedValueOnce(Error("offline")).mockResolvedValue(base);
    const { model } = await setup(api);
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await vi.waitFor(() => expect(model.getSnapshot().state?.sessions[0]).toContain("Codex"));
  });
});

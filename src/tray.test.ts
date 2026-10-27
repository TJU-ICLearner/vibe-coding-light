import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrayPanelController, type TrayPanelApi, type TrayPanelState } from "./tray";

const base: TrayPanelState = {
  locale: "zh-CN", petVisible: true, togglePetLabel: "隐藏桌宠", petActionLabel: "摸摸", customizePetLabel: "自定义桌宠", notificationSettingsLabel: "通知设置",
  setupClaudeLabel: "设置 Claude 钩子", setupCodexLabel: "设置 Codex 钩子", sessionsTitle: "当前会话", sessions: ["Codex · 测试项目 · 工作中"],
  languageTitle: "语言", chineseLabel: "中文", englishLabel: "英文", loginLabel: "登录时启动", loginEnabled: false, loginAvailable: true,
  autoUpdatesLabel: "自动检查新版本", autoUpdatesEnabled: false, autoUpdatesFailed: false,
  checkUpdatesLabel: "检查新版本", updateRunning: false, releaseLabel: null, quitLabel: "退出 Vibe Coding Light",
};

function setup() {
  const root = document.createElement("main"); document.body.replaceChildren(root);
  const api: TrayPanelApi = {
    getState: vi.fn(async () => ({ ...base })),
    performAction: vi.fn(async (action) => ({ ...base, loginEnabled: action === "launch_at_login", updateRunning: action === "check_updates" })),
    hide: vi.fn(async () => {}),
  };
  return { root, api, controller: new TrayPanelController(root, api) };
}

beforeEach(() => document.body.replaceChildren());

describe("persistent tray panel", () => {
  it("shows the existing tray actions and session summary", async () => {
    const { root, controller } = setup();
    await controller.init();
    expect(root.textContent).toContain("当前会话");
    expect(root.textContent).toContain("Codex · 测试项目");
    for (const action of ["toggle_pet", "pet_action", "customize_pet", "notification_settings", "setup_claude", "setup_codex", "launch_at_login", "auto_updates", "check_updates", "quit"]) {
      expect(root.querySelector(`[data-action="${action}"]`)).not.toBeNull();
    }
  });

  it("keeps controls visible after switching login startup and checking updates", async () => {
    const { root, api, controller } = setup();
    await controller.init();
    root.querySelector<HTMLInputElement>('[data-action="launch_at_login"]')!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.performAction).toHaveBeenCalledWith("launch_at_login");
    expect(root.querySelector<HTMLInputElement>('[data-action="launch_at_login"]')?.checked).toBe(true);
    root.querySelector<HTMLButtonElement>('[data-action="check_updates"]')!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.performAction).toHaveBeenCalledWith("check_updates");
    expect(root.querySelector<HTMLButtonElement>('[data-action="check_updates"]')?.disabled).toBe(true);
    expect(api.hide).not.toHaveBeenCalled();
  });

  it("updates every label after changing language", async () => {
    const { root, api, controller } = setup();
    (api.performAction as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ...base, locale: "en", loginLabel: "Launch at login", autoUpdatesLabel: "Automatically check for updates", checkUpdatesLabel: "Check for updates", languageTitle: "Language", chineseLabel: "Chinese", englishLabel: "English" });
    await controller.init();
    const select = root.querySelector<HTMLSelectElement>('[data-role="language"]')!;
    select.value = "en"; select.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.textContent).toContain("Launch at login");
    expect(root.textContent).toContain("Automatically check for updates");
    expect(root.querySelector('[data-role="language"]')?.getAttribute("aria-label")).toBe("Language");
  });

  it("reports a language save failure without claiming the language changed", async () => {
    const { root, api, controller } = setup();
    (api.performAction as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("disk error"));
    await controller.init();
    const select = root.querySelector<HTMLSelectElement>('[data-role="language"]')!;
    select.value = "en"; select.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.querySelector<HTMLSelectElement>('[data-role="language"]')?.value).toBe("zh-CN");
    expect(root.querySelector('[role="alert"]')?.textContent).toContain("操作失败");
  });

  it("hides on Escape", async () => {
    const { api, controller } = setup();
    await controller.init();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(api.hide).toHaveBeenCalledTimes(1);
  });

  it("preserves keyboard focus during unchanged polling and action updates", async () => {
    const { root, controller } = setup();
    await controller.init();
    const button = root.querySelector<HTMLButtonElement>('[data-action="check_updates"]')!;
    button.focus();
    await controller.refresh();
    expect(root.querySelector('[data-action="check_updates"]')).toBe(button);
    expect(document.activeElement).toBe(button);
    const toggle = root.querySelector<HTMLInputElement>('[data-action="launch_at_login"]')!;
    toggle.focus();
    toggle.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((document.activeElement as HTMLElement)?.dataset.action).toBe("launch_at_login");
  });

  it("does not replace an open language control during a status refresh", async () => {
    const { root, api, controller } = setup();
    (api.getState as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ...base })
      .mockResolvedValueOnce({ ...base, checkUpdatesLabel: "当前已是最新版本" });
    await controller.init();
    const select = root.querySelector<HTMLSelectElement>('[data-role="language"]')!;
    select.focus();
    await controller.refresh();
    expect(root.querySelector('[data-role="language"]')).toBe(select);
    select.blur();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.textContent).toContain("当前已是最新版本");
  });
});

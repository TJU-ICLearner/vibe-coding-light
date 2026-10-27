import { describe, expect, it, vi, beforeEach } from "vitest";
import { NotificationSettingsController, type NotificationApi, type NotificationSettings, type NotificationStatus, type SimulatedTestResult } from "./notifications";

const defaults: NotificationSettings = {
  enabled: false,
  sources: { claude: true, codex: true },
  events: { permission: true, question: true, completed: true, error: true },
  quota: { at80: false, at50: false, at20: false, at0: false, recovered: false },
  include_details: false,
  templates: {},
  quiet_hours: { enabled: false, start_minute: 1320, end_minute: 480, bypass: { permission: true, question: true, completed: false, error: true, quota: false } },
};
const status: NotificationStatus = { serviceAvailable: true, keySaved: false, claudeHooksInstalled: false, codexHooksInstalled: false, claudeQuotaAvailable: false, codexQuotaAvailable: false, testConsoleAvailable: false, lastSendError: null };

function setup() {
  const root = document.createElement("main"); document.body.replaceChildren(root);
  const sendSimulated = vi.fn<NotificationApi["sendSimulated"]>(async () => ({ outcome: "sent", reason: null }));
  const api: NotificationApi = {
    getSettings: vi.fn(async () => structuredClone(defaults)),
    setSettings: vi.fn(async (settings) => settings),
    getStatus: vi.fn(async () => structuredClone(status)),
    getDiagnostics: vi.fn(async () => []), clearDiagnostics: vi.fn(async () => {}),
    saveKey: vi.fn(async () => {}), deleteKey: vi.fn(async () => {}), sendTest: vi.fn(async () => {}), sendSimulated,
  };
  const controller = new NotificationSettingsController(root, api);
  return { root, api, controller, sendSimulated };
}

beforeEach(() => document.body.replaceChildren());

describe("notification settings window", () => {
  it("renders nine RC test buttons", async () => {
    const { root, api, controller } = setup();
    (api.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ ...status, testConsoleAvailable: true });
    await controller.init("zh-CN");
    expect(root.querySelectorAll('button[data-action="simulate-event"]')).toHaveLength(9);
    expect(root.textContent).toContain("仅 RC 测试");
  });

  it("sends selected source and period", async () => {
    const { root, api, controller, sendSimulated } = setup();
    (api.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ ...status, testConsoleAvailable: true, keySaved: true });
    await controller.init("zh-CN");
    const source = root.querySelector<HTMLSelectElement>("#test-source")!;
    source.value = "claude"; source.dispatchEvent(new Event("change", { bubbles: true }));
    const period = root.querySelector<HTMLSelectElement>("#test-period")!;
    period.value = "10080"; period.dispatchEvent(new Event("change", { bubbles: true }));
    root.querySelector<HTMLButtonElement>('button[data-event="quota20"]')!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendSimulated).toHaveBeenCalledWith({ source: "claude", event: "quota20", duration_mins: 10080 });
    expect(root.querySelector('[data-test-feedback="quota20"]')?.textContent).toContain("已提交给 Bark");
  });

  it("shows skipped and Bark failure reasons", async () => {
    const { root, api, controller, sendSimulated } = setup();
    (api.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ ...status, testConsoleAvailable: true, keySaved: true });
    sendSimulated.mockResolvedValueOnce({ outcome: "skipped", reason: "quiet_hours" });
    await controller.init("zh-CN");
    root.querySelector<HTMLButtonElement>('button[data-event="completed"]')!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.querySelector('[data-test-feedback="completed"]')?.textContent).toContain("免打扰");
    controller.setLocale("en");
    expect(root.querySelector('[data-test-feedback="completed"]')?.textContent).toContain("Quiet hours");
    sendSimulated.mockRejectedValueOnce("Bark send failed: Rejected");
    root.querySelector<HTMLButtonElement>('button[data-event="error"]')!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.querySelector('[data-test-feedback="error"]')?.textContent).toContain("Bark rejected");
    expect(root.querySelector('[data-test-feedback="completed"]')?.textContent).toContain("Quiet hours");
    const source = root.querySelector<HTMLSelectElement>("#test-source")!;
    source.value = "claude"; source.dispatchEvent(new Event("change", { bubbles: true }));
    expect(root.querySelector('[data-test-feedback="error"]')).toBeNull();
  });

  it("prevents duplicate clicks during simulated send", async () => {
    const { root, api, controller, sendSimulated } = setup();
    (api.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ ...status, testConsoleAvailable: true, keySaved: true });
    let finish!: (value: SimulatedTestResult) => void;
    sendSimulated.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await controller.init("zh-CN");
    const button = root.querySelector<HTMLButtonElement>('button[data-event="permission"]')!;
    button.click(); button.click();
    await Promise.resolve();
    expect(sendSimulated).toHaveBeenCalledTimes(1);
    expect(root.querySelector<HTMLButtonElement>('button[data-event="permission"]')!.disabled).toBe(true);
    finish({ outcome: "sent", reason: null });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("waits for pending settings save before simulated send", async () => {
    const { root, api, controller, sendSimulated } = setup();
    (api.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ ...status, testConsoleAvailable: true, keySaved: true });
    let finishSave!: () => void;
    (api.setSettings as ReturnType<typeof vi.fn>).mockImplementationOnce(() => new Promise((resolve) => { finishSave = () => resolve(structuredClone(defaults)); }));
    await controller.init("zh-CN");
    const enabled = root.querySelector<HTMLInputElement>('input[data-path="enabled"]')!;
    enabled.checked = true; enabled.dispatchEvent(new Event("change", { bubbles: true }));
    root.querySelector<HTMLButtonElement>('button[data-event="permission"]')!.click();
    await Promise.resolve();
    expect(sendSimulated).not.toHaveBeenCalled();
    finishSave();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendSimulated).toHaveBeenCalledTimes(1);
  });

  it("does not simulate after a settings save fails", async () => {
    const { root, api, controller, sendSimulated } = setup();
    (api.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ ...status, testConsoleAvailable: true, keySaved: true });
    (api.setSettings as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("disk error"));
    await controller.init("en");
    const enabled = root.querySelector<HTMLInputElement>('input[data-path="enabled"]')!;
    enabled.checked = true; enabled.dispatchEvent(new Event("change", { bubbles: true }));
    root.querySelector<HTMLButtonElement>('button[data-event="permission"]')!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendSimulated).not.toHaveBeenCalled();
    expect(root.querySelector('[data-test-feedback="permission"]')?.textContent).toContain("save");
  });

  it("hides console in stable builds", async () => {
    const { root, controller } = setup();
    await controller.init("zh-CN");
    expect(root.querySelector('button[data-action="simulate-event"]')).toBeNull();
  });

  it("renders every control and opt-in defaults", async () => {
    const { root, controller } = setup(); await controller.init("zh-CN");
    for (const path of ["enabled","sources.claude","sources.codex","events.permission","events.question","events.completed","events.error","quota.at80","quota.at50","quota.at20","quota.at0","quota.recovered"]) {
      expect(root.querySelector<HTMLInputElement>(`[data-path="${path}"]`)).not.toBeNull();
    }
    expect(root.querySelector<HTMLInputElement>('[data-path="enabled"]')!.checked).toBe(false);
    expect(root.querySelector<HTMLInputElement>('[data-path="sources.claude"]')!.checked).toBe(true);
    expect(root.querySelector<HTMLInputElement>('[data-path="quota.at20"]')!.checked).toBe(false);
    expect(root.querySelector<HTMLButtonElement>("#send-test")!.disabled).toBe(true);
  });

  it("sends exact independent settings shape for source event and threshold switches", async () => {
    const { root, api, controller } = setup(); await controller.init("en");
    for (const path of ["enabled", "sources.codex", "events.question", "quota.at20"]) {
      const input = root.querySelector<HTMLInputElement>(`[data-path="${path}"]`)!;
      input.checked = !input.checked; input.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(api.setSettings).toHaveBeenLastCalledWith({ ...defaults, enabled: true, sources: { claude: true, codex: false }, events: { ...defaults.events, question: false }, quota: { ...defaults.quota, at20: true } });
  });

  it("keeps master off when a second switch changes before the first save completes", async () => {
    const { root, api, controller } = setup();
    (api.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({ ...structuredClone(defaults), enabled: true });
    const pending: Array<{ value: NotificationSettings; resolve: (value: NotificationSettings) => void }> = [];
    (api.setSettings as ReturnType<typeof vi.fn>).mockImplementation((value: NotificationSettings) => new Promise((resolve) => pending.push({ value, resolve })));
    await controller.init("en");
    const master = root.querySelector<HTMLInputElement>('[data-path="enabled"]')!;
    master.checked = false; master.dispatchEvent(new Event("change", { bubbles: true }));
    const quota = root.querySelector<HTMLInputElement>('[data-path="quota.at20"]')!;
    quota.checked = true; quota.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
    expect(pending[0].value.enabled).toBe(false);
    pending[0].resolve(pending[0].value);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pending[1].value).toMatchObject({ enabled: false, quota: { at20: true } });
    pending[1].resolve(pending[1].value);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.querySelector<HTMLInputElement>('[data-path="enabled"]')!.checked).toBe(false);
  });

  it("masks saved key, clears input, and never receives secret from status", async () => {
    const { root, api, controller } = setup(); await controller.init("en");
    const key = root.querySelector<HTMLInputElement>("#bark-key")!;
    expect(key.type).toBe("password"); key.value = "secret-device-key";
    root.querySelector<HTMLButtonElement>("#save-key")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.saveKey).toHaveBeenCalledWith("secret-device-key");
    expect(root.textContent).not.toContain("secret-device-key");
    expect(root.querySelector<HTMLInputElement>("#bark-key")!.value).toBe("");
  });

  it("explains that copied Bark test paths cannot be saved as device keys", async () => {
    const { root, api, controller } = setup(); await controller.init("zh-CN");
    (api.saveKey as ReturnType<typeof vi.fn>).mockRejectedValue("Invalid Bark device key");
    root.querySelector<HTMLInputElement>("#bark-key")!.value = "abc123/title/body?group=example";
    root.querySelector<HTMLButtonElement>("#save-key")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.querySelector(".connection #feedback")?.textContent).toContain("只填写设备密钥");
    expect(root.textContent).not.toContain("abc123");
  });

  it("identifies a previously saved malformed device key before testing", async () => {
    const { root, api, controller } = setup();
    (api.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({ ...structuredClone(defaults), enabled: true });
    (api.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ ...status, keySaved: true });
    (api.sendTest as ReturnType<typeof vi.fn>).mockRejectedValue("Invalid Bark device key");
    await controller.init("en");
    root.querySelector<HTMLButtonElement>("#send-test")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.querySelector(".connection #feedback")?.textContent).toContain("device key only");
  });

  it("shows sending and result beside the test button without scrolling", async () => {
    const { root, api, controller } = setup();
    (api.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({ ...structuredClone(defaults), enabled: true });
    (api.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ ...status, keySaved: true });
    let finish!: () => void;
    (api.sendTest as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    await controller.init("zh-CN");

    root.querySelector<HTMLButtonElement>("#send-test")!.click();
    expect(api.sendTest).toHaveBeenCalledTimes(1);
    expect(root.querySelector(".connection #feedback")?.textContent).toContain("正在发送");
    expect(root.querySelector<HTMLButtonElement>("#send-test")!.disabled).toBe(true);

    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.querySelector(".connection #feedback")?.textContent).toContain("已提交给 Bark");
    expect(root.querySelector<HTMLButtonElement>("#send-test")!.disabled).toBe(false);
  });

  it("explains why the test button is disabled", async () => {
    const { root, controller } = setup(); await controller.init("zh-CN");
    expect(root.querySelector(".connection")?.textContent).toContain("开启手表通知");
    expect(root.querySelector(".connection")?.textContent).toContain("保存 Bark 密钥");
  });

  it("shows a rejected Bark key without exposing the saved secret", async () => {
    const { root, api, controller } = setup();
    (api.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({ ...structuredClone(defaults), enabled: true });
    (api.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ ...status, keySaved: true });
    (api.sendTest as ReturnType<typeof vi.fn>).mockRejectedValue("Bark send failed: Rejected");
    await controller.init("zh-CN");
    root.querySelector<HTMLButtonElement>("#send-test")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.querySelector(".connection #feedback")?.textContent).toContain("Bark 拒绝");
    expect(root.textContent).not.toContain("Rejected");
  });

  it("fully localizes visible copy and Codex question coverage, including status errors", async () => {
    const { root, controller } = setup(); await controller.init("zh-CN");
    expect(root.textContent).toContain("Codex 的部分界面内提问");
    controller.setStatus({ ...status, lastSendError: "Bark send failed: Unsent" });
    expect(root.textContent).toContain("无法连接 Bark");
    controller.setLocale("en");
    expect(root.textContent).toContain("Some questions inside Codex");
    expect(root.textContent).toContain("Could not connect to Bark");
    expect(root.textContent).not.toContain("无法连接 Bark");
    expect(document.documentElement.lang).toBe("en");
  });

  it("shows unavailable quota without invented percentage", async () => {
    const { root, controller } = setup(); await controller.init("zh-CN");
    expect(root.querySelector("#claude-quota-status")!.textContent).toContain("暂不可用");
    expect(root.querySelector("#codex-quota-status")!.textContent).toContain("暂不可用");
    expect(root.querySelector("#claude-quota-status")!.textContent).not.toContain("%");
  });

  it("keeps detailed content off until opted in and saves per-event title and body", async () => {
    const { root, api, controller } = setup(); await controller.init("zh-CN");
    const details = root.querySelector<HTMLInputElement>('[data-path="include_details"]')!;
    expect(details.checked).toBe(false);
    details.checked = true;
    details.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const title = root.querySelector<HTMLInputElement>('[data-template-field="title"]')!;
    const body = root.querySelector<HTMLTextAreaElement>('[data-template-field="body"]')!;
    title.value = "{source} 需要帮忙";
    title.dispatchEvent(new Event("change", { bubbles: true }));
    body.value = "请批准：{command}";
    body.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.setSettings).toHaveBeenLastCalledWith(expect.objectContaining({
      include_details: true,
      templates: { "zh-CN.permission": { title: "{source} 需要帮忙", body: "请批准：{command}" } },
    }));
    expect(root.querySelector("#template-preview")?.textContent).toContain("请批准：");
    controller.setLocale("en");
    expect(root.querySelector<HTMLInputElement>('[data-template-field="title"]')?.value).toBe("");
  });

  it("renders a saved template as text rather than executable HTML", async () => {
    const { root, api, controller } = setup();
    (api.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...structuredClone(defaults),
      templates: { "zh-CN.permission": { title: '<img src=x onerror=alert(1)>', body: "请批准 {command}" } },
    });
    await controller.init("zh-CN");
    expect(root.querySelector('[data-template-field="title"]')).not.toBeNull();
    expect(root.querySelector<HTMLInputElement>('[data-template-field="title"]')?.value).toBe('<img src=x onerror=alert(1)>');
    expect(root.querySelector(".templates img")).toBeNull();
  });

  it("preserves an unsaved template draft and cursor across status refreshes", async () => {
    const { root, controller } = setup(); await controller.init("zh-CN");
    const body = root.querySelector<HTMLTextAreaElement>('[data-template-field="body"]')!;
    body.focus();
    body.value = "等待批准：{command}";
    body.setSelectionRange(4, 4);
    body.dispatchEvent(new Event("input", { bubbles: true }));
    controller.setStatus({ ...status, keySaved: true });
    const restored = root.querySelector<HTMLTextAreaElement>('[data-template-field="body"]')!;
    expect(restored.value).toBe("等待批准：{command}");
    expect(document.activeElement).toBe(restored);
    expect(restored.selectionStart).toBe(4);
  });

  it("explains when the optional notification service cannot start", async () => {
    const { root, controller } = setup(); await controller.init("zh-CN");
    controller.setStatus({ ...status, serviceAvailable: false });
    expect(root.textContent).toContain("通知服务暂不可用");
    controller.setLocale("en");
    expect(root.textContent).toContain("Notification service is unavailable");
  });

  it("shows localized delivery diagnostics and lets the user clear them", async () => {
    const { root, api, controller } = setup();
    (api.getDiagnostics as ReturnType<typeof vi.fn>).mockResolvedValue([{
      atMs: 1_800_000_000_000, source: "codex", kind: "error", outcome: "failed", reason: "network",
    }]);
    await controller.init("zh-CN");
    expect(root.querySelector(".diagnostics")?.textContent).toContain("Codex");
    expect(root.querySelector(".diagnostics")?.textContent).toContain("网络");
    root.querySelector<HTMLButtonElement>('[data-action="clear-diagnostics"]')!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.clearDiagnostics).toHaveBeenCalledTimes(1);
    expect(root.querySelector(".diagnostics")?.textContent).toContain("暂无记录");
    controller.setLocale("en");
    expect(root.querySelector(".diagnostics")?.textContent).toContain("No recent records");
  });

  it("renders malformed diagnostic text without creating HTML", async () => {
    const { root, api, controller } = setup();
    (api.getDiagnostics as ReturnType<typeof vi.fn>).mockResolvedValue([{
      atMs: 1_800_000_000_000, source: "codex", kind: '<img src=x onerror=alert(1)>', outcome: "observed", reason: null,
    }]);
    await controller.init("en");
    expect(root.querySelector(".diagnostics img")).toBeNull();
    expect(root.querySelector(".diagnostics")?.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("configures quiet hours and selected bypass events in both languages", async () => {
    const { root, api, controller } = setup(); await controller.init("zh-CN");
    const enabled = root.querySelector<HTMLInputElement>('[data-path="quiet_hours.enabled"]')!;
    expect(enabled.checked).toBe(false);
    expect(root.querySelector<HTMLInputElement>('[data-path="quiet_hours.start_minute"]')?.value).toBe("22:00");
    expect(root.querySelector<HTMLInputElement>('[data-path="quiet_hours.end_minute"]')?.value).toBe("08:00");
    enabled.checked = true; enabled.dispatchEvent(new Event("change", { bubbles: true }));
    const completed = root.querySelector<HTMLInputElement>('[data-path="quiet_hours.bypass.completed"]')!;
    completed.checked = true; completed.dispatchEvent(new Event("change", { bubbles: true }));
    const start = root.querySelector<HTMLInputElement>('[data-path="quiet_hours.start_minute"]')!;
    start.value = "23:30"; start.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.setSettings).toHaveBeenLastCalledWith(expect.objectContaining({
      quiet_hours: { enabled: true, start_minute: 1410, end_minute: 480, bypass: { permission: true, question: true, completed: true, error: true, quota: false } },
    }));
    controller.setLocale("en");
    expect(root.querySelector(".quiet-hours")?.textContent).toContain("Quiet hours");
  });
});

import { describe, expect, it, vi, beforeEach } from "vitest";
import { NotificationSettingsController, type NotificationApi, type NotificationSettings, type NotificationStatus } from "./notifications";

const defaults: NotificationSettings = {
  enabled: false,
  sources: { claude: true, codex: true },
  events: { permission: true, question: true, completed: true, error: true },
  quota: { at80: false, at50: false, at20: false, at0: false, recovered: false },
};
const status: NotificationStatus = { serviceAvailable: true, keySaved: false, claudeHooksInstalled: false, codexHooksInstalled: false, claudeQuotaAvailable: false, codexQuotaAvailable: false, lastSendError: null };

function setup() {
  const root = document.createElement("main"); document.body.replaceChildren(root);
  const api: NotificationApi = {
    getSettings: vi.fn(async () => structuredClone(defaults)),
    setSettings: vi.fn(async (settings) => settings),
    getStatus: vi.fn(async () => structuredClone(status)),
    saveKey: vi.fn(async () => {}), deleteKey: vi.fn(async () => {}), sendTest: vi.fn(async () => {}),
  };
  const controller = new NotificationSettingsController(root, api);
  return { root, api, controller };
}

beforeEach(() => document.body.replaceChildren());

describe("notification settings window", () => {
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

  it("explains when the optional notification service cannot start", async () => {
    const { root, controller } = setup(); await controller.init("zh-CN");
    controller.setStatus({ ...status, serviceAvailable: false });
    expect(root.textContent).toContain("通知服务暂不可用");
    controller.setLocale("en");
    expect(root.textContent).toContain("Notification service is unavailable");
  });
});

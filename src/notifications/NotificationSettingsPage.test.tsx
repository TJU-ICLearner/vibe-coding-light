import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { NotificationApi, NotificationSettings, NotificationStatus } from "./api";
import { NotificationSettingsModel } from "./model";
import { NotificationSettingsPage } from "./NotificationSettingsPage";
const settings: NotificationSettings = {
  enabled: true, sources: { claude: true, codex: true, cursor: false, trae: false, grok: false, deepseek: false },
  events: { permission: true, question: true, completed: true, error: true },
  quota: { at80: true, at50: true, at20: true, at0: true, at_week0: true, recovered: true },
  include_details: true, templates: {},
  quiet_hours: { enabled: false, start_minute: 1320, end_minute: 480, bypass: { permission: true, question: true, completed: false, error: true, quota: false } },
};
const status: NotificationStatus = { serviceAvailable: true, keySaved: false, claudeHooksInstalled: true, codexHooksInstalled: true, cursorHooksInstalled: false, traeHooksInstalled: false, grokHooksInstalled: false, deepseekHooksPrepared: false, claudeQuotaAvailable: true, codexQuotaAvailable: true, testConsoleAvailable: false, lastSendError: null };
function fixture(): NotificationApi { return {
  getSettings: vi.fn(async () => structuredClone(settings)), setSettings: vi.fn(async (next) => next),
  getStatus: vi.fn(async () => structuredClone(status)), getDiagnostics: vi.fn(async () => []), clearDiagnostics: vi.fn(async () => {}),
  saveKey: vi.fn(async () => {}), deleteKey: vi.fn(async () => {}), installHooks: vi.fn(async () => {}),
}; }
beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe("BoardUI notification settings", () => {
  it("preserves_key_input_during_status_and_locale_change", async () => {
    const model = new NotificationSettingsModel(fixture()); await model.init("en"); render(<NotificationSettingsPage model={model} />);
    const input = screen.getByLabelText("Bark device key") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "local draft" } }); input.focus(); input.setSelectionRange(2, 5);
    model.setStatus(status); model.setLocale("zh-CN");
    await vi.waitFor(() => expect(screen.getByLabelText("Bark 设备密钥")).toBe(input));
    expect(input.value).toBe("local draft"); expect(document.activeElement).toBe(input); expect(input.selectionStart).toBe(2);
  });
  it("keeps_period_and_quiet_controls_distinct", async () => {
    const api = fixture(); const model = new NotificationSettingsModel(api); await model.init("en"); render(<NotificationSettingsPage model={model} />);
    fireEvent.click(screen.getByRole("switch", { name: "7-day quota exhausted" }));
    await vi.waitFor(() => expect(model.getSnapshot().settings?.quota.at_week0).toBe(false));
    expect(model.getSnapshot().settings?.quota.at0).toBe(true);
    fireEvent.click(screen.getByRole("switch", { name: "Enable quiet hours" }));
    await vi.waitFor(() => expect(model.getSnapshot().settings?.quiet_hours.enabled).toBe(true));
    expect(api.setSettings).toHaveBeenCalled();
  });
  it("keeps controls editable when status is unavailable", async () => {
    const api = fixture(); api.getStatus = vi.fn(async () => { throw Error("offline"); });
    const model = new NotificationSettingsModel(api); await model.init("en"); render(<NotificationSettingsPage model={model} />);
    await vi.waitFor(() => expect(screen.getAllByText("Status unavailable").length).toBeGreaterThan(0));
    expect(screen.getByRole("switch", { name: "Watch notifications" })).toBeTruthy();
    expect(screen.queryByText("No key saved")).toBeNull();
  });
});

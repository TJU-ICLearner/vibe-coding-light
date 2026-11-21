import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationApi, NotificationSettings, NotificationStatus } from "../notifications";
import { NotificationSettingsModel } from "./model";

const settings: NotificationSettings = {
  enabled: true,
  sources: { claude: true, codex: true, cursor: false, trae: false, grok: false, deepseek: false },
  events: { permission: true, question: true, completed: true, error: true },
  quota: { at80: true, at50: true, at20: true, at0: true, at_week0: true, recovered: true },
  include_details: true, templates: {},
  quiet_hours: { enabled: false, start_minute: 1320, end_minute: 480, bypass: { permission: true, question: true, completed: false, error: true, quota: false } },
};
const status: NotificationStatus = { serviceAvailable: true, keySaved: true, claudeHooksInstalled: true, codexHooksInstalled: true, cursorHooksInstalled: false, traeHooksInstalled: false, grokHooksInstalled: false, deepseekHooksPrepared: false, claudeQuotaAvailable: true, codexQuotaAvailable: true, testConsoleAvailable: false, lastSendError: null };
function fixture(): NotificationApi {
  return {
    getSettings: vi.fn(async () => structuredClone(settings)), setSettings: vi.fn(async (next) => next),
    getStatus: vi.fn(async () => structuredClone(status)), getDiagnostics: vi.fn(async () => []),
    clearDiagnostics: vi.fn(async () => {}), saveKey: vi.fn(async () => {}), deleteKey: vi.fn(async () => {}), installHooks: vi.fn(async () => {}),
  };
}
beforeEach(() => localStorage.clear());

describe("headless notification settings", () => {
  it("settings_render_while_status_hangs", async () => {
    const api = fixture(); api.getStatus = vi.fn(() => new Promise<NotificationStatus>(() => {}));
    const model = new NotificationSettingsModel(api);
    await model.init("en");
    expect(model.getSnapshot().settings?.enabled).toBe(true);
    expect(model.getSnapshot().statusLoading).toBe(true);
    await model.setPath("quota.at_week0", false);
    expect(model.getSnapshot().settings?.quota.at_week0).toBe(false);
  });
  it("diagnostics_failure_is_local", async () => {
    const api = fixture(); api.getDiagnostics = vi.fn(async () => { throw Error("offline"); });
    const model = new NotificationSettingsModel(api);
    await model.init("en");
    expect(model.getSnapshot().settings?.enabled).toBe(true);
    expect(model.getSnapshot().status?.keySaved).toBe(true);
    expect(model.getSnapshot().diagnosticsRefreshFailed).toBe(true);
  });
  it("draft_recovers_after_restart", async () => {
    const first = new NotificationSettingsModel(fixture()); await first.init("en");
    first.editTemplate("permission", "title", "Approve {command}");
    first.dispose();
    const api = fixture(); const second = new NotificationSettingsModel(api); await second.init("en");
    expect(second.getTemplate("permission").title).toBe("Approve {command}");
    await vi.waitFor(() => expect(api.setSettings).toHaveBeenCalled());
  });
  it("later_event_edit_survives_prior_save", async () => {
    const api = fixture(); let finishFirst!: (value: NotificationSettings) => void;
    api.setSettings = vi.fn().mockImplementationOnce((next) => new Promise((resolve) => { finishFirst = () => resolve(next); })).mockImplementation(async (next) => next);
    const model = new NotificationSettingsModel(api); await model.init("en");
    model.editTemplate("permission", "title", "First");
    const first = model.flushTemplates();
    await vi.waitFor(() => expect(api.setSettings).toHaveBeenCalledTimes(1));
    model.editTemplate("completed", "body", "Second");
    const second = model.flushTemplates();
    finishFirst(structuredClone(settings));
    await Promise.all([first, second]);
    expect(model.getSnapshot().settings?.templates["en.permission"]?.title).toBe("First");
    expect(model.getSnapshot().settings?.templates["en.completed"]?.body).toBe("Second");
  });
  it("reports successful key and Hook writes before a failed status refresh", async () => {
    const api = fixture();
    const read = vi.fn().mockResolvedValueOnce(status).mockRejectedValueOnce(Error("offline")).mockRejectedValueOnce(Error("offline"));
    api.getStatus = read;
    const model = new NotificationSettingsModel(api);
    await model.init("en");
    await vi.waitFor(() => expect(model.getSnapshot().status?.serviceAvailable).toBe(true));
    expect(await model.saveKey("key" )).toBe(true);
    expect(model.getSnapshot().feedback).toBe("keySavedRefreshFailed");
    expect(model.getSnapshot().status?.keySaved).toBe(true);
    await model.installHook("cursor", "Installed", "Refresh failed", "Install failed");
    expect(model.getSnapshot().installFeedback).toContain("Installed");
    expect(model.getSnapshot().installFeedback).toContain("Refresh failed");
    expect(model.getSnapshot().status?.cursorHooksInstalled).toBe(true);
  });
});

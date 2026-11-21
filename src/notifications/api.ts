import { invoke } from "@tauri-apps/api/core";

export interface NotificationSettings {
  enabled: boolean;
  sources: { claude: boolean; codex: boolean; cursor: boolean; trae: boolean; grok: boolean; deepseek: boolean };
  events: { permission: boolean; question: boolean; completed: boolean; error: boolean };
  quota: { at80: boolean; at50: boolean; at20: boolean; at0: boolean; at_week0: boolean; recovered: boolean };
  include_details: boolean;
  templates: Record<string, { title: string; body: string }>;
  quiet_hours: { enabled: boolean; start_minute: number; end_minute: number; bypass: { permission: boolean; question: boolean; completed: boolean; error: boolean; quota: boolean } };
}
export interface NotificationStatus {
  serviceAvailable: boolean; keySaved: boolean; claudeHooksInstalled: boolean; codexHooksInstalled: boolean;
  cursorHooksInstalled: boolean; traeHooksInstalled: boolean; grokHooksInstalled: boolean; deepseekHooksPrepared: boolean;
  claudeQuotaAvailable: boolean; codexQuotaAvailable: boolean; testConsoleAvailable: boolean; lastSendError: string | null;
}
export interface DiagnosticEntry {
  atMs: number;
  source: "claude" | "codex" | "cursor" | "trae" | "grok" | "deepseek" | null;
  kind: string;
  outcome: "observed" | "deferred" | "sent" | "skipped" | "failed";
  reason: string | null;
}
export interface NotificationApi {
  getSettings(): Promise<NotificationSettings>;
  setSettings(settings: NotificationSettings): Promise<NotificationSettings>;
  getStatus(): Promise<NotificationStatus>;
  getDiagnostics(): Promise<DiagnosticEntry[]>;
  clearDiagnostics(): Promise<void>;
  saveKey(key: string): Promise<void>;
  deleteKey(): Promise<void>;
  installHooks(source: string): Promise<void>;
}

export const notificationApi: NotificationApi = {
  getSettings: () => invoke("get_notification_settings"),
  setSettings: (settings) => invoke("set_notification_settings", { settings }),
  getStatus: () => invoke("get_notification_status"),
  getDiagnostics: () => invoke("get_notification_diagnostics"),
  clearDiagnostics: () => invoke("clear_notification_diagnostics"),
  saveKey: (key) => invoke("save_bark_key", { key }),
  deleteKey: () => invoke("delete_bark_key"),
  installHooks: (source) => invoke("install_integration_hook", { source }),
};


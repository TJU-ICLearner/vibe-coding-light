import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { notificationCopy, type NotificationLocale } from "./notifications/i18n";
import "./notifications.css";

export interface NotificationSettings {
  enabled: boolean;
  sources: { claude: boolean; codex: boolean };
  events: { permission: boolean; question: boolean; completed: boolean; error: boolean };
  quota: { at80: boolean; at50: boolean; at20: boolean; at0: boolean; recovered: boolean };
}
export interface NotificationStatus {
  serviceAvailable: boolean; keySaved: boolean; claudeHooksInstalled: boolean; codexHooksInstalled: boolean;
  claudeQuotaAvailable: boolean; codexQuotaAvailable: boolean; lastSendError: string | null;
}
export interface NotificationApi {
  getSettings(): Promise<NotificationSettings>;
  setSettings(settings: NotificationSettings): Promise<NotificationSettings>;
  getStatus(): Promise<NotificationStatus>;
  saveKey(key: string): Promise<void>;
  deleteKey(): Promise<void>;
  sendTest(): Promise<void>;
}

const api: NotificationApi = {
  getSettings: () => invoke("get_notification_settings"),
  setSettings: (settings) => invoke("set_notification_settings", { settings }),
  getStatus: () => invoke("get_notification_status"),
  saveKey: (key) => invoke("save_bark_key", { key }),
  deleteKey: () => invoke("delete_bark_key"),
  sendTest: () => invoke("send_test_notification"),
};

export class NotificationSettingsController {
  private settings: NotificationSettings | null = null;
  private status: NotificationStatus | null = null;
  private locale: NotificationLocale = "zh-CN";
  private feedback: "testSuccess" | "testFailure" | "saveFailure" | "settingsFailure" | null = null;
  private saveQueue: Promise<void> = Promise.resolve();

  constructor(private readonly root: HTMLElement, private readonly api: NotificationApi) {
    root.addEventListener("change", (event) => { void this.onChange(event); });
    root.addEventListener("click", (event) => { void this.onClick(event); });
  }

  async init(locale: NotificationLocale): Promise<void> {
    this.locale = locale;
    [this.settings, this.status] = await Promise.all([this.api.getSettings(), this.api.getStatus()]);
    this.render();
  }

  setLocale(locale: NotificationLocale): void { this.locale = locale; this.render(); }
  setStatus(status: NotificationStatus): void { this.status = status; this.render(); }

  private async onChange(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const path = input?.dataset.path;
    if (!path || !this.settings) return;
    const next = structuredClone(this.settings) as NotificationSettings;
    const keys = path.split(".");
    if (keys.length === 1 && keys[0] === "enabled") next.enabled = input.checked;
    else if (keys.length === 2 && (keys[0] === "sources" || keys[0] === "events" || keys[0] === "quota")) {
      const group = next[keys[0]] as unknown as Record<string, boolean>;
      if (!(keys[1] in group)) return;
      group[keys[1]] = input.checked;
    } else return;
    this.settings = next;
    this.render();
    this.saveQueue = this.saveQueue.then(async () => {
      try {
        await this.api.setSettings(next);
        this.feedback = null;
      } catch {
        this.feedback = "settingsFailure";
      }
      this.render();
    });
    await this.saveQueue;
  }

  private async onClick(event: Event): Promise<void> {
    const target = event.target as HTMLElement;
    const button = target.closest<HTMLButtonElement>("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "save-key") {
      const input = this.root.querySelector<HTMLInputElement>("#bark-key");
      const key = input?.value.trim() ?? "";
      if (input) input.value = "";
      if (!key) return;
      try { await this.api.saveKey(key); this.status = await this.api.getStatus(); this.feedback = null; }
      catch { this.feedback = "saveFailure"; }
    } else if (action === "delete-key") {
      try { await this.api.deleteKey(); this.status = await this.api.getStatus(); this.feedback = null; }
      catch { this.feedback = "saveFailure"; }
    } else if (action === "send-test") {
      if (!this.settings?.enabled || !this.status?.keySaved) return;
      try { await this.api.sendTest(); this.feedback = "testSuccess"; }
      catch { this.feedback = "testFailure"; }
    }
    this.render();
  }

  private render(): void {
    if (!this.settings || !this.status) return;
    const s = this.settings, status = this.status, t = notificationCopy(this.locale);
    document.documentElement.lang = this.locale;
    const toggle = (path: string, label: string, checked: boolean) => `<label class="switch-row"><span>${label}</span><input type="checkbox" data-path="${path}" ${checked ? "checked" : ""} aria-label="${label}"><i aria-hidden="true"></i></label>`;
    const eventSelected = Object.values(s.events).some(Boolean) || Object.values(s.quota).some(Boolean);
    this.root.innerHTML = `
      <header class="page-head"><p class="eyebrow">VIBE CODING LIGHT / NOTIFICATIONS</p><h1>${t.title}</h1><p>${t.intro}</p></header>
      <section class="hero-card"><div><h2>${t.master}</h2><p>${t.masterHint}</p></div>${toggle("enabled", t.master, s.enabled)}</section>
      <div class="settings-grid">
        <section class="card connection"><div class="card-title"><span class="card-index">01</span><h2>${t.connection}</h2></div><p class="key-status ${status.keySaved ? "good" : ""}">${status.keySaved ? t.keySaved : t.keyMissing}</p><label class="field-label" for="bark-key">${t.key}</label><div class="key-entry"><input id="bark-key" type="password" autocomplete="off" spellcheck="false" placeholder="${t.keyPlaceholder}"><button type="button" id="save-key" data-action="save-key">${t.saveKey}</button></div><div class="actions"><button type="button" data-action="delete-key" ${status.keySaved ? "" : "disabled"}>${t.deleteKey}</button><button type="button" id="send-test" data-action="send-test" ${s.enabled && status.keySaved ? "" : "disabled"}>${t.test}</button></div></section>
        <section class="card sources"><div class="card-title"><span class="card-index">02</span><h2>${t.sources}</h2></div><p class="hint">${t.sourceHint}</p>${toggle("sources.claude", t.claude, s.sources.claude)}<p class="availability">${status.claudeHooksInstalled ? t.hooksInstalled : t.hooksMissing}</p>${toggle("sources.codex", t.codex, s.sources.codex)}<p class="availability">${status.codexHooksInstalled ? t.hooksInstalled : t.hooksMissing}</p></section>
        <section class="card events"><div class="card-title"><span class="card-index">03</span><h2>${t.events}</h2></div><p class="hint">${t.eventHint}</p>${toggle("events.permission", t.permission, s.events.permission)}${toggle("events.question", t.question, s.events.question)}${toggle("events.completed", t.completed, s.events.completed)}${toggle("events.error", t.error, s.events.error)}<p class="hint coverage">${t.codexQuestionHint}</p></section>
        <section class="card quotas"><div class="card-title"><span class="card-index">04</span><h2>${t.quotas}</h2></div><p class="hint">${t.quotaHint}</p><div class="quota-status"><span>${t.claudeQuota}</span><strong id="claude-quota-status">${status.claudeQuotaAvailable ? t.quotaAvailable : t.quotaUnavailable}</strong></div><div class="quota-status"><span>${t.codexQuota}</span><strong id="codex-quota-status">${status.codexQuotaAvailable ? t.quotaAvailable : t.quotaUnavailable}</strong></div>${toggle("quota.at80", t.at80, s.quota.at80)}${toggle("quota.at50", t.at50, s.quota.at50)}${toggle("quota.at20", t.at20, s.quota.at20)}${toggle("quota.at0", t.at0, s.quota.at0)}${toggle("quota.recovered", t.recovered, s.quota.recovered)}</section>
      </div>
      ${!eventSelected ? `<p class="notice">${t.noTypes}</p>` : ""}
      <p id="feedback" role="status">${!status.serviceAvailable ? t.serviceUnavailable : this.feedback ? t[this.feedback] : status.lastSendError ? t.testFailure : ""}</p>
      <footer>${t.footer}</footer>`;
  }
}

const root = document.getElementById("notification-app");
if (root) {
  const controller = new NotificationSettingsController(root, api);
  void invoke<NotificationLocale>("get_app_locale").then((locale) => controller.init(locale));
  void listen<NotificationLocale>("locale-changed", (event) => controller.setLocale(event.payload));
  void listen<NotificationStatus>("notification-status-changed", (event) => controller.setStatus(event.payload));
}

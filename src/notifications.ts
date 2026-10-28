import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { notificationCopy, type NotificationLocale } from "./notifications/i18n";
import "./notifications.css";

export interface NotificationSettings {
  enabled: boolean;
  sources: { claude: boolean; codex: boolean };
  events: { permission: boolean; question: boolean; completed: boolean; error: boolean };
  quota: { at80: boolean; at50: boolean; at20: boolean; at0: boolean; at_week0: boolean; recovered: boolean };
  include_details: boolean;
  templates: Record<string, { title: string; body: string }>;
  quiet_hours: { enabled: boolean; start_minute: number; end_minute: number; bypass: { permission: boolean; question: boolean; completed: boolean; error: boolean; quota: boolean } };
}
export interface NotificationStatus {
  serviceAvailable: boolean; keySaved: boolean; claudeHooksInstalled: boolean; codexHooksInstalled: boolean;
  claudeQuotaAvailable: boolean; codexQuotaAvailable: boolean; testConsoleAvailable: boolean; lastSendError: string | null;
}
export interface DiagnosticEntry {
  atMs: number;
  source: "claude" | "codex" | null;
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
}

const api: NotificationApi = {
  getSettings: () => invoke("get_notification_settings"),
  setSettings: (settings) => invoke("set_notification_settings", { settings }),
  getStatus: () => invoke("get_notification_status"),
  getDiagnostics: () => invoke("get_notification_diagnostics"),
  clearDiagnostics: () => invoke("clear_notification_diagnostics"),
  saveKey: (key) => invoke("save_bark_key", { key }),
  deleteKey: () => invoke("delete_bark_key"),
};

type NotificationFeedback = "testSending" | "testSuccess" | "testQuietSkipped" | "testFailure" | "testRejected" | "testUnsent" | "testAmbiguous" | "invalidKey" | "saveFailure" | "settingsFailure";
type TemplateEvent = "permission" | "question" | "completed" | "error" | "quota80" | "quota50" | "quota20" | "quota0" | "recovered";
const templateEvents: TemplateEvent[] = ["permission", "question", "completed", "error", "quota80", "quota50", "quota20", "quota0", "recovered"];

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

function defaultBody(event: TemplateEvent, locale: NotificationLocale): string {
  const zh = locale === "zh-CN";
  const bodies: Record<TemplateEvent, string> = {
    permission: zh ? "{source} · 等待权限批准" : "{source} · Permission approval needed",
    question: zh ? "{source} · 等待回答问题" : "{source} · Answer needed",
    completed: zh ? "{source} · 本轮回复完成" : "{source} · Current turn completed",
    error: zh ? "{source} · 执行遇到错误" : "{source} · Execution encountered an error",
    quota80: zh ? "{source} · {period}额度剩余 {remaining}" : "{source} · {period} quota {remaining} remaining",
    quota50: zh ? "{source} · {period}额度剩余 {remaining}" : "{source} · {period} quota {remaining} remaining",
    quota20: zh ? "{source} · {period}额度剩余 {remaining}" : "{source} · {period} quota {remaining} remaining",
    quota0: zh ? "{source} · {period}额度剩余 {remaining}" : "{source} · {period} quota {remaining} remaining",
    recovered: zh ? "{source} · {period}额度已恢复" : "{source} · {period} quota recovered",
  };
  return bodies[event];
}

function sendErrorFeedback(error: unknown): NotificationFeedback {
  if (error === "Invalid Bark device key") return "invalidKey";
  if (error === "Bark send failed: Rejected") return "testRejected";
  if (error === "Bark send failed: Unsent") return "testUnsent";
  if (error === "Bark send failed: Ambiguous") return "testAmbiguous";
  return "testFailure";
}

export class NotificationSettingsController {
  private settings: NotificationSettings | null = null;
  private status: NotificationStatus | null = null;
  private diagnostics: DiagnosticEntry[] = [];
  private locale: NotificationLocale = "zh-CN";
  private feedback: NotificationFeedback | null = null;
  private quietError = false;
  private saveQueue: Promise<void> = Promise.resolve();
  private selectedEvent: TemplateEvent = "permission";
  private templateDrafts: Record<string, { title: string; body: string }> = {};

  constructor(private readonly root: HTMLElement, private readonly api: NotificationApi) {
    root.addEventListener("change", (event) => { void this.onChange(event); });
    root.addEventListener("click", (event) => { void this.onClick(event); });
    root.addEventListener("input", (event) => {
      if ((event.target as HTMLElement)?.hasAttribute("data-template-field")) {
        this.rememberTemplateDraft();
        this.updateTemplatePreview();
      }
    });
  }

  async init(locale: NotificationLocale): Promise<void> {
    this.locale = locale;
    [this.settings, this.status, this.diagnostics] = await Promise.all([this.api.getSettings(), this.api.getStatus(), this.api.getDiagnostics()]);
    this.render();
  }

  setLocale(locale: NotificationLocale): void { this.locale = locale; this.render(); }
  setStatus(status: NotificationStatus): void { this.status = status; this.render(); }
  setDiagnostics(entries: DiagnosticEntry[]): void { this.diagnostics = entries; this.render(); }

  private async onChange(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (input?.id === "template-event") {
      this.selectedEvent = input.value as TemplateEvent;
      this.render();
      return;
    }
    const field = input?.dataset.templateField;
    if ((field === "title" || field === "body") && this.settings) {
      const next = structuredClone(this.settings) as NotificationSettings;
      const key = `${this.locale}.${this.selectedEvent}`;
      this.rememberTemplateDraft();
      next.templates[key] = { ...this.templateDrafts[key] };
      this.settings = next;
      this.updateTemplatePreview();
      this.saveQueue = this.saveQueue.then(async () => {
        try { await this.api.setSettings(next); this.feedback = null; }
        catch { this.feedback = "settingsFailure"; this.render(); }
      });
      await this.saveQueue;
      return;
    }
    const path = input?.dataset.path;
    if (!path || !this.settings) return;
    const next = structuredClone(this.settings) as NotificationSettings;
    const keys = path.split(".");
    if (keys[0] === "quiet_hours" && keys.length === 2 && (keys[1] === "start_minute" || keys[1] === "end_minute")) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.value)) { this.quietError = true; this.render(); return; }
      const [hour, minute] = input.value.split(":").map(Number);
      next.quiet_hours[keys[1]] = hour * 60 + minute;
      if (next.quiet_hours.start_minute === next.quiet_hours.end_minute) { this.quietError = true; this.render(); return; }
      this.quietError = false;
    }
    if (keys.length === 1 && keys[0] === "enabled") next.enabled = input.checked;
    else if (keys.length === 1 && keys[0] === "include_details") next.include_details = input.checked;
    else if (keys.length === 2 && keys[0] === "quiet_hours" && keys[1] === "enabled") next.quiet_hours.enabled = input.checked;
    else if (keys.length === 2 && keys[0] === "quiet_hours" && (keys[1] === "start_minute" || keys[1] === "end_minute")) { /* parsed above */ }
    else if (keys.length === 3 && keys[0] === "quiet_hours" && keys[1] === "bypass" && keys[2] in next.quiet_hours.bypass) {
      next.quiet_hours.bypass[keys[2] as keyof typeof next.quiet_hours.bypass] = input.checked;
    }
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
    if (action === "clear-diagnostics") {
      try { await this.api.clearDiagnostics(); this.diagnostics = []; this.feedback = null; }
      catch { this.feedback = "settingsFailure"; }
      this.render();
      return;
    }
    if (action === "reset-template" && this.settings) {
      const next = structuredClone(this.settings) as NotificationSettings;
      const key = `${this.locale}.${this.selectedEvent}`;
      delete next.templates[key];
      delete this.templateDrafts[key];
      this.settings = next;
      this.render();
      this.saveQueue = this.saveQueue.then(async () => {
        try { await this.api.setSettings(next); this.feedback = null; }
        catch { this.feedback = "settingsFailure"; this.render(); }
      });
      await this.saveQueue;
      return;
    }
    if (action === "save-key") {
      const input = this.root.querySelector<HTMLInputElement>("#bark-key");
      const key = input?.value.trim() ?? "";
      if (input) input.value = "";
      if (!key) return;
      try { await this.api.saveKey(key); this.status = await this.api.getStatus(); this.feedback = null; }
      catch (error) { this.feedback = error === "Invalid Bark device key" ? "invalidKey" : "saveFailure"; }
    } else if (action === "delete-key") {
      try { await this.api.deleteKey(); this.status = await this.api.getStatus(); this.feedback = null; }
      catch { this.feedback = "saveFailure"; }
    }
    this.render();
  }

  private render(): void {
    if (!this.settings || !this.status) return;
    const active = this.root.contains(document.activeElement) ? document.activeElement as HTMLInputElement | HTMLTextAreaElement : null;
    const activeTemplateField = active?.dataset?.templateField;
    const selection = activeTemplateField ? { start: active!.selectionStart, end: active!.selectionEnd } : null;
    const s = this.settings, status = this.status, t = notificationCopy(this.locale);
    const feedback = this.feedback ?? (status.lastSendError ? sendErrorFeedback(status.lastSendError) : null);
    const feedbackError = feedback !== null;
    document.documentElement.lang = this.locale;
    const toggle = (path: string, label: string, checked: boolean) => `<label class="switch-row"><span>${label}</span><input type="checkbox" data-path="${path}" ${checked ? "checked" : ""} aria-label="${label}"><i aria-hidden="true"></i></label>`;
    const eventSelected = Object.values(s.events).some(Boolean) || Object.values(s.quota).some(Boolean);
    const labels: Record<TemplateEvent, string> = {
      permission: t.templatePermission, question: t.templateQuestion, completed: t.templateCompleted,
      error: t.templateError, quota80: t.templateQuota80, quota50: t.templateQuota50,
      quota20: t.templateQuota20, quota0: t.templateQuota0, recovered: t.templateRecovered,
    };
    const selectedTemplate = this.templateDrafts[`${this.locale}.${this.selectedEvent}`] ?? s.templates[`${this.locale}.${this.selectedEvent}`] ?? { title: "", body: "" };
    const outcomeLabels: Record<DiagnosticEntry["outcome"], string> = { observed: t.diagnosticObserved, deferred: t.diagnosticDeferred, sent: t.diagnosticSent, skipped: t.diagnosticSkipped, failed: t.diagnosticFailed };
    const reasonLabels: Record<string, string> = {
      notifications_disabled: t.diagnosticNotificationsDisabled, state_only: t.diagnosticStateOnly,
      duplicate: t.diagnosticDuplicate, expired: t.diagnosticExpired,
      source_disabled: t.diagnosticSourceDisabled, type_disabled: t.diagnosticTypeDisabled,
      cooldown: t.diagnosticCooldown, quiet_hours: t.diagnosticQuietHours,
      superseded: t.diagnosticSuperseded, key_missing: t.diagnosticKeyMissing,
      rejected: t.diagnosticRejected, network: t.diagnosticNetwork, unconfirmed: t.diagnosticUnconfirmed,
    };
    const diagnosticLabels: Record<string, string> = { permission: t.permission, question: t.question, completed: t.completed, error: t.error, quota80: t.at80, quota50: t.at50, quota20: t.at20, quota0: t.at0, quota_week0: t.atWeek0, recovered: t.recovered, working: t.diagnosticWorking, test: t.test };
    const diagnosticRows = [...this.diagnostics].reverse().map((entry) => {
      const source = entry.source === "claude" ? t.claude : entry.source === "codex" ? t.codex : t.diagnosticApp;
      const simulatedKind = entry.kind.startsWith("test_") ? entry.kind.slice(5) : null;
      const kind = simulatedKind && diagnosticLabels[simulatedKind] ? `${t.testTag} · ${diagnosticLabels[simulatedKind]}` : diagnosticLabels[entry.kind] ?? entry.kind;
      const reason = entry.reason ? reasonLabels[entry.reason] ?? entry.reason : "";
      const when = new Date(entry.atMs).toLocaleString(this.locale);
      return `<li><time>${escapeHtml(when)}</time><strong>${escapeHtml(source)} · ${escapeHtml(kind)}</strong><span class="diagnostic-outcome ${entry.outcome}">${escapeHtml(outcomeLabels[entry.outcome] ?? entry.outcome)}</span>${reason ? `<small>${escapeHtml(reason)}</small>` : ""}</li>`;
    }).join("");
    const timeValue = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    this.root.innerHTML = `
      <header class="page-head"><p class="eyebrow">VIBE CODING LIGHT / NOTIFICATIONS</p><h1>${t.title}</h1><p>${t.intro}</p></header>
      <section class="hero-card"><div><h2>${t.master}</h2><p>${t.masterHint}</p></div>${toggle("enabled", t.master, s.enabled)}</section>
      <div class="settings-grid">
        <section class="card connection"><div class="card-title"><span class="card-index">01</span><h2>${t.connection}</h2></div><p class="key-status ${status.keySaved ? "good" : ""}">${status.keySaved ? t.keySaved : t.keyMissing}</p><label class="field-label" for="bark-key">${t.key}</label><div class="key-entry"><input id="bark-key" type="password" autocomplete="off" spellcheck="false" placeholder="${t.keyPlaceholder}"><button type="button" id="save-key" data-action="save-key">${t.saveKey}</button></div><div class="actions"><button type="button" data-action="delete-key" ${status.keySaved ? "" : "disabled"}>${t.deleteKey}</button></div><p id="feedback" role="status" class="${feedbackError ? "error" : ""}">${feedback ? t[feedback] : ""}</p></section>
        <section class="card sources"><div class="card-title"><span class="card-index">02</span><h2>${t.sources}</h2></div><p class="hint">${t.sourceHint}</p>${toggle("sources.claude", t.claude, s.sources.claude)}<p class="availability">${status.claudeHooksInstalled ? t.hooksInstalled : t.hooksMissing}</p>${toggle("sources.codex", t.codex, s.sources.codex)}<p class="availability">${status.codexHooksInstalled ? t.hooksInstalled : t.hooksMissing}</p></section>
        <section class="card events"><div class="card-title"><span class="card-index">03</span><h2>${t.events}</h2></div><p class="hint">${t.eventHint}</p>${toggle("events.permission", t.permission, s.events.permission)}${toggle("events.question", t.question, s.events.question)}${toggle("events.completed", t.completed, s.events.completed)}${toggle("events.error", t.error, s.events.error)}<p class="hint coverage">${t.codexQuestionHint}</p></section>
        <section class="card quotas"><div class="card-title"><span class="card-index">04</span><h2>${t.quotas}</h2></div><p class="hint">${t.quotaHint}</p><div class="quota-status"><span>${t.claudeQuota}</span><strong id="claude-quota-status">${status.claudeQuotaAvailable ? t.quotaAvailable : t.quotaUnavailable}</strong></div><div class="quota-status"><span>${t.codexQuota}</span><strong id="codex-quota-status">${status.codexQuotaAvailable ? t.quotaAvailable : t.quotaUnavailable}</strong></div>${toggle("quota.at80", t.at80, s.quota.at80)}${toggle("quota.at50", t.at50, s.quota.at50)}${toggle("quota.at20", t.at20, s.quota.at20)}${toggle("quota.at0", t.at0, s.quota.at0)}${toggle("quota.at_week0", t.atWeek0, s.quota.at_week0)}${toggle("quota.recovered", t.recovered, s.quota.recovered)}</section>
      </div>
      <section class="card quiet-hours"><div class="card-title"><span class="card-index">05</span><h2>${t.quietTitle}</h2></div><p class="hint">${t.quietHint}</p>${toggle("quiet_hours.enabled", t.quietEnabled, s.quiet_hours.enabled)}<div class="quiet-time-grid"><label class="field-label">${t.quietStart}<input type="time" data-path="quiet_hours.start_minute" value="${timeValue(s.quiet_hours.start_minute)}"></label><label class="field-label">${t.quietEnd}<input type="time" data-path="quiet_hours.end_minute" value="${timeValue(s.quiet_hours.end_minute)}"></label></div>${this.quietError ? `<p class="quiet-error" role="alert">${t.quietInvalid}</p>` : ""}<p class="hint quiet-bypass-title">${t.quietBypass}</p>${toggle("quiet_hours.bypass.permission", t.permission, s.quiet_hours.bypass.permission)}${toggle("quiet_hours.bypass.question", t.question, s.quiet_hours.bypass.question)}${toggle("quiet_hours.bypass.completed", t.completed, s.quiet_hours.bypass.completed)}${toggle("quiet_hours.bypass.error", t.error, s.quiet_hours.bypass.error)}${toggle("quiet_hours.bypass.quota", t.quotas, s.quiet_hours.bypass.quota)}</section>
      <section class="card templates"><div class="card-title"><span class="card-index">06</span><h2>${t.templatesTitle}</h2></div><p class="hint">${t.templatesHint}</p>
        ${toggle("include_details", t.detailsToggle, s.include_details)}<p class="detail-hint">${t.detailsHint}</p>
        <div class="template-editor"><label class="field-label" for="template-event">${t.templateEvent}</label><select id="template-event">${templateEvents.map((event) => `<option value="${event}" ${event === this.selectedEvent ? "selected" : ""}>${labels[event]}</option>`).join("")}</select>
          <label class="field-label" for="template-title">${t.templateTitle}</label><input id="template-title" data-template-field="title" maxlength="120" value="${escapeHtml(selectedTemplate.title)}" placeholder="Vibe Coding Light">
          <label class="field-label" for="template-body">${t.templateBody}</label><textarea id="template-body" data-template-field="body" maxlength="2000" rows="3" placeholder="${escapeHtml(defaultBody(this.selectedEvent, this.locale))}">${escapeHtml(selectedTemplate.body)}</textarea>
          <p class="token-hint">${t.templateTokens}</p><button type="button" data-action="reset-template">${t.templateReset}</button>
        </div><div class="template-preview"><span>${t.templatePreview}</span><div id="template-preview"><strong id="preview-title"></strong><p id="preview-body"></p></div></div>
      </section>
      <section class="card diagnostics"><div class="card-title"><span class="card-index">07</span><h2>${t.diagnosticsTitle}</h2></div><p class="hint">${t.diagnosticsHint}</p><div class="diagnostic-actions"><button type="button" data-action="clear-diagnostics" ${this.diagnostics.length ? "" : "disabled"}>${t.diagnosticsClear}</button></div>${diagnosticRows ? `<ol class="diagnostic-list">${diagnosticRows}</ol>` : `<p class="diagnostic-empty">${t.diagnosticsEmpty}</p>`}</section>
      ${!eventSelected ? `<p class="notice">${t.noTypes}</p>` : ""}
      ${!status.serviceAvailable ? `<p class="notice" role="status">${t.serviceUnavailable}</p>` : ""}
      <footer>${t.footer}</footer>`;
    this.updateTemplatePreview();
    if (activeTemplateField) {
      const replacement = this.root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-template-field="${activeTemplateField}"]`);
      if (replacement) {
        replacement.focus();
        if (selection && selection.start !== null && selection.end !== null) replacement.setSelectionRange(selection.start, selection.end);
      }
    }
  }

  private rememberTemplateDraft(): void {
    const title = this.root.querySelector<HTMLInputElement>('[data-template-field="title"]');
    const body = this.root.querySelector<HTMLTextAreaElement>('[data-template-field="body"]');
    if (!title || !body) return;
    this.templateDrafts[`${this.locale}.${this.selectedEvent}`] = { title: title.value, body: body.value };
  }

  private updateTemplatePreview(): void {
    if (!this.settings) return;
    const t = notificationCopy(this.locale);
    const titleInput = this.root.querySelector<HTMLInputElement>('[data-template-field="title"]');
    const bodyInput = this.root.querySelector<HTMLTextAreaElement>('[data-template-field="body"]');
    const titleOutput = this.root.querySelector<HTMLElement>("#preview-title");
    const bodyOutput = this.root.querySelector<HTMLElement>("#preview-body");
    if (!titleInput || !bodyInput || !titleOutput || !bodyOutput) return;
    const sample = {
      source: "Codex", task: t.sampleTask, command: "npm test", error: t.sampleError,
      reply: t.sampleReply, question: t.sampleQuestion, period: this.locale === "zh-CN" ? "5 小时" : "5 hours", remaining: "20%",
    };
    const detailByEvent: Record<TemplateEvent, string> = {
      permission: sample.command, question: sample.question, completed: sample.task,
      error: sample.error, quota80: "", quota50: "", quota20: "", quota0: "", recovered: "",
    };
    const values: Record<string, string> = { ...sample, detail: detailByEvent[this.selectedEvent] };
    if (!this.settings.include_details) {
      for (const key of ["task", "command", "error", "reply", "question", "detail"]) values[key] = "";
    }
    const render = (value: string) => value.replace(/\{(source|task|command|error|reply|question|detail|period|remaining)\}/g, (_match, key: string) => values[key] ?? "");
    const fallback = defaultBody(this.selectedEvent, this.locale);
    const defaultWithDetail = !bodyInput.value && values.detail ? `${fallback}\n${values.detail}` : fallback;
    titleOutput.textContent = render(titleInput.value || "Vibe Coding Light");
    bodyOutput.textContent = render(bodyInput.value || defaultWithDetail);
  }
}

const root = document.getElementById("notification-app");
if (root) {
  const controller = new NotificationSettingsController(root, api);
  void invoke<NotificationLocale>("get_app_locale").then((locale) => controller.init(locale));
  void listen<NotificationLocale>("locale-changed", (event) => controller.setLocale(event.payload));
  void listen<NotificationStatus>("notification-status-changed", (event) => controller.setStatus(event.payload));
  void listen("notification-diagnostics-changed", () => { void api.getDiagnostics().then((entries) => controller.setDiagnostics(entries)); });
}

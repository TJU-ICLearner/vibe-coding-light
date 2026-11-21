import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { initAppearance } from "./appearance";
import { notificationCopy, type NotificationLocale } from "./notifications/i18n";
import "./appearance.css";
import "./notifications.css";

import { notificationApi as api } from "./notifications/api";
import type { DiagnosticEntry, NotificationApi, NotificationSettings, NotificationStatus } from "./notifications/api";
export type { DiagnosticEntry, NotificationApi, NotificationSettings, NotificationStatus } from "./notifications/api";

type NotificationFeedback = "testSending" | "testSuccess" | "testQuietSkipped" | "testFailure" | "testRejected" | "testUnsent" | "testAmbiguous" | "invalidKey" | "saveFailure" | "settingsFailure" | "keySavedRefreshFailed" | "keyDeletedRefreshFailed";
type TemplateEvent = "permission" | "question" | "completed" | "error" | "quota80" | "quota50" | "quota20" | "quota0" | "recovered";
const templateEvents: TemplateEvent[] = ["permission", "question", "completed", "error", "quota80", "quota50", "quota20", "quota0", "recovered"];
const templateDraftStorageKey = "vibe-coding-light.notification-template-drafts.v1";
type PendingTemplate = { title: string; body: string } | null;
const unknownStatus: NotificationStatus = {
  serviceAvailable: false, keySaved: false, claudeHooksInstalled: false, codexHooksInstalled: false,
  cursorHooksInstalled: false, traeHooksInstalled: false, grokHooksInstalled: false, deepseekHooksPrepared: false,
  claudeQuotaAvailable: false, codexQuotaAvailable: false, testConsoleAvailable: false, lastSendError: null,
};

function readPendingTemplates(): Record<string, PendingTemplate> {
  const entries: Record<string, PendingTemplate> = Object.create(null);
  try {
    const raw = window.localStorage.getItem(templateDraftStorageKey);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return entries;
    for (const [key, value] of Object.entries(parsed)) {
      const [locale, event, extra] = key.split(".");
      if (extra || (locale !== "zh-CN" && locale !== "en") || !templateEvents.includes(event as TemplateEvent)) continue;
      if (value === null) entries[key] = null;
      else if (value && typeof value === "object" && !Array.isArray(value)) {
        const draft = value as Record<string, unknown>;
        if (typeof draft.title === "string" && draft.title.length <= 120 && typeof draft.body === "string" && draft.body.length <= 2000) {
          entries[key] = { title: draft.title, body: draft.body };
        }
      }
    }
  } catch { /* Storage may be unavailable; normal settings saves still work. */ }
  return entries;
}

function writePendingTemplates(entries: Record<string, PendingTemplate>): boolean {
  try {
    if (Object.keys(entries).length) window.localStorage.setItem(templateDraftStorageKey, JSON.stringify(entries));
    else window.localStorage.removeItem(templateDraftStorageKey);
    return true;
  } catch { return false; }
}

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
  private persistedSettings: NotificationSettings | null = null;
  private status: NotificationStatus | null = null;
  private diagnostics: DiagnosticEntry[] = [];
  private diagnosticsRefreshFailed = false;
  private diagnosticsLoading = false;
  private statusRefreshFailed = false;
  private statusLoading = false;
  private locale: NotificationLocale = "zh-CN";
  private localeOverridden = false;
  private statusRevision = 0;
  private diagnosticsRevision = 0;
  private initGeneration = 0;
  private feedback: NotificationFeedback | null = null;
  private quietError = false;
  private saveQueue: Promise<void> = Promise.resolve();
  private saveRevision = 0;
  private selectedEvent: TemplateEvent = "permission";
  private templateDrafts: Record<string, { title: string; body: string }> = {};
  private pendingTemplates = readPendingTemplates();
  private dirtyTemplateKeys = new Set<string>();
  private resetTemplateKeys = new Set<string>();
  private templateEditRevision = 0;
  private templateKeyRevisions: Record<string, number> = Object.create(null);
  private templateSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private templateSaveState: "idle" | "saving" | "saved" | "failed" = "idle";
  private installFeedback = "";
  private installingSources = new Set<string>();
  private loadFailed = false;
  private initializing = false;

  constructor(private readonly root: HTMLElement, private readonly api: NotificationApi) {
    root.addEventListener("change", (event) => { void this.onChange(event); });
    root.addEventListener("click", (event) => { void this.onClick(event); });
    root.addEventListener("input", (event) => {
      if ((event.target as HTMLElement)?.hasAttribute("data-template-field")) {
        this.rememberTemplateDraft();
        this.updateTemplatePreview();
        this.markTemplateDirty();
      }
    });
  }

  async init(locale: NotificationLocale): Promise<void> {
    if (this.initializing) return;
    this.initializing = true;
    if (!this.localeOverridden) this.locale = locale;
    const statusRevision = this.statusRevision;
    const diagnosticsRevision = this.diagnosticsRevision;
    const generation = ++this.initGeneration;
    this.statusLoading = true;
    this.diagnosticsLoading = true;
    void this.api.getStatus().then((status) => {
      if (generation === this.initGeneration && statusRevision === this.statusRevision) this.setStatus(status);
    }, () => {
      if (generation === this.initGeneration && statusRevision === this.statusRevision) {
        this.statusLoading = false;
        this.statusRefreshFailed = true;
        this.render();
      }
    });
    void this.api.getDiagnostics().then((diagnostics) => {
      if (generation === this.initGeneration && diagnosticsRevision === this.diagnosticsRevision) this.setDiagnostics(diagnostics);
    }, () => {
      if (generation === this.initGeneration && diagnosticsRevision === this.diagnosticsRevision) {
        this.diagnosticsLoading = false;
        this.diagnosticsRefreshFailed = true;
        this.render();
      }
    });
    try {
      const settings = await this.api.getSettings();
      this.settings = settings;
      this.persistedSettings = structuredClone(settings);
      this.loadFailed = false;
      for (const [key, draft] of Object.entries(this.pendingTemplates)) {
        this.dirtyTemplateKeys.add(key);
        if (draft === null) this.resetTemplateKeys.add(key);
        else this.templateDrafts[key] = draft;
      }
      if (this.dirtyTemplateKeys.size) this.templateSaveState = "saving";
      this.render();
      if (this.dirtyTemplateKeys.size) void this.flushTemplateDrafts();
    } catch {
      this.loadFailed = true;
      this.render();
    } finally { this.initializing = false; }
  }

  setLocale(locale: NotificationLocale): void { this.localeOverridden = true; this.locale = locale; this.render(); }
  setStatus(status: NotificationStatus): void { this.statusRevision++; this.status = status; this.statusLoading = false; this.statusRefreshFailed = false; this.render(); }
  setDiagnostics(entries: DiagnosticEntry[]): void { this.diagnosticsRevision++; this.diagnostics = entries; this.diagnosticsLoading = false; this.diagnosticsRefreshFailed = false; this.render(); }

  async refreshDiagnostics(): Promise<void> {
    try { this.setDiagnostics(await this.api.getDiagnostics()); }
    catch { this.diagnosticsRefreshFailed = true; this.render(); }
  }

  async refreshStatus(): Promise<void> {
    const revision = this.statusRevision;
    this.statusLoading = true;
    this.render();
    try {
      const status = await this.api.getStatus();
      if (revision === this.statusRevision) this.setStatus(status);
    } catch {
      if (revision === this.statusRevision) { this.statusLoading = false; this.statusRefreshFailed = true; this.render(); }
    }
  }

  private queueSettingsSave(next: NotificationSettings, template = false): Promise<boolean> {
    const revision = ++this.saveRevision;
    const operation = this.saveQueue.then(async () => {
      try {
        const saved = await this.api.setSettings(next);
        this.persistedSettings = structuredClone(saved);
        if (revision === this.saveRevision) {
          this.settings = saved;
          this.feedback = null;
          this.render();
        }
        return true;
      } catch {
        if (revision === this.saveRevision) {
          this.settings = structuredClone(this.persistedSettings ?? next);
          this.feedback = template ? null : "settingsFailure";
          this.render();
        }
        return false;
      }
    });
    this.saveQueue = operation.then(() => {});
    return operation;
  }

  private markTemplateDirty(): void {
    const key = `${this.locale}.${this.selectedEvent}`;
    this.resetTemplateKeys.delete(key);
    this.dirtyTemplateKeys.add(key);
    this.pendingTemplates[key] = { ...this.templateDrafts[key] };
    this.templateEditRevision++;
    this.templateKeyRevisions[key] = (this.templateKeyRevisions[key] ?? 0) + 1;
    this.templateSaveState = writePendingTemplates(this.pendingTemplates) ? "saving" : "failed";
    this.updateTemplateSaveStatus();
    if (this.templateSaveTimer !== null) clearTimeout(this.templateSaveTimer);
    this.templateSaveTimer = setTimeout(() => { void this.flushTemplateDrafts(); }, 250);
  }

  private async flushTemplateDrafts(): Promise<void> {
    if (this.templateSaveTimer !== null) clearTimeout(this.templateSaveTimer);
    this.templateSaveTimer = null;
    if (!this.settings || this.dirtyTemplateKeys.size === 0) return;
    const keys = [...this.dirtyTemplateKeys];
    const editRevision = this.templateEditRevision;
    const keyRevisions = keys.map((key) => this.templateKeyRevisions[key] ?? 0);
    this.dirtyTemplateKeys.clear();
    const next = structuredClone(this.settings) as NotificationSettings;
    for (const key of keys) {
      if (this.resetTemplateKeys.has(key)) delete next.templates[key];
      else next.templates[key] = { ...this.templateDrafts[key] };
    }
    this.settings = next;
    this.templateSaveState = "saving";
    this.updateTemplateSaveStatus();
    const saved = await this.queueSettingsSave(next, true);
    for (const [index, key] of keys.entries()) {
      if ((this.templateKeyRevisions[key] ?? 0) !== keyRevisions[index]) continue;
      if (!saved) this.dirtyTemplateKeys.add(key);
      else {
        this.resetTemplateKeys.delete(key);
        delete this.pendingTemplates[key];
      }
    }
    if (saved) writePendingTemplates(this.pendingTemplates);
    if (editRevision === this.templateEditRevision) {
      this.templateSaveState = saved && this.dirtyTemplateKeys.size === 0 ? "saved" : saved ? "saving" : "failed";
    }
    this.updateTemplateSaveStatus();
  }

  private updateTemplateSaveStatus(): void {
    const status = this.root.querySelector<HTMLElement>("#template-save-status");
    const retry = this.root.querySelector<HTMLButtonElement>('[data-action="retry-template"]');
    const t = notificationCopy(this.locale);
    if (status) status.textContent = this.templateSaveState === "saving" ? t.templateSaving
      : this.templateSaveState === "saved" ? t.templateSaved
      : this.templateSaveState === "failed" ? t.templateSaveFailed : "";
    status?.classList.toggle("error", this.templateSaveState === "failed");
    if (retry) retry.hidden = this.templateSaveState !== "failed";
  }

  private async onChange(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (input?.id === "template-event") {
      void this.flushTemplateDrafts();
      this.selectedEvent = input.value as TemplateEvent;
      this.render();
      return;
    }
    const field = input?.dataset.templateField;
    if ((field === "title" || field === "body") && this.settings) {
      this.rememberTemplateDraft();
      this.updateTemplatePreview();
      this.markTemplateDirty();
      await this.flushTemplateDrafts();
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
    await this.queueSettingsSave(next);
  }

  private async onClick(event: Event): Promise<void> {
    const target = event.target as HTMLElement;
    const button = target.closest<HTMLButtonElement>("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "retry-init") { await this.init(this.locale); return; }
    if (action === "retry-status") { await this.refreshStatus(); return; }
    if (action === "retry-template") { await this.flushTemplateDrafts(); return; }
    if (action === "retry-diagnostics") { await this.refreshDiagnostics(); return; }
    if (action?.startsWith("install-")) {
      const source = action.slice(8);
      if (this.installingSources.has(source)) return;
      const restoreFocus = document.activeElement === button;
      this.installingSources.add(source);
      this.render();
      try {
        await this.api.installHooks(source);
        const statusField = ({ cursor: "cursorHooksInstalled", trae: "traeHooksInstalled", grok: "grokHooksInstalled", deepseek: "deepseekHooksPrepared" } as const)[source as "cursor" | "trae" | "grok" | "deepseek"];
        if (this.status && statusField) this.status = { ...this.status, [statusField]: true };
        let refreshFailed = false;
        try { this.setStatus(await this.api.getStatus()); } catch { refreshFailed = true; }
        const copy = notificationCopy(this.locale);
        this.installFeedback = `${source === "deepseek" ? copy.deepseekPrepared : copy.installSuccess}${refreshFailed ? ` · ${copy.statusRefreshFailed}` : ""}`;
      } catch (error) {
        this.installFeedback = `${notificationCopy(this.locale).installFailed}: ${String(error)}`;
      } finally {
        this.installingSources.delete(source);
      }
      this.render();
      if (restoreFocus) this.root.querySelector<HTMLButtonElement>(`[data-action="install-${source}"]`)?.focus();
      return;
    }
    if (action === "clear-diagnostics") {
      try { await this.api.clearDiagnostics(); this.diagnostics = []; this.diagnosticsRefreshFailed = false; this.feedback = null; }
      catch { this.feedback = "settingsFailure"; }
      this.render();
      return;
    }
    if (action === "reset-template" && this.settings) {
      if (this.templateSaveTimer !== null) clearTimeout(this.templateSaveTimer);
      this.templateSaveTimer = null;
      const key = `${this.locale}.${this.selectedEvent}`;
      delete this.templateDrafts[key];
      this.resetTemplateKeys.add(key);
      this.dirtyTemplateKeys.add(key);
      this.pendingTemplates[key] = null;
      writePendingTemplates(this.pendingTemplates);
      this.templateEditRevision++;
      this.templateKeyRevisions[key] = (this.templateKeyRevisions[key] ?? 0) + 1;
      delete this.settings.templates[key];
      this.templateSaveState = "saving";
      this.render();
      await this.flushTemplateDrafts();
      return;
    }
    if (action === "save-key") {
      const input = this.root.querySelector<HTMLInputElement>("#bark-key");
      const key = input?.value.trim() ?? "";
      if (!key) return;
      try {
        await this.api.saveKey(key);
        if (input) input.value = "";
        if (this.status) this.status = { ...this.status, keySaved: true };
        try { this.setStatus(await this.api.getStatus()); this.feedback = null; }
        catch { this.feedback = "keySavedRefreshFailed"; }
      }
      catch (error) { this.feedback = error === "Invalid Bark device key" ? "invalidKey" : "saveFailure"; }
    } else if (action === "delete-key") {
      try {
        await this.api.deleteKey();
        if (this.status) this.status = { ...this.status, keySaved: false };
        try { this.setStatus(await this.api.getStatus()); this.feedback = null; }
        catch { this.feedback = "keyDeletedRefreshFailed"; }
      }
      catch { this.feedback = "saveFailure"; }
    }
    this.render();
  }

  private render(): void {
    if (this.loadFailed) {
      const t = notificationCopy(this.locale);
      document.documentElement.lang = this.locale;
      this.root.innerHTML = `<section class="card load-error" role="alert"><h1>${t.title}</h1><p>${t.loadFailed}</p><button type="button" data-action="retry-init">${t.loadRetry}</button></section>`;
      return;
    }
    if (!this.settings) return;
    const active = this.root.contains(document.activeElement) ? document.activeElement as HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement | HTMLSelectElement : null;
    const activeTemplateField = active?.dataset?.templateField;
    const barkKey = this.root.querySelector<HTMLInputElement>("#bark-key")?.value ?? "";
    const activeBarkKey = active?.id === "bark-key";
    const activePath = active?.dataset?.path;
    const activeAction = active?.dataset?.action;
    const activeId = active?.id;
    const activeText = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? active : null;
    const selection = (activeTemplateField || activeBarkKey) && activeText ? { start: activeText.selectionStart, end: activeText.selectionEnd } : null;
    const s = this.settings, status = this.status ?? unknownStatus, statusKnown = this.status !== null, t = notificationCopy(this.locale);
    const statusPlaceholder = this.statusLoading ? t.statusLoading : t.statusUnknown;
    const settingsFailed = this.feedback === "settingsFailure";
    const feedback = settingsFailed ? null : this.feedback ?? (status.lastSendError ? sendErrorFeedback(status.lastSendError) : null);
    const feedbackError = feedback !== null;
    document.documentElement.lang = this.locale;
    const toggle = (path: string, label: string, checked: boolean) => `<label class="switch-row"><span>${label}</span><input type="checkbox" data-path="${path}" ${checked ? "checked" : ""} aria-label="${label}"><i aria-hidden="true"></i></label>`;
    const sourceRow = (source: "claude" | "codex" | "cursor" | "trae" | "grok" | "deepseek", availability: string, installable: boolean) => `<div class="integration-source">${toggle(`sources.${source}`, t[source], s.sources[source])}<span class="availability">${availability}</span>${installable ? `<button type="button" data-action="install-${source}" ${this.installingSources.has(source) ? "disabled" : ""}>${t.installHook}</button>` : `<span class="integration-action-space" aria-hidden="true"></span>`}</div>`;
    const sourceRows = sourceRow("claude", !statusKnown ? statusPlaceholder : status.claudeHooksInstalled ? t.hooksInstalled : t.hooksMissing, false)
      + sourceRow("codex", !statusKnown ? statusPlaceholder : status.codexHooksInstalled ? t.hooksInstalled : t.hooksMissing, false)
      + (["cursor", "trae", "grok", "deepseek"] as const).map((source) => sourceRow(source,
        !statusKnown ? statusPlaceholder : source === "deepseek" ? (status.deepseekHooksPrepared ? t.deepseekPrepared : t.deepseekNeedsBridge) : (status[`${source}HooksInstalled`] ? t.hooksInstalled : t.hooksMissing), true)).join("");
    const eventSelected = Object.values(s.events).some(Boolean) || Object.values(s.quota).some(Boolean);
    const labels: Record<TemplateEvent, string> = {
      permission: t.templatePermission, question: t.templateQuestion, completed: t.templateCompleted,
      error: t.templateError, quota80: t.templateQuota80, quota50: t.templateQuota50,
      quota20: t.templateQuota20, quota0: t.templateQuota0, recovered: t.templateRecovered,
    };
    const selectedTemplateKey = `${this.locale}.${this.selectedEvent}`;
    const selectedTemplate = this.resetTemplateKeys.has(selectedTemplateKey) ? { title: "", body: "" }
      : this.templateDrafts[selectedTemplateKey] ?? s.templates[selectedTemplateKey] ?? { title: "", body: "" };
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
      const source = entry.source ? ({ claude: t.claude, codex: t.codex, cursor: t.cursor, trae: t.trae, grok: t.grok, deepseek: t.deepseek } as Record<string, string>)[entry.source] ?? t.diagnosticApp : t.diagnosticApp;
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
      ${settingsFailed ? `<p id="settings-feedback" class="notice" role="alert">${t.settingsFailure}</p>` : ""}
      ${this.statusRefreshFailed ? `<div class="notice" role="status"><span id="status-refresh-error">${t.statusInitialFailure}</span><button type="button" data-action="retry-status" ${this.statusLoading ? "disabled" : ""}>${t.statusRetry}</button></div>` : ""}
      <div class="settings-grid">
        <section class="card connection"><div class="card-title"><span class="card-index">01</span><h2>${t.connection}</h2></div><p class="key-status ${statusKnown && status.keySaved ? "good" : ""}">${!statusKnown ? statusPlaceholder : status.keySaved ? t.keySaved : t.keyMissing}</p><label class="field-label" for="bark-key">${t.key}</label><div class="key-entry"><input id="bark-key" type="password" autocomplete="off" spellcheck="false" placeholder="${t.keyPlaceholder}"><button type="button" id="save-key" data-action="save-key">${t.saveKey}</button></div><div class="actions"><button type="button" data-action="delete-key" ${statusKnown && status.keySaved ? "" : "disabled"}>${t.deleteKey}</button></div><p id="feedback" role="status" class="${feedbackError ? "error" : ""}">${feedback ? t[feedback] : ""}</p></section>
        <section class="card sources"><div class="card-title"><span class="card-index">02</span><h2>${t.sources}</h2></div><p class="hint">${t.sourceHint}</p><div class="source-list">${sourceRows}</div><p class="hint source-footer">${t.extraSourceHint}</p><p class="availability" role="status">${escapeHtml(this.installFeedback)}</p></section>
        <section class="card events"><div class="card-title"><span class="card-index">03</span><h2>${t.events}</h2></div><p class="hint">${t.eventHint}</p>${toggle("events.permission", t.permission, s.events.permission)}${toggle("events.question", t.question, s.events.question)}${toggle("events.completed", t.completed, s.events.completed)}${toggle("events.error", t.error, s.events.error)}<p class="hint coverage">${t.codexQuestionHint}</p></section>
        <section class="card quotas"><div class="card-title"><span class="card-index">04</span><h2>${t.quotas}</h2></div><p class="hint">${t.quotaHint}</p><div class="quota-status"><span>${t.claudeQuota}</span><strong id="claude-quota-status">${!statusKnown ? statusPlaceholder : status.claudeQuotaAvailable ? t.quotaAvailable : t.quotaUnavailable}</strong></div><div class="quota-status"><span>${t.codexQuota}</span><strong id="codex-quota-status">${!statusKnown ? statusPlaceholder : status.codexQuotaAvailable ? t.quotaAvailable : t.quotaUnavailable}</strong></div>${toggle("quota.at80", t.at80, s.quota.at80)}${toggle("quota.at50", t.at50, s.quota.at50)}${toggle("quota.at20", t.at20, s.quota.at20)}${toggle("quota.at0", t.at0, s.quota.at0)}${toggle("quota.at_week0", t.atWeek0, s.quota.at_week0)}${toggle("quota.recovered", t.recovered, s.quota.recovered)}</section>
      </div>
      <section class="card quiet-hours"><div class="card-title"><span class="card-index">05</span><h2>${t.quietTitle}</h2></div><p class="hint">${t.quietHint}</p>${toggle("quiet_hours.enabled", t.quietEnabled, s.quiet_hours.enabled)}<div class="quiet-time-grid"><label class="field-label">${t.quietStart}<input type="time" data-path="quiet_hours.start_minute" value="${timeValue(s.quiet_hours.start_minute)}"></label><label class="field-label">${t.quietEnd}<input type="time" data-path="quiet_hours.end_minute" value="${timeValue(s.quiet_hours.end_minute)}"></label></div>${this.quietError ? `<p class="quiet-error" role="alert">${t.quietInvalid}</p>` : ""}<p class="hint quiet-bypass-title">${t.quietBypass}</p>${toggle("quiet_hours.bypass.permission", t.permission, s.quiet_hours.bypass.permission)}${toggle("quiet_hours.bypass.question", t.question, s.quiet_hours.bypass.question)}${toggle("quiet_hours.bypass.completed", t.completed, s.quiet_hours.bypass.completed)}${toggle("quiet_hours.bypass.error", t.error, s.quiet_hours.bypass.error)}${toggle("quiet_hours.bypass.quota", t.quotas, s.quiet_hours.bypass.quota)}</section>
      <section class="card templates"><div class="card-title"><span class="card-index">06</span><h2>${t.templatesTitle}</h2></div><p class="hint">${t.templatesHint}</p>
        ${toggle("include_details", t.detailsToggle, s.include_details)}<p class="detail-hint">${t.detailsHint}</p>
        <div class="template-editor"><label class="field-label" for="template-event">${t.templateEvent}</label><select id="template-event">${templateEvents.map((event) => `<option value="${event}" ${event === this.selectedEvent ? "selected" : ""}>${labels[event]}</option>`).join("")}</select>
          <label class="field-label" for="template-title">${t.templateTitle}</label><input id="template-title" data-template-field="title" maxlength="120" value="${escapeHtml(selectedTemplate.title)}" placeholder="Vibe Coding Light">
          <label class="field-label" for="template-body">${t.templateBody}</label><textarea id="template-body" data-template-field="body" maxlength="2000" rows="3" placeholder="${escapeHtml(defaultBody(this.selectedEvent, this.locale))}">${escapeHtml(selectedTemplate.body)}</textarea>
          <p class="token-hint">${t.templateTokens}</p><div class="template-actions"><button type="button" data-action="reset-template">${t.templateReset}</button><span id="template-save-status" role="status"></span><button type="button" data-action="retry-template" ${this.templateSaveState === "failed" ? "" : "hidden"}>${t.templateRetry}</button></div>
        </div><div class="template-preview"><span>${t.templatePreview}</span><div id="template-preview"><strong id="preview-title"></strong><p id="preview-body"></p></div></div>
      </section>
      <section class="card diagnostics"><div class="card-title"><span class="card-index">07</span><h2>${t.diagnosticsTitle}</h2></div><p class="hint">${t.diagnosticsHint}</p>${this.diagnosticsRefreshFailed ? `<p id="diagnostics-refresh-error" class="quiet-error" role="status">${t.diagnosticsRefreshFailed}</p><button type="button" data-action="retry-diagnostics">${t.diagnosticsRetry}</button>` : ""}<div class="diagnostic-actions"><button type="button" data-action="clear-diagnostics" ${this.diagnostics.length ? "" : "disabled"}>${t.diagnosticsClear}</button></div>${diagnosticRows ? `<ol class="diagnostic-list">${diagnosticRows}</ol>` : `<p class="diagnostic-empty">${this.diagnosticsLoading ? t.diagnosticsLoading : t.diagnosticsEmpty}</p>`}</section>
      ${!eventSelected ? `<p class="notice">${t.noTypes}</p>` : ""}
      ${statusKnown && !status.serviceAvailable ? `<p class="notice" role="status">${t.serviceUnavailable}</p>` : ""}
      <footer>${t.footer}</footer>`;
    this.updateTemplatePreview();
    this.updateTemplateSaveStatus();
    const restoredBarkKey = this.root.querySelector<HTMLInputElement>("#bark-key");
    if (restoredBarkKey) restoredBarkKey.value = barkKey;
    if (activeBarkKey && restoredBarkKey) {
      restoredBarkKey.focus();
      if (selection && selection.start !== null && selection.end !== null) restoredBarkKey.setSelectionRange(selection.start, selection.end);
    }
    if (activeTemplateField) {
      const replacement = this.root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-template-field="${activeTemplateField}"]`);
      if (replacement) {
        replacement.focus();
        if (selection && selection.start !== null && selection.end !== null) replacement.setSelectionRange(selection.start, selection.end);
      }
    } else if (!activeBarkKey && active) {
      const selector = activePath ? `[data-path="${activePath}"]` : activeAction ? `[data-action="${activeAction}"]` : activeId ? `#${activeId}` : null;
      this.root.querySelector<HTMLElement>(selector ?? "[data-no-focus-target]")?.focus();
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
  void initAppearance();
  const controller = new NotificationSettingsController(root, api);
  void invoke<NotificationLocale>("get_app_locale").then((locale) => controller.init(locale)).catch(() => controller.init("zh-CN"));
  void listen<NotificationLocale>("locale-changed", (event) => controller.setLocale(event.payload));
  void listen<NotificationStatus>("notification-status-changed", (event) => controller.setStatus(event.payload));
  void listen("notification-diagnostics-changed", () => { void controller.refreshDiagnostics(); });
}

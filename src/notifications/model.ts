import type { NotificationLocale } from "./i18n";
import type { DiagnosticEntry, NotificationApi, NotificationSettings, NotificationStatus } from "./api";

export type TemplateEvent = "permission" | "question" | "completed" | "error" | "quota80" | "quota50" | "quota20" | "quota0" | "recovered";
export const templateEvents: TemplateEvent[] = ["permission", "question", "completed", "error", "quota80", "quota50", "quota20", "quota0", "recovered"];
export type NotificationFeedback = "testSending" | "testSuccess" | "testQuietSkipped" | "testFailure" | "testRejected" | "testUnsent" | "testAmbiguous" | "invalidKey" | "saveFailure" | "settingsFailure" | "keySavedRefreshFailed" | "keyDeletedRefreshFailed";
type Template = { title: string; body: string };
type PendingTemplate = Template | null;
const storageKey = "vibe-coding-light.notification-template-drafts.v1";

function readPendingTemplates(): Record<string, PendingTemplate> {
  const entries: Record<string, PendingTemplate> = Object.create(null);
  try {
    const raw = localStorage.getItem(storageKey);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return entries;
    for (const [key, value] of Object.entries(parsed)) {
      const [locale, event, extra] = key.split(".");
      if (extra || (locale !== "zh-CN" && locale !== "en") || !templateEvents.includes(event as TemplateEvent)) continue;
      if (value === null) entries[key] = null;
      else if (value && typeof value === "object" && !Array.isArray(value)) {
        const draft = value as Record<string, unknown>;
        if (typeof draft.title === "string" && draft.title.length <= 120 && typeof draft.body === "string" && draft.body.length <= 2000) entries[key] = { title: draft.title, body: draft.body };
      }
    }
  } catch { /* Local storage can be disabled; server saves still work. */ }
  return entries;
}
function writePendingTemplates(entries: Record<string, PendingTemplate>): boolean {
  try {
    if (Object.keys(entries).length) localStorage.setItem(storageKey, JSON.stringify(entries));
    else localStorage.removeItem(storageKey);
    return true;
  } catch { return false; }
}

export interface NotificationViewState {
  locale: NotificationLocale;
  settings: NotificationSettings | null;
  loadFailed: boolean;
  status: NotificationStatus | null;
  statusLoading: boolean;
  statusRefreshFailed: boolean;
  diagnostics: DiagnosticEntry[];
  diagnosticsLoading: boolean;
  diagnosticsRefreshFailed: boolean;
  feedback: NotificationFeedback | null;
  installFeedback: string;
  installingSources: ReadonlySet<string>;
  quietError: boolean;
  selectedEvent: TemplateEvent;
  templateSaveState: "idle" | "saving" | "saved" | "failed";
  templateDrafts: Readonly<Record<string, PendingTemplate>>;
}

export class NotificationSettingsModel {
  private snapshot: NotificationViewState = {
    locale: "zh-CN", settings: null, loadFailed: false, status: null, statusLoading: false, statusRefreshFailed: false,
    diagnostics: [], diagnosticsLoading: false, diagnosticsRefreshFailed: false, feedback: null,
    installFeedback: "", installingSources: new Set(), quietError: false, selectedEvent: "permission", templateSaveState: "idle", templateDrafts: {},
  };
  private listeners = new Set<() => void>();
  private persisted: NotificationSettings | null = null;
  private pending = readPendingTemplates();
  private dirty = new Set<string>();
  private reset = new Set<string>();
  private revisions: Record<string, number> = Object.create(null);
  private templateTimer: ReturnType<typeof setTimeout> | null = null;
  private saveQueue: Promise<void> = Promise.resolve();
  private saveRevision = 0;
  private statusRevision = 0;
  private diagnosticRevision = 0;
  private initGeneration = 0;
  private localeOverridden = false;
  private disposed = false;
  constructor(private readonly api: NotificationApi) {}
  getSnapshot = (): NotificationViewState => this.snapshot;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private publish(patch: Partial<NotificationViewState>): void {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
  dispose(): void { this.disposed = true; if (this.templateTimer) clearTimeout(this.templateTimer); this.listeners.clear(); }
  setLocale(locale: NotificationLocale): void { this.localeOverridden = true; this.publish({ locale }); }
  setStatus(status: NotificationStatus): void { this.statusRevision++; this.publish({ status, statusLoading: false, statusRefreshFailed: false }); }
  setDiagnostics(diagnostics: DiagnosticEntry[]): void { this.diagnosticRevision++; this.publish({ diagnostics, diagnosticsLoading: false, diagnosticsRefreshFailed: false }); }

  async init(locale: NotificationLocale): Promise<void> {
    const generation = ++this.initGeneration;
    if (!this.localeOverridden) this.publish({ locale });
    const statusRevision = this.statusRevision;
    const diagnosticRevision = this.diagnosticRevision;
    this.publish({ statusLoading: true, diagnosticsLoading: true, loadFailed: false });
    void this.api.getStatus().then((status) => {
      if (generation === this.initGeneration && statusRevision === this.statusRevision) this.setStatus(status);
    }, () => {
      if (generation === this.initGeneration && statusRevision === this.statusRevision) this.publish({ statusLoading: false, statusRefreshFailed: true });
    });
    void this.api.getDiagnostics().then((diagnostics) => {
      if (generation === this.initGeneration && diagnosticRevision === this.diagnosticRevision) this.setDiagnostics(diagnostics);
    }, () => {
      if (generation === this.initGeneration && diagnosticRevision === this.diagnosticRevision) this.publish({ diagnosticsLoading: false, diagnosticsRefreshFailed: true });
    });
    try {
      const settings = await this.api.getSettings();
      if (generation !== this.initGeneration || this.disposed) return;
      this.persisted = structuredClone(settings);
      const drafts: Record<string, PendingTemplate> = { ...this.snapshot.templateDrafts };
      for (const [key, draft] of Object.entries(this.pending)) { this.dirty.add(key); if (draft === null) this.reset.add(key); drafts[key] = draft; }
      this.publish({ settings, templateDrafts: drafts, templateSaveState: this.dirty.size ? "saving" : "idle" });
      if (this.dirty.size) void this.flushTemplates();
    } catch { if (generation === this.initGeneration) this.publish({ loadFailed: true }); }
  }

  async refreshStatus(): Promise<void> {
    const revision = this.statusRevision;
    this.publish({ statusLoading: true });
    try { const status = await this.api.getStatus(); if (revision === this.statusRevision) this.setStatus(status); }
    catch { if (revision === this.statusRevision) this.publish({ statusLoading: false, statusRefreshFailed: true }); }
  }
  async refreshDiagnostics(): Promise<void> {
    const revision = this.diagnosticRevision;
    this.publish({ diagnosticsLoading: true });
    try { const diagnostics = await this.api.getDiagnostics(); if (revision === this.diagnosticRevision) this.setDiagnostics(diagnostics); }
    catch { if (revision === this.diagnosticRevision) this.publish({ diagnosticsLoading: false, diagnosticsRefreshFailed: true }); }
  }
  async clearDiagnostics(): Promise<void> {
    try { await this.api.clearDiagnostics(); this.publish({ diagnostics: [], diagnosticsRefreshFailed: false, feedback: null }); }
    catch { this.publish({ feedback: "settingsFailure" }); }
  }

  private queueSave(next: NotificationSettings, template: boolean): Promise<boolean> {
    const revision = ++this.saveRevision;
    const operation = this.saveQueue.then(async () => {
      try {
        const saved = await this.api.setSettings(next);
        this.persisted = structuredClone(saved);
        if (revision === this.saveRevision) this.publish({ settings: saved, feedback: null });
        return true;
      } catch {
        if (revision === this.saveRevision) this.publish({ settings: structuredClone(this.persisted ?? next), feedback: template ? null : "settingsFailure" });
        return false;
      }
    });
    this.saveQueue = operation.then(() => {});
    return operation;
  }
  async setPath(path: string, value: boolean | number): Promise<boolean> {
    const current = this.snapshot.settings;
    if (!current) return false;
    const next = structuredClone(current);
    const keys = path.split(".");
    if (keys.length === 1 && (keys[0] === "enabled" || keys[0] === "include_details") && typeof value === "boolean") next[keys[0]] = value;
    else if (keys.length === 2 && keys[0] === "quiet_hours" && keys[1] === "enabled" && typeof value === "boolean") next.quiet_hours.enabled = value;
    else if (keys.length === 2 && keys[0] === "quiet_hours" && (keys[1] === "start_minute" || keys[1] === "end_minute") && typeof value === "number") {
      if (!Number.isInteger(value) || value < 0 || value > 1439) { this.publish({ quietError: true }); return false; }
      next.quiet_hours[keys[1]] = value;
      if (next.quiet_hours.start_minute === next.quiet_hours.end_minute) { this.publish({ quietError: true }); return false; }
      this.publish({ quietError: false });
    } else if (keys.length === 3 && keys[0] === "quiet_hours" && keys[1] === "bypass" && keys[2] in next.quiet_hours.bypass && typeof value === "boolean") next.quiet_hours.bypass[keys[2] as keyof typeof next.quiet_hours.bypass] = value;
    else if (keys.length === 2 && (keys[0] === "sources" || keys[0] === "events" || keys[0] === "quota") && typeof value === "boolean") {
      const group = next[keys[0]] as unknown as Record<string, boolean>;
      if (!(keys[1] in group)) return false;
      group[keys[1]] = value;
    } else return false;
    this.publish({ settings: next, feedback: null });
    return this.queueSave(next, false);
  }

  async saveKey(key: string): Promise<boolean> {
    const trimmed = key.trim();
    if (!trimmed) return false;
    try {
      await this.api.saveKey(trimmed);
      if (this.snapshot.status) this.publish({ status: { ...this.snapshot.status, keySaved: true } });
      try { await this.refreshStatus(); this.publish({ feedback: this.snapshot.statusRefreshFailed ? "keySavedRefreshFailed" : null }); }
      catch { this.publish({ feedback: "keySavedRefreshFailed" }); }
      return true;
    } catch (error) { this.publish({ feedback: error === "Invalid Bark device key" ? "invalidKey" : "saveFailure" }); return false; }
  }
  async deleteKey(): Promise<void> {
    try {
      await this.api.deleteKey();
      if (this.snapshot.status) this.publish({ status: { ...this.snapshot.status, keySaved: false } });
      await this.refreshStatus();
      this.publish({ feedback: this.snapshot.statusRefreshFailed ? "keyDeletedRefreshFailed" : null });
    } catch { this.publish({ feedback: "saveFailure" }); }
  }
  async installHook(source: string, successText: string, refreshFailureText: string, failureText: string): Promise<void> {
    if (this.snapshot.installingSources.has(source)) return;
    this.publish({ installingSources: new Set([...this.snapshot.installingSources, source]) });
    try {
      await this.api.installHooks(source);
      const field = ({ cursor: "cursorHooksInstalled", trae: "traeHooksInstalled", grok: "grokHooksInstalled", deepseek: "deepseekHooksPrepared" } as const)[source as "cursor" | "trae" | "grok" | "deepseek"];
      if (this.snapshot.status && field) this.publish({ status: { ...this.snapshot.status, [field]: true } });
      await this.refreshStatus();
      this.publish({ installFeedback: successText + (this.snapshot.statusRefreshFailed ? ` · ${refreshFailureText}` : "") });
    } catch (error) { this.publish({ installFeedback: `${failureText}: ${String(error)}` }); }
    finally { const sources = new Set(this.snapshot.installingSources); sources.delete(source); this.publish({ installingSources: sources }); }
  }

  getTemplate(event: TemplateEvent, locale = this.snapshot.locale): Template {
    const key = `${locale}.${event}`;
    const draft = this.snapshot.templateDrafts[key];
    if (draft === null) return { title: "", body: "" };
    return draft ?? this.snapshot.settings?.templates[key] ?? { title: "", body: "" };
  }
  selectTemplateEvent(event: TemplateEvent): void { if (templateEvents.includes(event)) { void this.flushTemplates(); this.publish({ selectedEvent: event }); } }
  editTemplate(event: TemplateEvent, field: "title" | "body", value: string): void {
    if (!this.snapshot.settings) return;
    const key = `${this.snapshot.locale}.${event}`;
    const draft = { ...this.getTemplate(event), [field]: value };
    const drafts = { ...this.snapshot.templateDrafts, [key]: draft };
    this.dirty.add(key); this.reset.delete(key); this.pending[key] = draft;
    this.revisions[key] = (this.revisions[key] ?? 0) + 1;
    const stored = writePendingTemplates(this.pending);
    this.publish({ templateDrafts: drafts, templateSaveState: stored ? "saving" : "failed" });
    if (this.templateTimer) clearTimeout(this.templateTimer);
    this.templateTimer = setTimeout(() => { void this.flushTemplates(); }, 250);
  }
  resetTemplate(event: TemplateEvent): void {
    if (!this.snapshot.settings) return;
    const key = `${this.snapshot.locale}.${event}`;
    this.dirty.add(key); this.reset.add(key); this.pending[key] = null;
    this.revisions[key] = (this.revisions[key] ?? 0) + 1;
    writePendingTemplates(this.pending);
    this.publish({ templateDrafts: { ...this.snapshot.templateDrafts, [key]: null }, templateSaveState: "saving" });
    void this.flushTemplates();
  }
  async flushTemplates(): Promise<void> {
    if (this.templateTimer) clearTimeout(this.templateTimer);
    this.templateTimer = null;
    if (!this.snapshot.settings || !this.dirty.size) return;
    const keys = [...this.dirty];
    const revisions = keys.map((key) => this.revisions[key] ?? 0);
    this.dirty.clear();
    const next = structuredClone(this.snapshot.settings);
    for (const key of keys) {
      if (this.reset.has(key)) delete next.templates[key];
      else { const draft = this.snapshot.templateDrafts[key]; if (draft) next.templates[key] = { ...draft }; }
    }
    this.publish({ settings: next, templateSaveState: "saving" });
    const saved = await this.queueSave(next, true);
    for (const [index, key] of keys.entries()) {
      if ((this.revisions[key] ?? 0) !== revisions[index]) continue;
      if (!saved) this.dirty.add(key);
      else { this.reset.delete(key); delete this.pending[key]; }
    }
    if (saved) writePendingTemplates(this.pending);
    this.publish({ templateSaveState: saved && this.dirty.size === 0 ? "saved" : saved ? "saving" : "failed" });
  }
}

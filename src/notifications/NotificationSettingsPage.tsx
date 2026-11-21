import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "../ui/boardui/components/base/buttons/button";
import { Input } from "../ui/boardui/components/base/input/input";
import { Select, SelectItem } from "../ui/boardui/components/base/select/select";
import { Switch } from "../ui/boardui/components/base/switch/switch";
import { Textarea } from "../ui/boardui/components/base/textarea/textarea";
import { notificationCopy } from "./i18n";
import { templateEvents, type NotificationFeedback, type NotificationSettingsModel, type TemplateEvent } from "./model";
import type { DiagnosticEntry, NotificationSettings } from "./api";
import "../ui/boardui.css";
import "./NotificationSettingsPage.css";

type Copy = ReturnType<typeof notificationCopy>;
const sourceKeys = ["claude", "codex", "cursor", "trae", "grok", "deepseek"] as const;
const eventKeys = ["permission", "question", "completed", "error"] as const;
const quotaKeys = ["at80", "at50", "at20", "at0", "at_week0", "recovered"] as const;
const bypassKeys = ["permission", "question", "completed", "error", "quota"] as const;
const labelForTemplate = (event: TemplateEvent, copy: Copy) => ({
  permission: copy.templatePermission, question: copy.templateQuestion, completed: copy.templateCompleted, error: copy.templateError,
  quota80: copy.templateQuota80, quota50: copy.templateQuota50, quota20: copy.templateQuota20, quota0: copy.templateQuota0, recovered: copy.templateRecovered,
})[event];
const labelForQuota = (quota: typeof quotaKeys[number], copy: Copy) => ({ at80: copy.at80, at50: copy.at50, at20: copy.at20, at0: copy.at0, at_week0: copy.atWeek0, recovered: copy.recovered })[quota];
function timeValue(minutes: number): string { return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`; }
function minutes(value: string): number | null { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null; const [hour, minute] = value.split(":").map(Number); return hour * 60 + minute; }
function defaultBody(event: TemplateEvent, locale: "zh-CN" | "en"): string {
  const zh = locale === "zh-CN";
  if (event === "permission") return zh ? "{source} · 等待权限批准" : "{source} · Permission approval needed";
  if (event === "question") return zh ? "{source} · 等待回答问题" : "{source} · Answer needed";
  if (event === "completed") return zh ? "{source} · 本轮回复完成" : "{source} · Current turn completed";
  if (event === "error") return zh ? "{source} · 执行遇到错误" : "{source} · Execution encountered an error";
  if (event === "recovered") return zh ? "{source} · {period}额度已恢复" : "{source} · {period} quota recovered";
  return zh ? "{source} · {period}额度剩余 {remaining}" : "{source} · {period} quota {remaining} remaining";
}
function previewText(title: string, body: string, event: TemplateEvent, settings: NotificationSettings, copy: Copy, locale: "zh-CN" | "en") {
  const sample = { source: "Codex", task: copy.sampleTask, command: "npm test", error: copy.sampleError, reply: copy.sampleReply,
    question: copy.sampleQuestion, period: locale === "zh-CN" ? "5 小时" : "5 hours", remaining: "20%" };
  const detail = event === "permission" ? sample.command : event === "question" ? sample.question : event === "completed" ? sample.task : event === "error" ? sample.error : "";
  const values: Record<string, string> = { ...sample, detail };
  if (!settings.include_details) for (const key of ["task", "command", "error", "reply", "question", "detail"]) values[key] = "";
  const render = (value: string) => value.replace(/\{(source|task|command|error|reply|question|detail|period|remaining)\}/g, (_match, key: string) => values[key] ?? "");
  const fallback = defaultBody(event, locale);
  return { title: render(title || "Vibe Coding Light"), body: render(body || (values.detail ? `${fallback}\n${values.detail}` : fallback)) };
}
function diagnosticLabel(entry: DiagnosticEntry, copy: Copy) {
  const sources: Record<string, string> = { claude: copy.claude, codex: copy.codex, cursor: copy.cursor, trae: copy.trae, grok: copy.grok, deepseek: copy.deepseek };
  const kinds: Record<string, string> = { permission: copy.permission, question: copy.question, completed: copy.completed, error: copy.error, quota80: copy.at80, quota50: copy.at50, quota20: copy.at20, quota0: copy.at0, quota_week0: copy.atWeek0, recovered: copy.recovered, working: copy.diagnosticWorking, test: copy.test };
  const reasons: Record<string, string> = { notifications_disabled: copy.diagnosticNotificationsDisabled, state_only: copy.diagnosticStateOnly, duplicate: copy.diagnosticDuplicate, expired: copy.diagnosticExpired, source_disabled: copy.diagnosticSourceDisabled, type_disabled: copy.diagnosticTypeDisabled, cooldown: copy.diagnosticCooldown, quiet_hours: copy.diagnosticQuietHours, superseded: copy.diagnosticSuperseded, key_missing: copy.diagnosticKeyMissing, rejected: copy.diagnosticRejected, network: copy.diagnosticNetwork, unconfirmed: copy.diagnosticUnconfirmed };
  const outcome: Record<DiagnosticEntry["outcome"], string> = { observed: copy.diagnosticObserved, deferred: copy.diagnosticDeferred, sent: copy.diagnosticSent, skipped: copy.diagnosticSkipped, failed: copy.diagnosticFailed };
  const kind = entry.kind.startsWith("test_") ? `${copy.testTag} · ${kinds[entry.kind.slice(5)] ?? entry.kind.slice(5)}` : kinds[entry.kind] ?? entry.kind;
  return { source: entry.source ? sources[entry.source] ?? copy.diagnosticApp : copy.diagnosticApp, kind, reason: entry.reason ? reasons[entry.reason] ?? entry.reason : "", outcome: outcome[entry.outcome] };
}
function sendErrorFeedback(error: string | null | undefined): NotificationFeedback | null {
  if (error === "Invalid Bark device key") return "invalidKey";
  if (error === "Bark send failed: Rejected") return "testRejected";
  if (error === "Bark send failed: Unsent") return "testUnsent";
  if (error === "Bark send failed: Ambiguous") return "testAmbiguous";
  return error ? "testFailure" : null;
}

function Section({ id, index, title, hint, children }: { id: string; index: string; title: string; hint?: string; children: React.ReactNode }) {
  return <section id={id} className="notification-card"><div className="notification-section-heading"><span className="notification-index">{index}</span><h2>{title}</h2></div>{hint && <p className="notification-hint">{hint}</p>}{children}</section>;
}

export function NotificationSettingsPage({ model }: { model: NotificationSettingsModel }) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const copy = notificationCopy(state.locale);
  useEffect(() => {
    document.documentElement.lang = state.locale;
    document.title = `${copy.title} · Vibe Coding Light`;
  }, [state.locale, copy.title]);
  const [keyDraft, setKeyDraft] = useState("");
  const [section, setSection] = useState("connection");
  const settings = state.settings;
  const statusLabel = state.statusLoading ? copy.statusLoading : state.status === null ? copy.statusUnknown : state.status.keySaved ? copy.keySaved : copy.keyMissing;
  const statusKnown = state.status !== null;
  const saveKey = async () => { if (await model.saveKey(keyDraft)) setKeyDraft(""); };
  const toggle = (path: string, label: string, value: boolean) => <Switch className="notification-switch" isSelected={value} onChange={(selected) => { void model.setPath(path, selected); }}>{label}</Switch>;
  const sectionItems = [
    ["connection", copy.connection], ["sources", copy.sources], ["events", copy.events], ["quotas", copy.quotas],
    ["quiet", copy.quietTitle], ["templates", copy.templatesTitle], ["diagnostics", copy.diagnosticsTitle],
  ] as const;
  const goto = (id: string) => { setSection(id); document.getElementById(id)?.scrollIntoView?.({ block: "start", behavior: "smooth" }); };
  if (state.loadFailed || !settings) return <div className="notification-load"><h1>{copy.title}</h1><p>{state.loadFailed ? copy.loadFailed : copy.statusLoading ? copy.statusLoading : "…"}</p>{state.loadFailed && <Button onClick={() => { void model.init(state.locale); }}>{copy.loadRetry}</Button>}</div>;
  const template = model.getTemplate(state.selectedEvent);
  const preview = previewText(template.title, template.body, state.selectedEvent, settings, copy, state.locale);
  const eventSelected = Object.values(settings.events).some(Boolean) || Object.values(settings.quota).some(Boolean);
  const statusPlaceholder = state.statusLoading ? copy.statusLoading : copy.statusUnknown;
  const sourceStatus = (source: typeof sourceKeys[number]) => {
    if (!statusKnown) return statusPlaceholder;
    if (source === "deepseek") return state.status!.deepseekHooksPrepared ? copy.deepseekPrepared : copy.deepseekNeedsBridge;
    const field = `${source}HooksInstalled` as keyof NonNullable<typeof state.status>;
    return state.status![field] ? copy.hooksInstalled : copy.hooksMissing;
  };
  const feedback = state.feedback ?? sendErrorFeedback(state.status?.lastSendError);
  return <>
    <header className="notification-head"><p className="notification-eyebrow">VIBE CODING LIGHT / NOTIFICATIONS</p><h1>{copy.title}</h1><p>{copy.intro}</p></header>
    <div className="notification-shell">
      <nav className="notification-nav" aria-label={copy.title}>{sectionItems.map(([id, title]) => <Button key={id} variant={section === id ? "secondary" : "ghost"} className={section === id ? "active" : ""} onClick={() => goto(id)}>{title}</Button>)}</nav>
      <div className="notification-content">
        <div className="notification-master"><div><h2>{copy.master}</h2><p>{copy.masterHint}</p></div>{toggle("enabled", copy.master, settings.enabled)}</div>
        {state.feedback === "settingsFailure" && <p className="notification-error" role="alert">{copy.settingsFailure}</p>}
        {state.statusRefreshFailed && <div className="notification-notice" role="status"><span id="status-refresh-error">{copy.statusInitialFailure}</span><Button variant="secondary" disabled={state.statusLoading} onClick={() => { void model.refreshStatus(); }}>{copy.statusRetry}</Button></div>}
        <Section id="connection" index="01" title={copy.connection}>
          <p className={`notification-pill ${state.status?.keySaved ? "good" : ""}`}>{statusLabel}</p>
          <div className="notification-key-row"><Input label={copy.key} type="password" autoComplete="off" value={keyDraft} onChange={setKeyDraft} placeholder={copy.keyPlaceholder} className="notification-key-input" /><Button id="save-key" onClick={saveKey}>{copy.saveKey}</Button></div>
          <Button variant="ghost" disabled={!state.status?.keySaved} onClick={() => { void model.deleteKey(); }}>{copy.deleteKey}</Button>
          <p id="feedback" role="status" className={feedback ? "notification-error-text" : ""}>{feedback ? copy[feedback] : ""}</p>
        </Section>
        <Section id="sources" index="02" title={copy.sources} hint={copy.sourceHint}>
          <div className="notification-source-list">{sourceKeys.map((source) => <div className="notification-source-row" key={source}>{toggle(`sources.${source}`, copy[source], settings.sources[source])}<span className="notification-availability">{sourceStatus(source)}</span>{source === "claude" || source === "codex" ? <span aria-hidden="true" /> : <Button variant="secondary" size="small" disabled={state.installingSources.has(source)} onClick={() => { void model.installHook(source, source === "deepseek" ? copy.deepseekPrepared : copy.installSuccess, copy.statusRefreshFailed, copy.installFailed); }}>{copy.installHook}</Button>}</div>)}</div>
          <p className="notification-hint">{copy.extraSourceHint}</p><p role="status" className="notification-availability">{state.installFeedback}</p>
        </Section>
        <Section id="events" index="03" title={copy.events} hint={copy.eventHint}>
          <div className="notification-switch-list">{eventKeys.map((event) => <div key={event}>{toggle(`events.${event}`, copy[event], settings.events[event])}</div>)}</div><p className="notification-hint notification-note">{copy.codexQuestionHint}</p>
        </Section>
        <Section id="quotas" index="04" title={copy.quotas} hint={copy.quotaHint}>
          <div className="notification-quota-status"><span>{copy.claudeQuota}</span><strong id="claude-quota-status">{!statusKnown ? statusPlaceholder : state.status!.claudeQuotaAvailable ? copy.quotaAvailable : copy.quotaUnavailable}</strong></div>
          <div className="notification-quota-status"><span>{copy.codexQuota}</span><strong id="codex-quota-status">{!statusKnown ? statusPlaceholder : state.status!.codexQuotaAvailable ? copy.quotaAvailable : copy.quotaUnavailable}</strong></div>
          <div className="notification-period"><h3>{state.locale === "zh-CN" ? "额度档位" : "Quota levels"}</h3>{quotaKeys.filter((key) => key !== "at_week0").map((key) => <div key={key}>{toggle(`quota.${key}`, labelForQuota(key, copy), settings.quota[key])}</div>)}</div>
          <div className="notification-period"><h3>{state.locale === "zh-CN" ? "7 天周期" : "7-day period"}</h3>{toggle("quota.at_week0", copy.atWeek0, settings.quota.at_week0)}</div>
        </Section>
        <Section id="quiet" index="05" title={copy.quietTitle} hint={copy.quietHint}>
          {toggle("quiet_hours.enabled", copy.quietEnabled, settings.quiet_hours.enabled)}
          <div className="notification-times"><label>{copy.quietStart}<input type="time" value={timeValue(settings.quiet_hours.start_minute)} onChange={(event) => { const next = minutes(event.target.value); if (next !== null) void model.setPath("quiet_hours.start_minute", next); }} /></label><label>{copy.quietEnd}<input type="time" value={timeValue(settings.quiet_hours.end_minute)} onChange={(event) => { const next = minutes(event.target.value); if (next !== null) void model.setPath("quiet_hours.end_minute", next); }} /></label></div>
          {state.quietError && <p className="notification-error-text" role="alert">{copy.quietInvalid}</p>}
          <p className="notification-hint notification-bypass-heading">{copy.quietBypass}</p><div className="notification-switch-list">{bypassKeys.map((key) => <div key={key}>{toggle(`quiet_hours.bypass.${key}`, key === "quota" ? copy.quotas : copy[key], settings.quiet_hours.bypass[key])}</div>)}</div>
        </Section>
        <Section id="templates" index="06" title={copy.templatesTitle} hint={copy.templatesHint}>
          {toggle("include_details", copy.detailsToggle, settings.include_details)}<p className="notification-detail-hint">{copy.detailsHint}</p>
          <Select label={copy.templateEvent} selectedKey={state.selectedEvent} onSelectionChange={(key) => model.selectTemplateEvent(key as TemplateEvent)} className="notification-template-event">{templateEvents.map((event) => <SelectItem key={event} id={event}>{labelForTemplate(event, copy)}</SelectItem>)}</Select>
          <Input label={copy.templateTitle} value={template.title} onChange={(value) => model.editTemplate(state.selectedEvent, "title", value)} maxLength={120} placeholder="Vibe Coding Light" />
          <Textarea label={copy.templateBody} value={template.body} onChange={(value) => model.editTemplate(state.selectedEvent, "body", value)} maxLength={2000} rows={3} placeholder={defaultBody(state.selectedEvent, state.locale)} />
          <p className="notification-hint">{copy.templateTokens}</p><div className="notification-template-actions"><Button variant="secondary" onClick={() => model.resetTemplate(state.selectedEvent)}>{copy.templateReset}</Button><span id="template-save-status" role="status" className={state.templateSaveState === "failed" ? "notification-error-text" : ""}>{state.templateSaveState === "saving" ? copy.templateSaving : state.templateSaveState === "saved" ? copy.templateSaved : state.templateSaveState === "failed" ? copy.templateSaveFailed : ""}</span>{state.templateSaveState === "failed" && <Button variant="secondary" onClick={() => { void model.flushTemplates(); }}>{copy.templateRetry}</Button>}</div>
          <div className="notification-template-preview"><span>{copy.templatePreview}</span><strong>{preview.title}</strong><p>{preview.body}</p></div>
        </Section>
        <Section id="diagnostics" index="07" title={copy.diagnosticsTitle} hint={copy.diagnosticsHint}>
          {state.diagnosticsRefreshFailed && <div className="notification-notice"><span id="diagnostics-refresh-error">{copy.diagnosticsRefreshFailed}</span><Button variant="secondary" onClick={() => { void model.refreshDiagnostics(); }}>{copy.diagnosticsRetry}</Button></div>}
          <div className="notification-diagnostic-actions"><Button variant="secondary" disabled={!state.diagnostics.length} onClick={() => { void model.clearDiagnostics(); }}>{copy.diagnosticsClear}</Button></div>
          {state.diagnostics.length ? <ol className="notification-diagnostics-list">{[...state.diagnostics].reverse().map((entry, index) => { const label = diagnosticLabel(entry, copy); return <li key={`${entry.atMs}-${index}`}><time>{new Date(entry.atMs).toLocaleString(state.locale)}</time><strong>{label.source} · {label.kind}</strong><span>{label.outcome}</span>{label.reason && <small>{label.reason}</small>}</li>; })}</ol> : <p className="notification-hint">{state.diagnosticsLoading ? copy.diagnosticsLoading : copy.diagnosticsEmpty}</p>}
        </Section>
        {!eventSelected && <p className="notification-notice">{copy.noTypes}</p>}
        {statusKnown && !state.status!.serviceAvailable && <p className="notification-notice" role="status">{copy.serviceUnavailable}</p>}
        <footer>{copy.footer}</footer>
      </div>
    </div>
  </>;
}

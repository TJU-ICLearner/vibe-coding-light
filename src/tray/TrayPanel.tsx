import { useEffect, useSyncExternalStore } from "react";
import { appearanceLabel, themeIds } from "../appearance";
import { Button } from "../ui/boardui/components/base/buttons/button";
import { Select, SelectItem } from "../ui/boardui/components/base/select/select";
import { Switch } from "../ui/boardui/components/base/switch/switch";
import { Tab, TabList, TabPanel, Tabs } from "../ui/boardui/components/base/tabs/tabs";
import { type TrayPanelModel, type TrayTab } from "./model";
import "../ui/boardui.css";
import "./TrayPanel.css";

const agents = ["claude", "codex", "cursor", "trae", "grok", "deepseek"] as const;
export function TrayPanel({ model }: { model: TrayPanelModel }) {
  const view = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const state = view.state;
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") void model.hide(); };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [model]);
  if (!state) return <div className="tray-loading" role="status">Vibe Coding Light</div>;
  const zh = state.locale === "zh-CN";
  const action = (id: string, label: string, disabled = false, extra = "") => <Button data-action={id} variant="ghost" className={`tray-action ${extra}`} disabled={disabled || view.pending} onClick={() => { void model.performAction(id); }}>{label}<span aria-hidden="true">›</span></Button>;
  const toggle = (id: string, label: string, selected: boolean, disabled = false) => <Switch data-action={id} className="tray-switch" isSelected={selected} isDisabled={disabled || view.pending} onChange={() => { void model.performAction(id); }}>{label}</Switch>;
  const agentNames: Record<string, string> = { claude: "Claude Code", codex: "Codex", cursor: "Cursor", trae: zh ? "TRAE（中国版）" : "TRAE China", grok: "Grok Build", deepseek: "DeepSeek Harness" };
  const agentStatus = (id: string) => !state.notificationServiceAvailable ? zh ? "状态不可用" : "Status unavailable" : !state.agentHooks[id] ? zh ? "未接入" : "Not connected" : id === "deepseek" ? zh ? "桥接待挂载" : "Bridge pending" : !state.agentSources[id] || !state.notificationEnabled ? zh ? "已暂停" : "Paused" : zh ? "已接入" : "Connected";
  const barkStatus = !state.notificationServiceAvailable ? zh ? "不可用" : "Unavailable" : !state.barkKeySaved ? zh ? "未配置" : "Not configured" : !state.notificationEnabled ? zh ? "已暂停" : "Paused" : state.barkSendFailed ? zh ? "上次发送失败" : "Last send failed" : zh ? "已开启" : "On";
  const currentTheme = state.appearance.followSystem ? window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "system_dark" : "system_light" : state.appearance.manualTheme;
  return <>
    <header className="tray-head"><span className="tray-kicker">VIBE CODING LIGHT</span><strong>{zh ? "快捷控制" : "Quick controls"}</strong></header>
    <Tabs selectedKey={view.tab} onSelectionChange={(key) => model.setTab(key as TrayTab)} aria-label={zh ? "菜单页面" : "Menu pages"} className="tray-tabs">
      <TabList className="tray-nav" aria-label={zh ? "菜单页面" : "Menu pages"}><Tab id="overview">{zh ? "概览" : "Overview"}</Tab><Tab id="agents">{zh ? "Agent 接入" : "Agent setup"}</Tab><Tab id="settings">{zh ? "设置" : "Settings"}</Tab></TabList>
      <TabPanel id="overview" className="tray-tab-panel">
        <section className="tray-current"><span className="tray-label">{zh ? "当前会话" : "CURRENT SESSION"}</span><strong>{state.sessions[0] ?? (zh ? "暂无活跃会话" : "No active session")}</strong></section>
        <section className="tray-section"><h2>{zh ? "桌宠" : "Desktop pet"}</h2>{toggle("toggle_pet", state.togglePetLabel, state.petVisible)}<div className="tray-actions">{action("pet_action", state.petActionLabel, !state.petVisible)}{action("customize_pet", state.customizePetLabel)}</div></section>
        <section className="tray-section"><h2>{zh ? "最近会话" : "Recent sessions"}</h2><ul className="tray-sessions">{state.sessions.length > 1 ? state.sessions.slice(1).map((session, index) => <li key={index}>{session}</li>) : <li>{zh ? "暂无其他会话" : "No other sessions"}</li>}</ul></section>
        <section className="tray-section"><h2>{zh ? "通知" : "Notifications"}</h2><div className="tray-status-line"><span>Bark</span><strong>{barkStatus}</strong></div>{action("notification_settings", state.notificationSettingsLabel)}</section>
      </TabPanel>
      <TabPanel id="agents" className="tray-tab-panel">
        <section className="tray-section tray-agent-intro"><h2>{zh ? "Agent 接入" : "Agent setup"}</h2><p className="tray-section-hint">{zh ? "安装 Hook 后，到通知设置中开启对应来源。" : "Install a Hook, then enable its source in Notification Settings."}</p></section>
        <section className="tray-agent-list">{agents.map((id) => <article className="tray-agent" key={id}><div><strong>{agentNames[id]}</strong><span className={state.agentHooks[id] && state.agentSources[id] && state.notificationEnabled ? "ready" : ""}>{agentStatus(id)}</span></div><Button variant="secondary" size="small" data-action={`setup_${id}`} disabled={view.pending} onClick={() => { void model.performAction(`setup_${id}`); }}>{id === "deepseek" ? zh ? "准备 Hook" : "Prepare Hook" : zh ? "设置 Hook" : "Set up Hook"}</Button></article>)}</section>
        {state.integrationFeedback && <p className="tray-hook-feedback" role="status">{state.integrationFeedback}</p>}
        <section className="tray-section">{action("notification_settings", state.notificationSettingsLabel)}</section>
      </TabPanel>
      <TabPanel id="settings" className="tray-tab-panel">
        <section className="tray-section"><h2>{zh ? "外观" : "Appearance"}</h2>{toggle("appearance_follow", zh ? "跟随系统" : "Follow system", state.appearance.followSystem)}<p className="tray-theme-summary">{zh ? "当前使用" : "Current theme"} · {appearanceLabel(currentTheme, state.locale)}</p><div className="tray-theme-grid">{themeIds.map((id) => <Button key={id} variant="secondary" data-action={`appearance_${id}`} className={`theme-choice ${!state.appearance.followSystem && state.appearance.manualTheme === id ? "selected" : ""}`} aria-pressed={!state.appearance.followSystem && state.appearance.manualTheme === id} disabled={view.pending} onClick={() => { void model.performAction(`appearance_${id}`); }}><i className={`theme-swatch swatch-${id}`} aria-hidden="true" /><span>{appearanceLabel(id, state.locale)}</span></Button>)}</div></section>
        <section className="tray-section"><h2>{zh ? "应用" : "App"}</h2><Select data-role="language" label={state.languageTitle} selectedKey={state.locale} onSelectionChange={(key) => { void model.performAction(key === "en" ? "language_en" : "language_zh"); }} isDisabled={view.pending} className="tray-language"><SelectItem id="zh-CN">{state.chineseLabel}</SelectItem><SelectItem id="en">{state.englishLabel}</SelectItem></Select>{toggle("launch_at_login", state.loginLabel, state.loginEnabled, !state.loginAvailable)}{toggle("auto_updates", state.autoUpdatesLabel, state.autoUpdatesEnabled)}{state.autoUpdatesFailed && <p className="tray-error">{zh ? "自动检查设置保存失败" : "Could not save automatic update setting"}</p>}{action("check_updates", state.checkUpdatesLabel, state.updateRunning)}{state.releaseLabel && action("open_release", state.releaseLabel)}</section>
        <section className="tray-section"><h2>{zh ? "更多设置" : "More settings"}</h2>{action("customize_pet", state.customizePetLabel)}{action("notification_settings", state.notificationSettingsLabel)}</section>
        <footer>{action("quit", state.quitLabel, false, "tray-quit")}</footer>
      </TabPanel>
    </Tabs>
    {view.error && <p className="tray-error" role="alert">{zh ? "操作失败，请重试" : "Action failed. Try again."}</p>}
  </>;
}

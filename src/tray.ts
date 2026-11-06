import { invoke } from "@tauri-apps/api/core";
import { applyAppearance, appearanceLabel, initAppearance, themeIds, type Appearance } from "./appearance";
import "./appearance.css";
import "./tray.css";

export interface TrayPanelState {
  locale: "zh-CN" | "en";
  appearance: Appearance;
  notificationEnabled: boolean;
  notificationServiceAvailable: boolean;
  barkKeySaved: boolean;
  barkSendFailed: boolean;
  agentHooks: Record<string, boolean>;
  agentSources: Record<string, boolean>;
  petVisible: boolean;
  togglePetLabel: string;
  petActionLabel: string;
  customizePetLabel: string;
  notificationSettingsLabel: string;
  setupClaudeLabel: string;
  setupCodexLabel: string;
  integrationFeedback: string | null;
  sessionsTitle: string;
  sessions: string[];
  languageTitle: string;
  chineseLabel: string;
  englishLabel: string;
  loginLabel: string;
  loginEnabled: boolean;
  loginAvailable: boolean;
  autoUpdatesLabel: string;
  autoUpdatesEnabled: boolean;
  autoUpdatesFailed: boolean;
  checkUpdatesLabel: string;
  updateRunning: boolean;
  releaseLabel: string | null;
  quitLabel: string;
}

export interface TrayPanelApi {
  getState(): Promise<TrayPanelState>;
  performAction(action: string): Promise<TrayPanelState>;
  hide(): Promise<void>;
}

const api: TrayPanelApi = {
  getState: () => invoke("get_tray_panel_state"),
  performAction: (action) => invoke("perform_tray_panel_action", { action }),
  hide: () => invoke("hide_tray_panel"),
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

export class TrayPanelController {
  private tab: "overview" | "agents" | "settings" = "overview";
  private state: TrayPanelState | null = null;
  private pending = false;
  private error = false;
  private deferredRender = false;

  constructor(private readonly root: HTMLElement, private readonly api: TrayPanelApi) {
    root.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const tab = target.closest<HTMLButtonElement>("button[data-tab]");
      if (tab) { this.tab = tab.dataset.tab as typeof this.tab; this.render(); return; }
      const button = target.closest<HTMLButtonElement>("button[data-action]");
      if (button) void this.runAction(button.dataset.action!);
    });
    root.addEventListener("change", (event) => {
      const target = event.target as HTMLInputElement | HTMLSelectElement;
      if (target.dataset.role === "language") void this.runAction(target.value === "en" ? "language_en" : "language_zh");
      else if (target.dataset.action) void this.runAction(target.dataset.action);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") void this.api.hide();
    });
    root.addEventListener("focusout", (event) => {
      if (this.deferredRender && (event.target as HTMLElement).dataset.role === "language") {
        window.setTimeout(() => {
          if (this.deferredRender && !this.pending && (document.activeElement as HTMLElement)?.dataset.role !== "language") {
            this.deferredRender = false;
            this.render();
          }
        }, 0);
      }
    });
  }

  async init(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (this.pending) return;
    const wasError = this.error;
    try {
      const next = await this.api.getState();
      const changed = JSON.stringify(next) !== JSON.stringify(this.state);
      this.state = next;
      this.error = false;
      if (!changed && !wasError) return;
    } catch {
      this.error = true;
    }
    if ((document.activeElement as HTMLElement)?.dataset.role === "language") {
      this.deferredRender = true;
      return;
    }
    this.render();
  }

  private async runAction(action: string): Promise<void> {
    if (this.pending) return;
    this.pending = true;
    this.error = false;
    try {
      this.state = await this.api.performAction(action);
    } catch {
      this.error = true;
    } finally {
      this.pending = false;
      this.deferredRender = false;
      this.render();
    }
  }

  private render(): void {
    const s = this.state;
    if (!s) return;
    const zh = s.locale === "zh-CN";
    const scroll = this.root.scrollTop;
    const focused = this.root.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    const focusAction = focused?.dataset.action;
    const focusRole = focused?.dataset.role;
    document.documentElement.lang = s.locale;
    if (window.matchMedia) applyAppearance(s.appearance, window.matchMedia("(prefers-color-scheme: dark)").matches);
    const button = (action: string, label: string, extra = "") => `<button type="button" class="tray-row ${extra}" data-action="${action}" ${this.pending ? "disabled" : ""}>${escapeHtml(label)}<span aria-hidden="true">›</span></button>`;
    const toggle = (action: string, label: string, checked: boolean, disabled = false) => `<label class="tray-toggle"><span>${escapeHtml(label)}</span><input type="checkbox" data-action="${action}" aria-label="${escapeHtml(label)}" ${checked ? "checked" : ""} ${disabled || this.pending ? "disabled" : ""}><i aria-hidden="true"></i></label>`;
    const agentNames: Record<string, string> = { claude: "Claude Code", codex: "Codex", cursor: "Cursor", trae: zh ? "TRAE（中国版）" : "TRAE China", grok: "Grok Build", deepseek: "DeepSeek Harness" };
    const agentStatus = (id: string) => !s.notificationServiceAvailable ? (zh ? "状态不可用" : "Status unavailable") : !s.agentHooks[id] ? (zh ? "未接入" : "Not connected") : id === "deepseek" ? (zh ? "桥接待挂载" : "Bridge pending") : !s.agentSources[id] || !s.notificationEnabled ? (zh ? "已暂停" : "Paused") : (zh ? "已接入" : "Connected");
    const currentSession = s.sessions[0] ?? (zh ? "暂无活跃会话" : "No active session");
    const nav = `<nav class="tray-nav" aria-label="${zh ? "菜单页面" : "Menu pages"}">${(["overview", "agents", "settings"] as const).map((tab, index) => `<button type="button" data-tab="${tab}" class="${this.tab === tab ? "active" : ""}" aria-current="${this.tab === tab ? "page" : "false"}">${[zh ? "概览" : "Overview", zh ? "Agent 接入" : "Agent setup", zh ? "设置" : "Settings"][index]}</button>`).join("")}</nav>`;
    const overview = `
      <section class="tray-current"><span class="tray-label">${zh ? "当前会话" : "CURRENT SESSION"}</span><strong>${escapeHtml(currentSession)}</strong></section>
      <section class="tray-section"><h2>${zh ? "桌宠" : "Desktop pet"}</h2>${toggle("toggle_pet", s.togglePetLabel, s.petVisible)}<div class="tray-actions">${button("pet_action", s.petActionLabel)}${button("customize_pet", s.customizePetLabel)}</div></section>
      <section class="tray-section"><h2>${zh ? "最近会话" : "Recent sessions"}</h2><div class="tray-sessions"><ul>${s.sessions.slice(1).map((session) => `<li>${escapeHtml(session)}</li>`).join("") || `<li>${zh ? "暂无其他会话" : "No other sessions"}</li>`}</ul></div></section>
      <section class="tray-section"><h2>${zh ? "通知" : "Notifications"}</h2><div class="tray-status-line"><span>Bark</span><strong>${!s.notificationServiceAvailable ? (zh ? "不可用" : "Unavailable") : !s.barkKeySaved ? (zh ? "未配置" : "Not configured") : !s.notificationEnabled ? (zh ? "已暂停" : "Paused") : s.barkSendFailed ? (zh ? "上次发送失败" : "Last send failed") : (zh ? "已开启" : "On")}</strong></div>${button("notification_settings", s.notificationSettingsLabel)}</section>`;
    const agents = `<section class="tray-section tray-agent-intro"><h2>${zh ? "Agent 接入" : "Agent setup"}</h2><p class="tray-section-hint">${zh ? "安装 Hook 后，到通知设置中开启对应来源。" : "Install a Hook, then enable its source in Notification Settings."}</p></section><section class="tray-agent-list">${Object.keys(agentNames).map((id) => `<article class="tray-agent"><div><strong>${escapeHtml(agentNames[id])}</strong><span class="${s.agentHooks[id] && s.agentSources[id] && s.notificationEnabled ? "ready" : ""}">${agentStatus(id)}</span></div><button type="button" data-action="setup_${id}" ${this.pending ? "disabled" : ""}>${id === "deepseek" ? (zh ? "准备 Hook" : "Prepare Hook") : (zh ? "设置 Hook" : "Set up Hook")}</button></article>`).join("")}</section>${s.integrationFeedback ? `<p class="tray-hook-feedback" role="status">${escapeHtml(s.integrationFeedback)}</p>` : ""}<section class="tray-section">${button("notification_settings", s.notificationSettingsLabel)}</section>`;
    const appearanceChoices = themeIds.map((id) => `<button type="button" class="theme-choice ${!s.appearance.followSystem && s.appearance.manualTheme === id ? "selected" : ""}" data-action="appearance_${id}" aria-pressed="${!s.appearance.followSystem && s.appearance.manualTheme === id}" ${this.pending ? "disabled" : ""}><i class="theme-swatch swatch-${id}" aria-hidden="true"></i><span>${appearanceLabel(id, s.locale)}</span></button>`).join("");
    const settings = `<section class="tray-section"><h2>${zh ? "外观" : "Appearance"}</h2>${toggle("appearance_follow", zh ? "跟随系统" : "Follow system", s.appearance.followSystem)}<div class="tray-theme-summary">${zh ? "当前使用" : "Current theme"} · ${appearanceLabel(s.appearance.followSystem ? (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "system_dark" : "system_light") : s.appearance.manualTheme, s.locale)}</div><div class="tray-theme-grid">${appearanceChoices}</div></section><section class="tray-section"><h2>${zh ? "应用" : "App"}</h2><label class="tray-language"><span>${escapeHtml(s.languageTitle)}</span><select data-role="language" aria-label="${escapeHtml(s.languageTitle)}" ${this.pending ? "disabled" : ""}><option value="zh-CN" ${zh ? "selected" : ""}>${escapeHtml(s.chineseLabel)}</option><option value="en" ${zh ? "" : "selected"}>${escapeHtml(s.englishLabel)}</option></select></label>${toggle("launch_at_login", s.loginLabel, s.loginEnabled, !s.loginAvailable)}${toggle("auto_updates", s.autoUpdatesLabel, s.autoUpdatesEnabled)}${s.autoUpdatesFailed ? `<p class="tray-error">${zh ? "自动检查设置保存失败" : "Could not save automatic update setting"}</p>` : ""}${button("check_updates", s.checkUpdatesLabel, s.updateRunning ? "tray-busy" : "")}${s.releaseLabel ? button("open_release", s.releaseLabel) : ""}</section><section class="tray-section"><h2>${zh ? "更多设置" : "More settings"}</h2>${button("customize_pet", s.customizePetLabel)}${button("notification_settings", s.notificationSettingsLabel)}</section><footer>${button("quit", s.quitLabel, "tray-quit")}</footer>`;
    this.root.innerHTML = `
      <header class="tray-head"><span class="tray-kicker">VIBE CODING LIGHT</span><strong>${zh ? "快捷控制" : "Quick controls"}</strong></header>${nav}
      ${this.tab === "overview" ? overview : this.tab === "agents" ? agents : settings}
      ${this.error ? `<p class="tray-error" role="alert">${zh ? "操作失败，请重试" : "Action failed. Try again."}</p>` : ""}`;
    const check = this.root.querySelector<HTMLButtonElement>('[data-action="check_updates"]');
    if (check && s.updateRunning) check.disabled = true;
    this.root.scrollTop = scroll;
    const replacement = focusAction
      ? this.root.querySelector<HTMLElement>(`[data-action="${focusAction}"]`)
      : focusRole ? this.root.querySelector<HTMLElement>(`[data-role="${focusRole}"]`) : null;
    if (replacement && !(replacement as HTMLInputElement).disabled) replacement.focus();
  }
}

const root = document.querySelector<HTMLElement>("#tray-root");
if (root) {
  void initAppearance();
  const controller = new TrayPanelController(root, api);
  void controller.init();
  window.setInterval(() => { void controller.refresh(); }, 1000);
}

import { invoke } from "@tauri-apps/api/core";
import "./tray.css";

export interface TrayPanelState {
  locale: "zh-CN" | "en";
  petVisible: boolean;
  togglePetLabel: string;
  petActionLabel: string;
  customizePetLabel: string;
  notificationSettingsLabel: string;
  setupClaudeLabel: string;
  setupCodexLabel: string;
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
  private state: TrayPanelState | null = null;
  private pending = false;
  private error = false;
  private deferredRender = false;

  constructor(private readonly root: HTMLElement, private readonly api: TrayPanelApi) {
    root.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
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
    const button = (action: string, label: string, extra = "") => `<button type="button" class="tray-row ${extra}" data-action="${action}" ${this.pending ? "disabled" : ""}>${escapeHtml(label)}<span aria-hidden="true">›</span></button>`;
    const toggle = (action: string, label: string, checked: boolean, disabled = false) => `<label class="tray-toggle"><span>${escapeHtml(label)}</span><input type="checkbox" data-action="${action}" aria-label="${escapeHtml(label)}" ${checked ? "checked" : ""} ${disabled || this.pending ? "disabled" : ""}><i aria-hidden="true"></i></label>`;
    this.root.innerHTML = `
      <header class="tray-head"><span class="tray-kicker">VIBE CODING LIGHT</span><strong>${zh ? "快捷控制" : "Quick controls"}</strong></header>
      <section class="tray-section"><h2>${zh ? "桌宠" : "Desktop pet"}</h2>${toggle("toggle_pet", s.togglePetLabel, s.petVisible)}${button("pet_action", s.petActionLabel)}${button("customize_pet", s.customizePetLabel)}</section>
      <section class="tray-section"><h2>${zh ? "工作" : "Work"}</h2>${button("notification_settings", s.notificationSettingsLabel)}${button("setup_claude", s.setupClaudeLabel)}${button("setup_codex", s.setupCodexLabel)}<div class="tray-sessions"><span>${escapeHtml(s.sessionsTitle)}</span><ul>${s.sessions.map((session) => `<li>${escapeHtml(session)}</li>`).join("")}</ul></div></section>
      <section class="tray-section"><h2>${zh ? "应用" : "App"}</h2><label class="tray-language"><span>${escapeHtml(s.languageTitle)}</span><select data-role="language" aria-label="${escapeHtml(s.languageTitle)}" ${this.pending ? "disabled" : ""}><option value="zh-CN" ${zh ? "selected" : ""}>${escapeHtml(s.chineseLabel)}</option><option value="en" ${zh ? "" : "selected"}>${escapeHtml(s.englishLabel)}</option></select></label>${toggle("launch_at_login", s.loginLabel, s.loginEnabled, !s.loginAvailable)}${toggle("auto_updates", s.autoUpdatesLabel, s.autoUpdatesEnabled)}${s.autoUpdatesFailed ? `<p class="tray-error">${zh ? "自动检查设置保存失败" : "Could not save automatic update setting"}</p>` : ""}${button("check_updates", s.checkUpdatesLabel, s.updateRunning ? "tray-busy" : "")}${s.releaseLabel ? button("open_release", s.releaseLabel) : ""}</section>
      <footer>${button("quit", s.quitLabel, "tray-quit")}${this.error ? `<p class="tray-error" role="alert">${zh ? "操作失败，请重试" : "Action failed. Try again."}</p>` : ""}</footer>`;
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
  const controller = new TrayPanelController(root, api);
  void controller.init();
  window.setInterval(() => { void controller.refresh(); }, 1000);
}

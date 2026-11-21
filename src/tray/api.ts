import { invoke } from "@tauri-apps/api/core";
import type { Appearance } from "../appearance";

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

export const trayPanelApi: TrayPanelApi = {
  getState: () => invoke("get_tray_panel_state"),
  performAction: (action) => invoke("perform_tray_panel_action", { action }),
  hide: () => invoke("hide_tray_panel"),
};


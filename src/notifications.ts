import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { initAppearance } from "./appearance";
import { notificationApi } from "./notifications/api";
import { NotificationSettingsModel } from "./notifications/model";
import { NotificationSettingsPage } from "./notifications/NotificationSettingsPage";
import type { NotificationLocale } from "./notifications/i18n";
import type { NotificationStatus } from "./notifications/api";
export type { DiagnosticEntry, NotificationApi, NotificationSettings, NotificationStatus } from "./notifications/api";
export { NotificationSettingsController } from "./notifications/legacy";

const root = document.getElementById("notification-app");
if (root) {
  void initAppearance();
  const model = new NotificationSettingsModel(notificationApi);
  const reactRoot = createRoot(root);
  reactRoot.render(createElement(NotificationSettingsPage, { model }));
  void invoke<NotificationLocale>("get_app_locale").then((locale) => model.init(locale)).catch(() => model.init("zh-CN"));
  const unlisteners: Array<() => void> = [];
  void listen<NotificationLocale>("locale-changed", (event) => model.setLocale(event.payload)).then((stop) => unlisteners.push(stop));
  void listen<NotificationStatus>("notification-status-changed", (event) => model.setStatus(event.payload)).then((stop) => unlisteners.push(stop));
  void listen("notification-diagnostics-changed", () => { void model.refreshDiagnostics(); }).then((stop) => unlisteners.push(stop));
  window.addEventListener("beforeunload", () => { unlisteners.forEach((stop) => stop()); model.dispose(); reactRoot.unmount(); }, { once: true });
}

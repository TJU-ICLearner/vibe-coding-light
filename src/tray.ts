import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { initAppearance } from "./appearance";
import { trayPanelApi } from "./tray/api";
import { TrayPanelModel } from "./tray/model";
import { TrayPanel } from "./tray/TrayPanel";
export type { TrayPanelApi, TrayPanelState } from "./tray/api";
export { TrayPanelController } from "./tray/legacy";

const root = document.querySelector<HTMLElement>("#tray-root");
if (root) {
  void initAppearance();
  const model = new TrayPanelModel(trayPanelApi);
  const reactRoot = createRoot(root);
  reactRoot.render(createElement(TrayPanel, { model }));
  void model.init();
  const poll = window.setInterval(() => { void model.refresh(); }, 1000);
  window.addEventListener("beforeunload", () => { window.clearInterval(poll); model.dispose(); reactRoot.unmount(); }, { once: true });
}

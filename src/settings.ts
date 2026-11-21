import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { initAppearance } from "./appearance";
import type { Locale } from "./i18n";
import type { ImportCapabilities, PetManifest, PreparedAssetPayload } from "./pet/types";
import { PetSettingsPage } from "./pet-settings/PetSettingsPage";
import { SettingsController, type SettingsApi } from "./pet-settings/model";
export { SettingsController, PreviewController, availableModes, validatePetFile } from "./pet-settings/model";

const api: SettingsApi = {
  prepare: (bytes, mode) => invoke<PreparedAssetPayload>("prepare_pet_preview", { input: Array.from(bytes), mode }),
  save: (name, assets, scale, motions) => invoke<PetManifest>("save_pet_profile", { name, assets, scale, motions }),
  list: () => invoke<PetManifest[]>("list_photo_pets"),
  select: (id) => invoke("select_pet", { id }),
  delete: (id) => invoke("delete_photo_pet", { id }),
  active: () => invoke("get_active_pet"),
};

const emptyCapabilities: ImportCapabilities = { automatic: false, transparent_png: false, transparent_gif: false };
const roots = new WeakMap<HTMLElement, Root>();

export function mountSettings(root = document.getElementById("settings-app")): void {
  if (!root || roots.has(root)) return;
  const reactRoot = createRoot(root);
  roots.set(root, reactRoot);
  const controller = new SettingsController(api);
  let locale: Locale = "zh-CN";
  let localeEventSeen = false;
  let capabilities = emptyCapabilities;
  let capabilitiesLoaded = false;
  let capabilityError: string | null = null;
  let disposed = false;
  const render = () => {
    if (disposed) return;
    document.documentElement.lang = locale;
    document.title = `${locale === "zh-CN" ? "自定义桌宠" : "Customize Pet"} · Vibe Coding Light`;
    reactRoot.render(createElement(PetSettingsPage, { controller, locale, capabilities, capabilitiesLoaded, capabilityError }));
    root.classList.add("ready");
  };
  flushSync(render);
  void initAppearance();
  void controller.refresh();
  void invoke<ImportCapabilities>("get_pet_import_capabilities").then((result) => {
    capabilities = result;
    capabilitiesLoaded = true;
    render();
  }).catch((error) => {
    capabilityError = String(error);
    capabilitiesLoaded = true;
    render();
  });
  let unlisten: (() => void) | undefined;
  void listen<Locale>("locale-changed", (event) => {
    if (event.payload !== "zh-CN" && event.payload !== "en") return;
    localeEventSeen = true;
    locale = event.payload;
    render();
  }).then((stop) => { unlisten = stop; }).catch(() => {});
  void invoke<Locale>("get_app_locale").then((value) => {
    if (localeEventSeen || (value !== "zh-CN" && value !== "en")) return;
    locale = value;
    render();
  }).catch(() => {});
  window.addEventListener("beforeunload", () => { disposed = true; unlisten?.(); reactRoot.unmount(); roots.delete(root); }, { once: true });
}

if (typeof document !== "undefined") window.addEventListener("DOMContentLoaded", () => mountSettings());

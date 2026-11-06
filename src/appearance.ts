import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type ThemeId = "system_light" | "system_dark" | "shaxi" | "chenwu" | "zhiqiu" | "bajiao";
export interface Appearance { followSystem: boolean; manualTheme: ThemeId }
export const themeIds: ThemeId[] = ["system_light", "system_dark", "shaxi", "chenwu", "zhiqiu", "bajiao"];

const labels: Record<ThemeId, { zh: string; en: string }> = {
  system_light: { zh: "系统浅色", en: "System Light" },
  system_dark: { zh: "系统深色", en: "System Dark" },
  shaxi: { zh: "社戏", en: "Village Opera" },
  chenwu: { zh: "晨雾", en: "Morning Mist" },
  zhiqiu: { zh: "知秋", en: "Autumn" },
  bajiao: { zh: "芭蕉", en: "Banana Rain" },
};

export function appearanceLabel(theme: ThemeId, locale: "zh-CN" | "en"): string {
  return labels[theme][locale === "zh-CN" ? "zh" : "en"];
}

export function resolveTheme(preference: Appearance, systemDark: boolean): ThemeId {
  return preference.followSystem ? (systemDark ? "system_dark" : "system_light") : preference.manualTheme;
}

export function applyAppearance(preference: Appearance, systemDark: boolean): void {
  document.documentElement.dataset.theme = resolveTheme(preference, systemDark);
  document.documentElement.style.colorScheme = resolveTheme(preference, systemDark) === "system_dark" || resolveTheme(preference, systemDark) === "shaxi" ? "dark" : "light";
}

export async function initAppearance(): Promise<void> {
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  let preference: Appearance = { followSystem: true, manualTheme: "system_light" };
  let changedByEvent = false;
  const render = () => applyAppearance(preference, media?.matches ?? false);
  media?.addEventListener("change", render);
  render();
  try {
    await listen<Appearance>("appearance-changed", (event) => {
      changedByEvent = true;
      preference = event.payload;
      render();
    });
  } catch { /* A standalone preview has no Tauri event bridge. */ }
  try {
    const saved = await invoke<Appearance>("get_appearance");
    if (!changedByEvent) {
      preference = saved;
      render();
    }
  } catch { /* Use the system default when running a standalone preview. */ }
}

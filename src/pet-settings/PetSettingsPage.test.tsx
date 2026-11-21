import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { screen } from "@testing-library/react";
import settingsHtml from "../../settings.html?raw";
import { mountSettings } from "../settings";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

function mountWindow() {
  const markup = settingsHtml.match(/<main id="settings-app">([\s\S]*?)<\/main>/)?.[0];
  if (!markup) throw new Error("Settings root missing");
  document.body.innerHTML = markup;
  let selectedId = "builtin:bubu";
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "get_app_locale") return "zh-CN";
    if (command === "get_pet_import_capabilities") return { automatic: true, transparent_png: true, transparent_gif: true };
    if (command === "get_active_pet") return { kind: "builtin", id: selectedId };
    if (command === "select_pet") { selectedId = (args as { id: string }).id; return; }
    return [];
  });
  mountSettings();
}

beforeEach(() => { vi.mocked(invoke).mockReset(); document.body.replaceChildren(); });

describe("BoardUI pet settings", () => {
  it("switching_builtin_state_changes_preview_src", async () => {
    mountWindow();
    screen.getByRole("tab", { name: /按状态/ }).click();
    (await screen.findByRole("tab", { name: /工作/ })).click();
    await vi.waitFor(() => expect(screen.getByAltText("透明桌宠预览").getAttribute("src")).toBe("/pet/bubu/working.gif"));
    screen.getByRole("button", { name: "默认一二" }).click();
    await vi.waitFor(() => expect(screen.getByAltText("透明桌宠预览").getAttribute("src")).toBe("/pet/yier/working.gif"));
  });
});

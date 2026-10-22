import { describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import settingsHtml from "../settings.html?raw";
import { PreviewController, SettingsController, availableModes, validatePetFile, mountSettings } from "./settings";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const localeEvents = vi.hoisted(() => ({ handler: null as null | ((event: { payload: "zh-CN" | "en" }) => void) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async (_name, callback) => {
  localeEvents.handler = callback;
  return () => { localeEvents.handler = null; };
}) }));

function settingsMarkup(): string {
  const markup = settingsHtml.match(/<main id="settings-app">([\s\S]*?)<\/main>/)?.[0];
  if (!markup) throw new Error("Settings markup missing");
  return markup;
}

function mountFullSettings(initialLocale: "zh-CN" | "en") {
  document.body.innerHTML = settingsMarkup();
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "get_app_locale") return initialLocale;
    if (command === "get_pet_import_capabilities") return { automatic: true, transparent_png: true, transparent_gif: true };
    if (command === "get_active_pet") return { kind: "builtin" };
    return [];
  });
  mountSettings();
}

function chooseFile(input: HTMLInputElement, value: File) {
  Object.defineProperty(input, "files", { configurable: true, value: [value] });
  input.dispatchEvent(new Event("change"));
}

function enterStateMode() {
  const style = document.querySelector<HTMLSelectElement>("#pet-style")!;
  style.value = "states";
  style.dispatchEvent(new Event("change"));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const photo = (id: string) => ({ schema_version: 1, id, name: id, scale: 0.8, offset_x: 0, offset_y: 0, created_at: 1 });
const file = (name: string) => new File([name], `${name}.png`, { type: "image/png" });

describe("settings preview", () => {
  it("shows five ordered tabs and keeps preview before the editor in the DOM", async () => {
    mountFullSettings("en");
    enterStateMode();
    const tabs = [...document.querySelectorAll<HTMLButtonElement>("#slot-tabs [role=tab]")];
    expect(tabs.map((tab) => tab.dataset.slot)).toEqual(["default", "working", "waiting", "error", "completed"]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(tabs.slice(1).every((tab) => tab.getAttribute("aria-selected") === "false")).toBe(true);
    const preview = document.querySelector("#preview-panel")!;
    const editor = document.querySelector("#asset-editor")!;
    expect(Boolean(preview.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    const layout = document.querySelector(".editor-layout")!;
    expect(layout.contains(preview)).toBe(true);
    expect(layout.contains(editor)).toBe(true);
    expect(layout.contains(document.querySelector("#pet-scale"))).toBe(true);
    expect(layout.contains(document.querySelector("#save-pet"))).toBe(true);
  });

  it("uses arrow keys to move the selected slot and keyboard focus", async () => {
    mountFullSettings("en");
    enterStateMode();
    const tabs = [...document.querySelectorAll<HTMLButtonElement>("#slot-tabs [role=tab]")];
    tabs[0].focus();
    tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs[1]);
  });

  it("keeps GIF and PNG assets by slot and falls back to default without reprocessing", async () => {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn((item: File) => `blob:${item.name}`) });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "get_app_locale") return "en";
      if (command === "get_pet_import_capabilities") return { automatic: true, transparent_png: true, transparent_gif: true };
      if (command === "get_active_pet") return { kind: "builtin" };
      if (command === "prepare_pet_preview") {
        const bytes = (args as { input: number[] }).input;
        return bytes[0] === 71 ? { kind: "gif", data_url: "data:image/gif;base64,R0lG" } : { kind: "png", data_url: "data:image/png;base64,UE5H" };
      }
      return [];
    });
    document.body.innerHTML = settingsMarkup();
    mountSettings();
    await vi.waitFor(() => expect(document.querySelector<HTMLSelectElement>("#photo-mode")!.options.length).toBeGreaterThan(0));
    chooseFile(document.querySelector("#photo-file")!, file("A"));
    await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>("#processed-preview")?.getAttribute("src")).toBe("data:image/png;base64,UE5H"));
    enterStateMode();
    document.querySelector<HTMLButtonElement>('#slot-tabs [data-slot="working"]')!.click();
    chooseFile(document.querySelector("#photo-file")!, new File(["GIF89a"], "work.gif", { type: "image/gif" }));
    await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>("#processed-preview")?.getAttribute("src")).toBe("data:image/gif;base64,R0lG"));
    const before = vi.mocked(invoke).mock.calls.filter(([command]) => command === "prepare_pet_preview").length;
    document.querySelector<HTMLButtonElement>('#slot-tabs [data-slot="waiting"]')!.click();
    expect(document.querySelector<HTMLImageElement>("#processed-preview")?.getAttribute("src")).toBe("data:image/png;base64,UE5H");
    document.querySelector<HTMLButtonElement>('#slot-tabs [data-slot="working"]')!.click();
    expect(document.querySelector("#slot-file-name")?.textContent).toContain("work.gif");
    expect(document.querySelector<HTMLSelectElement>("#photo-mode")?.value).toBe("keep_animation");
    expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "prepare_pet_preview")).toHaveLength(before);
  });

  it("shows only the default editor in single mode", async () => {
    mountFullSettings("en");
    await vi.waitFor(() => expect(document.documentElement.lang).toBe("en"));
    enterStateMode();
    const style = document.querySelector<HTMLSelectElement>("#pet-style")!;
    style.value = "single"; style.dispatchEvent(new Event("change"));
    expect(document.querySelector<HTMLElement>("#slot-tabs")!.hidden).toBe(true);
    expect(document.querySelector("#slot-editor-title")?.textContent).toContain("Default");
  });
  it("keeps separate still-image motions across state and language switches and sends them on save", async () => {
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "get_app_locale") return "en";
      if (command === "get_pet_import_capabilities") return { automatic: true, transparent_png: true, transparent_gif: true };
      if (command === "get_active_pet") return { kind: "builtin" };
      if (command === "prepare_pet_preview") return { kind: "png", data_url: "data:image/png;base64,UE5H" };
      if (command === "save_pet_profile") return { schema_version: 3, id: "saved", name: "pet", scale: 0.8, offset_x: 0, offset_y: 0, created_at: 1, assets: {}, motions: (args as { motions: object }).motions };
      return [];
    });
    document.body.innerHTML = settingsMarkup(); mountSettings();
    await vi.waitFor(() => expect(document.querySelector<HTMLSelectElement>("#photo-mode")!.options.length).toBeGreaterThan(0));
    chooseFile(document.querySelector("#photo-file")!, file("A"));
    await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>("#processed-preview")?.getAttribute("src")).toBe("data:image/png;base64,UE5H"));
    const motion = document.querySelector<HTMLSelectElement>("#pet-motion")!;
    expect(motion).not.toBeNull();
    motion.value = "sway"; motion.dispatchEvent(new Event("change"));
    enterStateMode();
    document.querySelector<HTMLButtonElement>('#slot-tabs [data-slot="working"]')!.click();
    chooseFile(document.querySelector("#photo-file")!, file("B"));
    await vi.waitFor(() => expect(document.querySelector("#slot-file-name")?.textContent).toContain("B.png"));
    await vi.waitFor(() => expect(motion.disabled).toBe(false));
    motion.value = "bounce"; motion.dispatchEvent(new Event("change"));
    localeEvents.handler?.({ payload: "zh-CN" });
    document.querySelector<HTMLButtonElement>('#slot-tabs [data-slot="default"]')!.click();
    expect(motion.value).toBe("sway");
    document.querySelector<HTMLButtonElement>('#slot-tabs [data-slot="working"]')!.click();
    expect(motion.value).toBe("bounce");
    document.querySelector<HTMLButtonElement>("#save-pet")!.click();
    await vi.waitFor(() => expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "save_pet_profile")).toBe(true));
    const saveArgs = vi.mocked(invoke).mock.calls.find(([command]) => command === "save_pet_profile")?.[1] as { motions: object };
    expect(saveArgs.motions).toEqual({ default: "sway", working: "bounce" });
    chooseFile(document.querySelector("#photo-file")!, file("C"));
    await vi.waitFor(() => expect(motion.disabled).toBe(false));
    expect(motion.value).toBe("follow_state");
    document.querySelector<HTMLButtonElement>('#slot-tabs [data-slot="default"]')!.click();
    expect(motion.value).toBe("sway");
  });
  it("reports a missing default preview before saving", async () => {
    const save = vi.fn();
    const controller = new SettingsController({ prepare: vi.fn(), save, list: vi.fn(), select: vi.fn(), delete: vi.fn(), active: vi.fn() });
    const changed = vi.fn();
    controller.onChange(changed);
    await expect(controller.save("pet", 0.8, {})).rejects.toThrow();
    expect(controller.error?.code).toBe("default_required");
    expect(changed).toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("reports successful save with a locale-independent feedback key", async () => {
    const controller = new SettingsController({
      prepare: async () => ({ kind: "png", data_url: "data:image/png;base64,UE5H" }),
      save: async () => photo("new"), list: async () => [photo("new")],
      select: async () => {}, delete: async () => {}, active: async () => ({ kind: "builtin" }),
    });
    await controller.load(file("A"), "keep_alpha");
    await controller.save("new", 0.8, {});
    expect(controller.feedback).toBe("saved_success");
  });
  it("renders all built-in settings copy in English on initial load", async () => {
    mountFullSettings("en");
    await vi.waitFor(() => expect(document.documentElement.lang).toBe("en"));
    expect(document.title).toContain("Customize Pet");
    expect(document.querySelector("#settings-app")!.textContent).not.toMatch(/[\u3400-\u9fff]/);
    expect([...document.querySelectorAll("#settings-app [alt], #settings-app [placeholder]")]
      .map((element) => element.getAttribute("alt") ?? element.getAttribute("placeholder")).join(" ")).not.toMatch(/[\u3400-\u9fff]/);
  });

  it("switches language during a pending import without discarding the result or transform", async () => {
    mountFullSettings("zh-CN");
    const pending = deferred<{ kind: "png"; data_url: string }>();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_app_locale") return "zh-CN";
      if (command === "get_pet_import_capabilities") return { automatic: true, transparent_png: true, transparent_gif: true };
      if (command === "get_active_pet") return { kind: "builtin" };
      if (command === "prepare_pet_preview") return pending.promise;
      return [];
    });
    const scale = document.querySelector<HTMLInputElement>("#pet-scale")!;
    await vi.waitFor(() => expect(document.querySelector<HTMLSelectElement>("#photo-mode")!.options.length).toBeGreaterThan(0));
    scale.value = "0.75";
    scale.dispatchEvent(new Event("input"));
    const input = document.querySelector<HTMLInputElement>("#photo-file")!;
    Object.defineProperty(input, "files", { configurable: true, value: [file("A")] });
    input.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "prepare_pet_preview")).toBe(true));
    await vi.waitFor(() => expect(localeEvents.handler).not.toBeNull());
    localeEvents.handler!({ payload: "en" });
    expect(document.querySelector("#status")?.textContent).toContain("Processing");
    pending.resolve({ kind: "png", data_url: "data:image/png;base64,QUJD" });
    await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>("#processed-preview")?.getAttribute("src")).toBe("data:image/png;base64,QUJD"));
    expect(scale.value).toBe("0.75");
    expect(document.querySelector("#status")?.textContent).toContain("Preview ready");
  });

  it("keeps a newer language event when the initial locale read finishes late", async () => {
    document.body.innerHTML = settingsMarkup();
    const pending = deferred<"zh-CN">();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_app_locale") return pending.promise;
      if (command === "get_pet_import_capabilities") return { automatic: true, transparent_png: true, transparent_gif: true };
      if (command === "get_active_pet") return { kind: "builtin" };
      return [];
    });
    mountSettings();
    await vi.waitFor(() => expect(localeEvents.handler).not.toBeNull());
    localeEvents.handler!({ payload: "en" });
    pending.resolve("zh-CN");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.documentElement.lang).toBe("en");
  });
  it("rejects oversized and unsupported files before reading", async () => {
    const huge = file("huge");
    Object.defineProperty(huge, "size", { value: 10 * 1024 * 1024 + 1 });
    const read = vi.spyOn(huge, "arrayBuffer");
    const prepare = vi.fn();
    const controller = new SettingsController({ prepare, save: vi.fn(), list: vi.fn(), select: vi.fn(), delete: vi.fn(), active: vi.fn() });
    await controller.load(huge, "keep_alpha");
    expect(controller.error?.code).toBe("too_large");
    expect(read).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(validatePetFile(new File(["x"], "x.gif", { type: "image/gif" }), "remove_background")).toBe("gif_requires_animation");
  });

  it("fits the complete 3x preview and shows the real window size without offset controls", () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_pet_import_capabilities") return { automatic: true, transparent_png: true, transparent_gif: true };
      if (command === "get_active_pet") return { kind: "builtin" };
      return [];
    });
    document.body.innerHTML = settingsMarkup();
    mountSettings();
    const scale = document.querySelector<HTMLInputElement>("#pet-scale")!;
    expect(scale.max).toBe("3");
    expect(document.querySelector("#pet-offset-x")).toBeNull();
    expect(document.querySelector("#pet-offset-y")).toBeNull();
    scale.value = "3";
    scale.dispatchEvent(new Event("input"));
    expect(document.querySelector<HTMLElement>(".preview-window")!.style.width).toBe("400px");
    expect(document.querySelector<HTMLElement>(".preview-viewport")!.style.width).toBe("160px");
    expect(document.querySelector<HTMLElement>("#processed-frame")!.style.transform).toBe("scale(3)");
    expect(document.querySelector<HTMLElement>(".preview-size")!.textContent).toBe("400 × 400");
    expect(Number.parseFloat(document.querySelector<HTMLImageElement>("#processed-preview")!.style.getPropertyValue("--pet-motion-shift"))).toBeLessThan(3);
  });
  it("keeps the newest selection when an older request finishes late", async () => {
    const a = deferred<string>(); const b = deferred<string>();
    const seen: string[] = [];
    const controller = new PreviewController((bytes) => bytes[0] === 65 ? a.promise : b.promise, (result) => seen.push(result));
    const first = controller.load(file("A"), "keep_alpha");
    const second = controller.load(file("B"), "keep_alpha");
    b.resolve("data:image/png;base64,B"); await second;
    a.resolve("data:image/png;base64,A"); await first;
    expect(seen).toEqual(["data:image/png;base64,B"]);
  });

  it("does not save on a failed preview or on preview success alone", async () => {
    const save = vi.fn();
    const controller = new SettingsController({
      prepare: vi.fn().mockRejectedValue(new Error("no subject")),
      save, list: vi.fn().mockResolvedValue([]), select: vi.fn(), delete: vi.fn(), active: vi.fn().mockResolvedValue({kind:"builtin"}),
    });
    await controller.load(file("bad"), "keep_alpha");
    expect(controller.error).toEqual({ code: "internal_error", detail: "no subject" });
    await expect(controller.save("bad", 0.8, {})).rejects.toThrow();
    expect(save).not.toHaveBeenCalled();
  });

  it("offers alpha PNG on older macOS", () => {
    expect(availableModes({ automatic: false, transparent_png: true, transparent_gif: true })).toEqual(["keep_alpha", "keep_animation"]);
    expect(availableModes({ automatic: true, transparent_png: true, transparent_gif: true })).toEqual(["remove_background", "keep_alpha", "keep_animation"]);
  });

  it("validates transparent GIF separately from static import modes", () => {
    const animated = new File(["GIF89a"], "pet.gif", { type: "image/gif" });
    expect(validatePetFile(animated, "keep_animation")).toBeNull();
    expect(validatePetFile(animated, "remove_background")).toBe("gif_requires_animation");
    expect(validatePetFile(file("still"), "keep_animation")).toBe("animation_requires_gif");
  });

  it("saves single image or selected state images", async () => {
    const save = vi.fn().mockResolvedValue(photo("saved"));
    const controller = new SettingsController({
      prepare: async (bytes) => ({ kind: "png", data_url: `data:image/png;base64,${String.fromCharCode(bytes[0])}` }),
      save, list: vi.fn().mockResolvedValue([]), select: vi.fn(), delete: vi.fn(), active: vi.fn().mockResolvedValue({kind:"builtin"}),
    });
    await controller.load(file("A"), "keep_alpha");
    await controller.loadSlot("working", file("B"), "keep_alpha");
    await controller.save("one", 0.8, { default: "sway", working: "bounce" });
    expect(Object.keys(save.mock.calls[0][1])).toEqual(["default"]);
    expect(save.mock.calls[0][3]).toEqual({ default: "sway" });
    controller.setMode("states");
    await controller.save("many", 0.8, { default: "sway", working: "bounce" });
    expect(Object.keys(save.mock.calls[1][1])).toEqual(["default", "working"]);
    expect(save.mock.calls[1][3]).toEqual({ default: "sway", working: "bounce" });
    controller.setMode("single");
    await controller.save("one-again", 0.8, {});
    expect(Object.keys(save.mock.calls[2][1])).toEqual(["default"]);
    expect(controller.draft.get("working")?.asset).toBeTruthy();
  });

  it("configures GIF import, previews state fallback, and warns about a broken saved slot", async () => {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:preview") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "get_pet_import_capabilities") return { automatic: true, transparent_png: true, transparent_gif: true };
      if (command === "get_active_pet") return { kind: "photo", id: "saved", assets: {}, invalid_slots: ["waiting"], scale: 0.8, offset_x: 0, offset_y: 0 };
      if (command === "prepare_pet_preview") {
        const bytes = (args as { input: number[] }).input;
        return bytes[0] === 71
          ? { kind: "gif", data_url: "data:image/gif;base64,R0lG" }
          : { kind: "png", data_url: "data:image/png;base64,UE5H" };
      }
      return [];
    });
    document.body.innerHTML = settingsMarkup();
    mountSettings();
    await vi.waitFor(() => expect(document.querySelector("#saved-warning")?.textContent).toContain("等待素材不可用"));
    await vi.waitFor(() => expect(document.querySelector<HTMLSelectElement>("#photo-mode")!.options.length).toBeGreaterThan(0));
    const defaultInput = document.querySelector<HTMLInputElement>("#photo-file")!;
    chooseFile(defaultInput, new File(["A"], "base.png", { type: "image/png" }));
    await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>("#processed-preview")?.getAttribute("src")).toBe("data:image/png;base64,UE5H"));
    enterStateMode();
    document.querySelector<HTMLButtonElement>('#slot-tabs [data-slot="working"]')!.click();
    chooseFile(defaultInput, new File(["GIF89a"], "work.gif", { type: "image/gif" }));
    await vi.waitFor(() => expect(document.querySelector<HTMLSelectElement>("#photo-mode")?.value).toBe("keep_animation"));
    expect(document.querySelectorAll("#photo-mode option")).toHaveLength(1);
    await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>("#processed-preview")?.getAttribute("src")).toBe("data:image/gif;base64,R0lG"));
    expect(document.querySelector("#processed-preview")?.classList.contains("animated")).toBe(true);
    expect(document.querySelector<HTMLSelectElement>("#pet-motion")?.disabled).toBe(true);
    expect(document.querySelector("#motion-hint")?.textContent).toContain("GIF");
    document.querySelector<HTMLButtonElement>('#slot-tabs [data-slot="waiting"]')!.click();
    expect(document.querySelector<HTMLImageElement>("#processed-preview")?.getAttribute("src")).toBe("data:image/png;base64,UE5H");
  });
});

describe("saved pets", () => {
  it("updates selected pet only after select and delete succeed", async () => {
    const select = deferred<void>(); const remove = deferred<void>();
    const controller = new SettingsController({
      prepare: vi.fn(), save: vi.fn(), list: vi.fn().mockResolvedValue([photo("p1")]),
      select: vi.fn().mockReturnValue(select.promise), delete: vi.fn().mockReturnValue(remove.promise),
      active: vi.fn().mockResolvedValue({kind:"builtin"}),
    });
    await controller.refresh();
    expect(controller.pets).toHaveLength(1);
    const selecting = controller.select("p1");
    expect(controller.selectedId).toBe("builtin-cat");
    select.resolve(); await selecting;
    expect(controller.selectedId).toBe("p1");
    const deleting = controller.delete("p1");
    expect(controller.pets).toHaveLength(1);
    remove.resolve(); await deleting;
    expect(controller.pets).toHaveLength(0);
    expect(controller.selectedId).toBe("builtin-cat");
  });
});

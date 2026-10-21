import { describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { PreviewController, SettingsController, availableModes, validatePetFile, applyPreviewTransform, mountSettings } from "./settings";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const photo = (id: string) => ({ schema_version: 1, id, name: id, scale: 0.8, offset_x: 0, offset_y: 0, created_at: 1 });
const file = (name: string) => new File([name], `${name}.png`, { type: "image/png" });

describe("settings preview", () => {
  it("rejects oversized and unsupported files before reading", async () => {
    const huge = file("huge");
    Object.defineProperty(huge, "size", { value: 10 * 1024 * 1024 + 1 });
    const read = vi.spyOn(huge, "arrayBuffer");
    const prepare = vi.fn();
    const controller = new SettingsController({ prepare, save: vi.fn(), list: vi.fn(), select: vi.fn(), delete: vi.fn(), active: vi.fn() });
    await controller.load(huge, "keep_alpha");
    expect(controller.error).toContain("10 MiB");
    expect(read).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(validatePetFile(new File(["x"], "x.gif", { type: "image/gif" }), "remove_background")).toContain("GIF");
  });

  it("renders saved placement in the 128px window", () => {
    const frame = document.createElement("div");
    expect(applyPreviewTransform(frame, 0.8, 3, -2)).toBe(true);
    expect(frame.style.transform).toBe("translate(3px, -2px) scale(0.8)");
    expect(applyPreviewTransform(frame, 1, 32, 0)).toBe(false);
  });

  it("updates the visible preview and save availability as controls change", () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_pet_import_capabilities") return { automatic: true, transparent_png: true, transparent_gif: true };
      if (command === "get_active_pet") return { kind: "builtin" };
      return [];
    });
    document.body.innerHTML = `<main id="settings-app"><input id="photo-file"><select id="photo-mode"></select>
      <img id="original-preview"><div id="processed-frame"><img id="processed-preview"></div>
      <button id="save-pet"></button><input id="pet-name"><input id="pet-scale" value="0.8">
      <input id="pet-offset-x" value="0"><input id="pet-offset-y" value="0">
      <div id="saved-pets"></div><p id="status"></p><div id="state-buttons"></div></main>`;
    mountSettings();
    const x = document.querySelector<HTMLInputElement>("#pet-offset-x")!;
    x.value = "12";
    x.dispatchEvent(new Event("input"));
    expect(document.querySelector<HTMLElement>("#processed-frame")!.style.transform).toBe("translate(12px, 0px) scale(0.8)");
    expect(x.max).toBe("15");
    expect(document.querySelector<HTMLInputElement>("#pet-offset-y")!.min).toBe("-6");
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
    expect(controller.error).toContain("no subject");
    await expect(controller.save("bad", 0.8, 0, 0)).rejects.toThrow();
    expect(save).not.toHaveBeenCalled();
  });

  it("offers alpha PNG on older macOS", () => {
    expect(availableModes({ automatic: false, transparent_png: true, transparent_gif: true })).toEqual(["keep_alpha", "keep_animation"]);
    expect(availableModes({ automatic: true, transparent_png: true, transparent_gif: true })).toEqual(["remove_background", "keep_alpha", "keep_animation"]);
  });

  it("validates transparent GIF separately from static import modes", () => {
    const animated = new File(["GIF89a"], "pet.gif", { type: "image/gif" });
    expect(validatePetFile(animated, "keep_animation")).toBeNull();
    expect(validatePetFile(animated, "remove_background")).toContain("GIF");
    expect(validatePetFile(file("still"), "keep_animation")).toContain("GIF");
  });

  it("saves single image or selected state images", async () => {
    const save = vi.fn().mockResolvedValue(photo("saved"));
    const controller = new SettingsController({
      prepare: async (bytes) => ({ kind: "png", data_url: `data:image/png;base64,${String.fromCharCode(bytes[0])}` }),
      save, list: vi.fn().mockResolvedValue([]), select: vi.fn(), delete: vi.fn(), active: vi.fn().mockResolvedValue({kind:"builtin"}),
    });
    await controller.load(file("A"), "keep_alpha");
    await controller.loadSlot("working", file("B"), "keep_alpha");
    await controller.save("one", 0.8, 0, 0);
    expect(Object.keys(save.mock.calls[0][1])).toEqual(["default"]);
    controller.setMode("states");
    await controller.save("many", 0.8, 0, 0);
    expect(Object.keys(save.mock.calls[1][1])).toEqual(["default", "working"]);
    controller.setMode("single");
    await controller.save("one-again", 0.8, 0, 0);
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
    document.body.innerHTML = `<main id="settings-app"><select id="pet-style"><option value="single">单图</option><option value="states">按状态</option></select>
      <p id="mode-hint"></p><input id="photo-file"><select id="photo-mode"></select><div id="state-assets"></div>
      <img id="original-preview"><div id="processed-frame"><img id="processed-preview"></div>
      <button id="save-pet"></button><input id="pet-name"><input id="pet-scale" value="0.8">
      <input id="pet-offset-x" value="0"><input id="pet-offset-y" value="0">
      <p id="saved-warning" hidden></p><div id="saved-pets"></div><p id="status"></p><div id="state-buttons"></div></main>`;
    mountSettings();
    await vi.waitFor(() => expect(document.querySelector("#saved-warning")?.textContent).toContain("等待素材不可用"));
    const setFile = (input: HTMLInputElement, value: File) => {
      Object.defineProperty(input, "files", { configurable: true, value: [value] });
      input.dispatchEvent(new Event("change"));
    };
    const defaultInput = document.querySelector<HTMLInputElement>("#photo-file")!;
    setFile(defaultInput, new File(["A"], "base.png", { type: "image/png" }));
    await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>("#processed-preview")?.getAttribute("src")).toBe("data:image/png;base64,UE5H"));
    const style = document.querySelector<HTMLSelectElement>("#pet-style")!;
    style.value = "states"; style.dispatchEvent(new Event("change"));
    const working = document.querySelector<HTMLInputElement>('[data-slot="working"] input[type="file"]')!;
    setFile(working, new File(["GIF89a"], "work.gif", { type: "image/gif" }));
    await vi.waitFor(() => expect(document.querySelector<HTMLSelectElement>('[data-slot="working"] select')?.value).toBe("keep_animation"));
    expect(document.querySelectorAll('[data-slot="working"] select option')).toHaveLength(1);
    const buttons = [...document.querySelectorAll<HTMLButtonElement>("#state-buttons button")];
    buttons.find((button) => button.textContent === "工作")!.click();
    await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>("#processed-preview")?.getAttribute("src")).toBe("data:image/gif;base64,R0lG"));
    expect(document.querySelector("#processed-preview")?.classList.contains("animated")).toBe(true);
    buttons.find((button) => button.textContent === "等待")!.click();
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

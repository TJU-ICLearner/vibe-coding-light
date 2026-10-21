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
    expect(validatePetFile(new File(["x"], "x.gif", { type: "image/gif" }), "remove_background")).toContain("PNG");
  });

  it("renders saved placement in the 128px window", () => {
    const frame = document.createElement("div");
    expect(applyPreviewTransform(frame, 0.8, 3, -2)).toBe(true);
    expect(frame.style.transform).toBe("translate(3px, -2px) scale(0.8)");
    expect(applyPreviewTransform(frame, 1, 32, 0)).toBe(false);
  });

  it("updates the visible preview and save availability as controls change", () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_pet_import_capabilities") return { automatic: true, transparent_png: true };
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
    expect(availableModes({ automatic: false, transparent_png: true })).toEqual(["keep_alpha"]);
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

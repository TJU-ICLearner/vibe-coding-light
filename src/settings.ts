import { invoke } from "@tauri-apps/api/core";
import type { ActivePet, AgentVisualState, ImportCapabilities, PetImageMode, PetManifest } from "./pet/types";
import "./settings.css";

export function availableModes(capabilities: ImportCapabilities): PetImageMode[] {
  const modes: PetImageMode[] = [];
  if (capabilities.automatic) modes.push("remove_background");
  if (capabilities.transparent_png) modes.push("keep_alpha");
  return modes;
}

export class PreviewController {
  private requestId = 0;
  constructor(
    private readonly process: (bytes: Uint8Array, mode: PetImageMode) => Promise<string>,
    private readonly onPreview: (result: string) => void,
    private readonly onError: (message: string) => void = () => {},
  ) {}

  async load(file: File, mode: PetImageMode): Promise<void> {
    const id = ++this.requestId;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (id !== this.requestId) return;
      const result = await this.process(bytes, mode);
      if (id === this.requestId) this.onPreview(result);
    } catch (error) {
      if (id === this.requestId) this.onError(String(error instanceof Error ? error.message : error));
    }
  }

  clear(): void { this.requestId++; }
}

interface SettingsApi {
  prepare(bytes: Uint8Array, mode: PetImageMode): Promise<string>;
  save(name: string, png: string, scale: number, offsetX: number, offsetY: number): Promise<PetManifest>;
  list(): Promise<PetManifest[]>;
  select(id: string): Promise<void>;
  delete(id: string): Promise<void>;
  active(): Promise<ActivePet>;
}

export class SettingsController {
  readonly preview: PreviewController;
  previewUrl: string | null = null;
  error = "";
  busy = false;
  pets: PetManifest[] = [];
  selectedId = "builtin-cat";
  private listeners = new Set<() => void>();

  constructor(private readonly api: SettingsApi) {
    this.preview = new PreviewController(
      api.prepare,
      (url) => { this.previewUrl = url; this.error = ""; this.busy = false; this.notify(); },
      (message) => { this.previewUrl = null; this.error = message; this.busy = false; this.notify(); },
    );
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener); return () => this.listeners.delete(listener);
  }
  private notify(): void { this.listeners.forEach((listener) => listener()); }

  async load(file: File, mode: PetImageMode): Promise<void> {
    this.previewUrl = null;
    this.error = "";
    this.busy = true;
    this.notify();
    await this.preview.load(file, mode);
  }

  async refresh(): Promise<void> {
    const [pets, active] = await Promise.all([this.api.list(), this.api.active()]);
    this.pets = pets;
    this.selectedId = active.kind === "photo" ? active.id : "builtin-cat";
    this.notify();
  }

  async save(name: string, scale: number, offsetX: number, offsetY: number): Promise<PetManifest> {
    if (!this.previewUrl) throw new Error("请先生成预览");
    this.busy = true; this.error = ""; this.notify();
    try {
      const saved = await this.api.save(name, this.previewUrl, scale, offsetX, offsetY);
      await this.refresh();
      return saved;
    } catch (error) {
      this.error = String(error instanceof Error ? error.message : error);
      throw error;
    } finally { this.busy = false; this.notify(); }
  }

  async select(id: string): Promise<void> {
    try {
      await this.api.select(id);
      this.selectedId = id;
      this.notify();
    } catch (error) { this.error = String(error); this.notify(); throw error; }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.api.delete(id);
      this.pets = this.pets.filter((pet) => pet.id !== id);
      if (this.selectedId === id) this.selectedId = "builtin-cat";
      this.notify();
    } catch (error) { this.error = String(error); this.notify(); throw error; }
  }
}

const api: SettingsApi = {
  prepare: (bytes, mode) => invoke("prepare_pet_preview", { input: Array.from(bytes), mode }),
  save: (name, png, scale, offsetX, offsetY) => invoke("save_photo_pet", { name, pngDataUrl: png, scale, offsetX, offsetY }),
  list: () => invoke("list_photo_pets"),
  select: (id) => invoke("select_pet", { id }),
  delete: (id) => invoke("delete_photo_pet", { id }),
  active: () => invoke("get_active_pet"),
};

const stateLabels: Record<AgentVisualState, string> = {
  idle: "休息", unknown: "未知", working: "工作", waiting: "等待", error: "出错", completed: "完成",
};

function mountSettings(): void {
  const root = document.getElementById("settings-app");
  if (!root) return;
  const controller = new SettingsController(api);
  const fileInput = document.querySelector<HTMLInputElement>("#photo-file")!;
  const modeInput = document.querySelector<HTMLSelectElement>("#photo-mode")!;
  const original = document.querySelector<HTMLImageElement>("#original-preview")!;
  const processed = document.querySelector<HTMLImageElement>("#processed-preview")!;
  const saveButton = document.querySelector<HTMLButtonElement>("#save-pet")!;
  const nameInput = document.querySelector<HTMLInputElement>("#pet-name")!;
  const scaleInput = document.querySelector<HTMLInputElement>("#pet-scale")!;
  const xInput = document.querySelector<HTMLInputElement>("#pet-offset-x")!;
  const yInput = document.querySelector<HTMLInputElement>("#pet-offset-y")!;
  const list = document.querySelector<HTMLElement>("#saved-pets")!;
  const status = document.querySelector<HTMLElement>("#status")!;
  const stateButtons = document.querySelector<HTMLElement>("#state-buttons")!;
  let originalUrl: string | null = null;

  const render = () => {
    processed.src = controller.previewUrl ?? "";
    processed.style.visibility = controller.previewUrl ? "visible" : "hidden";
    saveButton.disabled = controller.busy || !controller.previewUrl;
    status.textContent = controller.error || (controller.busy ? "正在处理图片…" : controller.previewUrl ? "预览已生成，可调整并保存" : "请选择图片");
    status.classList.toggle("error", Boolean(controller.error));
    list.replaceChildren();
    const builtin = document.createElement("button");
    builtin.type = "button";
    builtin.textContent = "默认像素猫";
    builtin.className = controller.selectedId === "builtin-cat" ? "selected" : "";
    builtin.onclick = () => { void controller.select("builtin-cat").catch(() => {}); };
    list.append(builtin);
    for (const pet of controller.pets) {
      const row = document.createElement("div"); row.className = "saved-row";
      const choose = document.createElement("button"); choose.type = "button";
      choose.textContent = pet.name; choose.className = controller.selectedId === pet.id ? "selected" : "";
      choose.onclick = () => { void controller.select(pet.id).catch(() => {}); };
      const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "删除";
      remove.setAttribute("aria-label", `删除 ${pet.name}`);
      remove.onclick = () => { void controller.delete(pet.id).catch(() => {}); };
      row.append(choose, remove); list.append(row);
    }
  };
  controller.onChange(render);
  const chooseFile = async () => {
    const file = fileInput.files?.[0]; if (!file) return;
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    originalUrl = URL.createObjectURL(file); original.src = originalUrl;
    if (!nameInput.value.trim()) nameInput.value = file.name.replace(/\.[^.]+$/, "");
    await controller.load(file, modeInput.value as PetImageMode);
  };
  fileInput.onchange = () => { void chooseFile(); };
  modeInput.onchange = () => { if (fileInput.files?.length) void chooseFile(); };
  saveButton.onclick = () => {
    void controller.save(nameInput.value, Number(scaleInput.value), Number(xInput.value), Number(yInput.value)).catch(() => {});
  };
  for (const [state, label] of Object.entries(stateLabels) as [AgentVisualState, string][]) {
    if (state === "unknown") continue;
    const button = document.createElement("button"); button.type = "button"; button.textContent = label;
    button.onclick = () => {
      stateButtons.querySelectorAll("button").forEach((item) => item.classList.remove("selected"));
      button.classList.add("selected");
      processed.dataset.state = state;
    };
    stateButtons.append(button);
  }
  stateButtons.querySelector("button")?.classList.add("selected");
  invoke<ImportCapabilities>("get_pet_import_capabilities").then((capabilities) => {
    const modes = availableModes(capabilities);
    modeInput.replaceChildren();
    if (modes.includes("remove_background")) modeInput.add(new Option("自动去背景（macOS 14+）", "remove_background"));
    if (modes.includes("keep_alpha")) modeInput.add(new Option("保留透明 PNG", "keep_alpha"));
    fileInput.disabled = modes.length === 0;
    if (modes.length === 0) status.textContent = "图片导入当前仅支持 macOS";
  }).catch((error) => { status.textContent = String(error); });
  void controller.refresh().catch((error) => { status.textContent = String(error); });
  render();
}

if (typeof document !== "undefined") {
  window.addEventListener("DOMContentLoaded", mountSettings);
}

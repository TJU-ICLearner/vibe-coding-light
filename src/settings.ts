import { invoke } from "@tauri-apps/api/core";
import type { ActivePet, AgentVisualState, ImportCapabilities, PetImageMode, PetManifest } from "./pet/types";
import "./settings.css";

export function availableModes(capabilities: ImportCapabilities): PetImageMode[] {
  const modes: PetImageMode[] = [];
  if (capabilities.automatic) modes.push("remove_background");
  if (capabilities.transparent_png) modes.push("keep_alpha");
  return modes;
}

const MAX_INPUT_BYTES = 10 * 1024 * 1024;

export function validatePetFile(file: File, mode: PetImageMode): string | null {
  if (file.size > MAX_INPUT_BYTES) return "图片不能超过 10 MiB";
  const extension = file.name.split(".").pop()?.toLowerCase();
  const isPng = extension === "png" && (file.type === "image/png" || file.type === "");
  const isJpeg = (extension === "jpg" || extension === "jpeg") && (file.type === "image/jpeg" || file.type === "");
  if (!isPng && !isJpeg) return "请选择 PNG 或 JPEG 图片";
  if (mode === "keep_alpha" && !isPng) return "保留透明背景需要 PNG 图片";
  return null;
}

export function validPetTransform(scale: number, offsetX: number, offsetY: number): boolean {
  if (![scale, offsetX, offsetY].every(Number.isFinite) || scale < 0.5 || scale > 0.95 ||
      !Number.isInteger(offsetX) || !Number.isInteger(offsetY)) return false;
  const { side, top } = petTransformBounds(scale);
  return offsetX >= -Math.max(side, 0) && offsetX <= side &&
    offsetY >= Math.max(top, -32) && offsetY <= side;
}

export function petTransformBounds(scale: number): { side: number; top: number } {
  return { side: Math.min(32, Math.floor(64 - scale * 61)), top: Math.max(-32, Math.ceil(scale * 72 - 64)) };
}

export function applyPreviewTransform(frame: HTMLElement, scale: number, offsetX: number, offsetY: number): boolean {
  frame.style.transform = [scale, offsetX, offsetY].every(Number.isFinite)
    ? `translate(${offsetX}px, ${offsetY}px) scale(${scale})` : "";
  return validPetTransform(scale, offsetX, offsetY);
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
    this.preview.clear();
    this.previewUrl = null;
    this.error = validatePetFile(file, mode) ?? "";
    this.busy = !this.error;
    this.notify();
    if (this.error) return;
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

export function mountSettings(): void {
  const root = document.getElementById("settings-app");
  if (!root) return;
  const controller = new SettingsController(api);
  const fileInput = document.querySelector<HTMLInputElement>("#photo-file")!;
  const modeInput = document.querySelector<HTMLSelectElement>("#photo-mode")!;
  const original = document.querySelector<HTMLImageElement>("#original-preview")!;
  const processed = document.querySelector<HTMLImageElement>("#processed-preview")!;
  const processedFrame = document.querySelector<HTMLElement>("#processed-frame")!;
  const saveButton = document.querySelector<HTMLButtonElement>("#save-pet")!;
  const nameInput = document.querySelector<HTMLInputElement>("#pet-name")!;
  const scaleInput = document.querySelector<HTMLInputElement>("#pet-scale")!;
  const xInput = document.querySelector<HTMLInputElement>("#pet-offset-x")!;
  const yInput = document.querySelector<HTMLInputElement>("#pet-offset-y")!;
  const list = document.querySelector<HTMLElement>("#saved-pets")!;
  const status = document.querySelector<HTMLElement>("#status")!;
  const stateButtons = document.querySelector<HTMLElement>("#state-buttons")!;
  let originalUrl: string | null = null;
  let suggestedName = "";
  const updateTransform = () => {
    const scale = Number(scaleInput.value);
    if (Number.isFinite(scale) && scale >= 0.5 && scale <= 0.95) {
      const { side, top } = petTransformBounds(scale);
      xInput.min = String(-side); xInput.max = String(side);
      yInput.min = String(top); yInput.max = String(side);
    }
    const valid = applyPreviewTransform(processedFrame, scale, Number(xInput.value), Number(yInput.value));
    saveButton.disabled = controller.busy || !controller.previewUrl || !valid;
    if (!valid && controller.previewUrl) {
      status.textContent = "大小或位置会使桌宠超出窗口，请调整参数";
      status.classList.add("error");
    }
  };

  const render = () => {
    if (controller.previewUrl) {
      if (processed.getAttribute("src") !== controller.previewUrl) processed.src = controller.previewUrl;
    } else {
      processed.removeAttribute("src");
    }
    processed.style.visibility = controller.previewUrl ? "visible" : "hidden";
    status.textContent = controller.error || (controller.busy ? "正在处理图片…" : controller.previewUrl ? "预览已生成，可调整并保存" : "请选择图片");
    status.classList.toggle("error", Boolean(controller.error));
    updateTransform();
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
    originalUrl = null;
    original.removeAttribute("src");
    const validationError = validatePetFile(file, modeInput.value as PetImageMode);
    if (validationError) { await controller.load(file, modeInput.value as PetImageMode); return; }
    originalUrl = URL.createObjectURL(file); original.src = originalUrl;
    const nextName = file.name.replace(/\.[^.]+$/, "");
    if (!nameInput.value.trim() || nameInput.value === suggestedName) nameInput.value = nextName;
    suggestedName = nextName;
    await controller.load(file, modeInput.value as PetImageMode);
  };
  fileInput.onchange = () => { void chooseFile(); };
  modeInput.onchange = () => { if (fileInput.files?.length) void chooseFile(); };
  for (const input of [scaleInput, xInput, yInput]) input.addEventListener("input", render);
  saveButton.onclick = () => {
    void controller.save(nameInput.value, Number(scaleInput.value), Number(xInput.value), Number(yInput.value)).catch(() => {});
  };
  for (const [state, label] of Object.entries(stateLabels) as [AgentVisualState, string][]) {
    if (state === "unknown") continue;
    const button = document.createElement("button"); button.type = "button"; button.textContent = label;
    button.onclick = () => {
      stateButtons.querySelectorAll("button").forEach((item) => item.classList.remove("selected"));
      button.classList.add("selected");
      processed.className = "";
      void processed.offsetWidth;
      processed.className = `motion-${state}`;
    };
    stateButtons.append(button);
  }
  stateButtons.querySelector("button")?.classList.add("selected");
  processed.className = "motion-idle";
  processed.addEventListener("animationend", (event) => {
    if (event.animationName === "pet-photo-completed") processed.className = "motion-idle";
  });
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
